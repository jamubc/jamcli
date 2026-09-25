/**
 * JSON-RPC 2.0 messages (D20): the one message layer JamCLI's hand-rolled protocols share.
 * Framing is separate (`framing.ts`), so the same messages travel as newline-delimited
 * lines or behind `Content-Length` headers.
 */

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

/** A value as a JSON-RPC message, or null when it is not one. */
export function toMessage(value: unknown): JsonRpcMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed = value as Record<string, any>;
  if (parsed.jsonrpc !== '2.0') return null;
  const idOk = (id: unknown) => typeof id === 'number' || typeof id === 'string';
  if (typeof parsed.method === 'string') {
    if (parsed.id === undefined) return { jsonrpc: '2.0', method: parsed.method, ...('params' in parsed ? { params: parsed.params } : {}) };
    if (!idOk(parsed.id)) return null;
    return { jsonrpc: '2.0', id: parsed.id, method: parsed.method, ...('params' in parsed ? { params: parsed.params } : {}) };
  }
  if ('result' in parsed || 'error' in parsed) {
    if (parsed.id !== null && !idOk(parsed.id)) return null;
    if ('error' in parsed && (!parsed.error || typeof parsed.error.code !== 'number' || typeof parsed.error.message !== 'string')) return null;
    return { jsonrpc: '2.0', id: parsed.id ?? null, ...('error' in parsed ? { error: parsed.error } : { result: parsed.result }) };
  }
  return null;
}

export const isRequest = (message: JsonRpcMessage): message is JsonRpcRequest => 'method' in message && 'id' in message;
export const isNotification = (message: JsonRpcMessage): message is JsonRpcNotification => 'method' in message && !('id' in message);
export const isResponse = (message: JsonRpcMessage): message is JsonRpcResponse => !('method' in message);

/** An error a handler throws to answer with a JSON-RPC error of its own code. */
export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}
