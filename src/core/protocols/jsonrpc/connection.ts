import type { Framing } from './framing.js';
import {
  INTERNAL_ERROR,
  JsonRpcError,
  METHOD_NOT_FOUND,
  isNotification,
  isRequest,
  type JsonRpcId,
  type JsonRpcMessage,
} from './messages.js';

export interface ConnectionOptions {
  framing: Framing;
  /** Send bytes to the other side. */
  write: (bytes: Uint8Array) => void;
  /** Told of frames that could not be read and handlers that failed. */
  onError?: (message: string) => void;
  /** How long a request waits for its answer. Defaults to a minute. */
  requestTimeoutMs?: number;
}

type Handler = (params: any) => unknown | Promise<unknown>;

/**
 * Both ends of JSON-RPC over one framing: requests with their answers matched by id, and
 * notifications, each way. Bytes arrive through `receive`, split anywhere; a request
 * with no handler is answered "method not found", and a handler that throws is answered
 * with its error.
 */
export class JsonRpcConnection {
  private readonly decoder;
  private readonly pending = new Map<JsonRpcId, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>();
  private readonly requests = new Map<string, Handler>();
  private readonly notifications = new Map<string, Handler>();
  private nextId = 1;
  private closed: Error | undefined;

  constructor(private readonly options: ConnectionOptions) {
    this.decoder = options.framing.decoder();
  }

  onRequest(method: string, handler: Handler): void {
    this.requests.set(method, handler);
  }

  onNotification(method: string, handler: Handler): void {
    this.notifications.set(method, handler);
  }

  /** Feed bytes from the other side. */
  receive(chunk: Uint8Array | string): void {
    const { messages, errors } = this.decoder.push(chunk);
    for (const error of errors) this.options.onError?.(error);
    for (const message of messages) void this.dispatch(message);
  }

  request<T = unknown>(method: string, params?: unknown, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 60_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} was not answered within ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      options.signal?.addEventListener('abort', () => {
        const waiting = this.pending.get(id);
        if (!waiting) return;
        clearTimeout(waiting.timer);
        this.pending.delete(id);
        reject(new Error(`${method} was cancelled`));
      });
      this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  /** Stop: every request still waiting is rejected with `reason`. */
  close(reason = 'the connection closed'): void {
    if (this.closed) return;
    this.closed = new Error(reason);
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(this.closed);
      this.pending.delete(id);
    }
  }

  get isClosed(): boolean {
    return Boolean(this.closed);
  }

  private send(message: JsonRpcMessage): void {
    this.options.write(this.options.framing.encode(message));
  }

  private async dispatch(message: JsonRpcMessage): Promise<void> {
    if (isRequest(message)) {
      const handler = this.requests.get(message.method);
      if (!handler) {
        this.send({ jsonrpc: '2.0', id: message.id, error: { code: METHOD_NOT_FOUND, message: `No method ${message.method}` } });
        return;
      }
      try {
        const result = await handler(message.params);
        this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
      } catch (error: any) {
        const code = error instanceof JsonRpcError ? error.code : INTERNAL_ERROR;
        this.send({ jsonrpc: '2.0', id: message.id, error: { code, message: error?.message ?? String(error), ...(error instanceof JsonRpcError && error.data !== undefined ? { data: error.data } : {}) } });
      }
      return;
    }
    if (isNotification(message)) {
      const handler = this.notifications.get(message.method);
      try {
        await handler?.(message.params);
      } catch (error: any) {
        this.options.onError?.(`${message.method} failed: ${error?.message ?? error}`);
      }
      return;
    }
    if (message.id === null) return;
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new JsonRpcError(message.error.code, message.error.message, message.error.data));
    else waiting.resolve(message.result);
  }
}
