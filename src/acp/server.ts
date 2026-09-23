import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '../core/types.js';
import {
  ACP_PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  isApprovalOutcome,
  isNotification,
  isRequest,
  messageChunk,
  permissionOptions,
  stopReasonFor,
  thoughtChunk,
  toolCallStatusUpdate,
  toolCallUpdate,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PermissionOutcome,
  type SessionUpdate,
} from './protocol.js';
import { createAcpSession, type AcpSessionController } from './session.js';

export interface AcpNewSessionRequest {
  cwd: string;
  mcpServers?: unknown[];
}

export interface AcpServerOptions {
  input: AsyncIterable<Buffer | string>;
  output: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
  projectRoot: string;
  agentInfo?: { name: string; version: string };
  /** Overridable so tests can drive the protocol without a provider. */
  createSession?: (request: AcpNewSessionRequest) => Promise<AcpSessionController>;
}

interface PendingPermission {
  sessionId: string;
  resolve: (message: JsonRpcMessage) => void;
}

const paramsOf = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

const extractPromptText = (prompt: unknown): string => {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) {
    return prompt
      .map((block: any) => (block && typeof block === 'object' && block.type === 'text' ? String(block.text ?? '') : ''))
      .join('');
  }
  return '';
};

/**
 * Agent Client Protocol server. It reads line-delimited JSON-RPC from stdin,
 * drives the core agent, and streams session/update notifications back. A
 * state-changing tool is mapped onto a session/request_permission exchange.
 */
export class AcpServer {
  private readonly options: AcpServerOptions;
  private readonly sessions = new Map<string, AcpSessionController>();
  private readonly pending = new Map<JsonRpcId, PendingPermission>();
  private readonly toolCallIds = new Map<string, Map<string, string>>();
  private nextId = 1000;
  private buffer = '';

  constructor(options: AcpServerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    for await (const chunk of this.options.input) {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      for (const line of lines) this.processLine(line);
    }
    if (this.buffer.trim()) this.processLine(this.buffer);
  }

  private processLine(line: string): void {
    const message = decodeMessage(line);
    if (!message) return;
    if (isRequest(message)) {
      void this.handleRequest(message);
      return;
    }
    if (isNotification(message)) {
      this.handleNotification(message);
      return;
    }
    this.handleResponse(message);
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const params = paramsOf(request.params);
    switch (request.method) {
      case 'initialize':
        this.respond(request.id, this.initializeResult());
        return;
      case 'session/new':
        await this.handleNewSession(request.id, params);
        return;
      case 'session/prompt':
        await this.handlePrompt(request.id, params);
        return;
      case 'session/cancel':
        this.cancelSession(params.sessionId);
        this.respond(request.id, {});
        return;
      default:
        this.respondError(request.id, -32601, `Method not found: ${request.method}`);
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    if (message.method === 'session/cancel') {
      this.cancelSession(paramsOf(message.params).sessionId);
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    if (message.id === null || message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    pending.resolve(message);
  }

  private initializeResult() {
    return {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
      agentInfo: this.options.agentInfo ?? { name: 'jamcli', version: '1.0.0' },
      authMethods: [],
    };
  }

  private async handleNewSession(id: JsonRpcId, params: Record<string, any>): Promise<void> {
    const cwd = typeof params.cwd === 'string' && params.cwd ? params.cwd : this.options.projectRoot;
    try {
      const session = await this.createSession({
        cwd,
        mcpServers: Array.isArray(params.mcpServers) ? params.mcpServers : [],
      });
      this.sessions.set(session.id, session);
      this.respond(id, { sessionId: session.id, configOptions: session.configOptions });
    } catch (error: any) {
      this.respondError(id, -32000, `Failed to create session: ${error?.message || error}`);
    }
  }

  private createSession(request: AcpNewSessionRequest): Promise<AcpSessionController> {
    if (this.options.createSession) return this.options.createSession(request);
    return createAcpSession({
      projectRoot: this.options.projectRoot,
      cwd: request.cwd,
      sessionId: randomUUID(),
    });
  }

  private async handlePrompt(id: JsonRpcId, params: Record<string, any>): Promise<void> {
    const session = this.sessions.get(String(params.sessionId));
    if (!session) {
      this.respondError(id, -32001, `Unknown session: ${String(params.sessionId)}`);
      return;
    }
    try {
      const result = await session.run(extractPromptText(params.prompt), (event) => this.dispatchEvent(session, event));
      this.respond(id, { stopReason: stopReasonFor(result.status) });
    } catch (error: any) {
      this.respondError(id, -32000, `Prompt failed: ${error?.message || error}`);
    }
  }

  private dispatchEvent(session: AcpSessionController, event: AgentEvent): void {
    switch (event.type) {
      case 'text':
        this.notifyUpdate(session.id, messageChunk(event.delta));
        return;
      case 'reasoning':
        this.notifyUpdate(session.id, thoughtChunk(event.delta));
        return;
      case 'tool_call':
        this.recordToolCall(session.id, event.call.name, event.call.id);
        this.notifyUpdate(session.id, toolCallUpdate(event.call));
        return;
      case 'tool_result': {
        const toolCallId = this.resolveToolCallId(session.id, event.result.tool);
        this.notifyUpdate(
          session.id,
          toolCallStatusUpdate(toolCallId, event.result.success ? 'completed' : 'failed')
        );
        return;
      }
      case 'notice':
        this.notifyUpdate(session.id, messageChunk(`${event.message}\n`));
        return;
      case 'usage':
        return;
      case 'approval_request':
        void this.requestPermission(session, event.call).then((approved) => event.decide(approved));
        return;
    }
  }

  private requestPermission(
    session: AcpSessionController,
    call: { id: string; name: string; arguments?: Record<string, any> }
  ): Promise<boolean> {
    const options = permissionOptions();
    const id = this.nextId++;
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, {
        sessionId: session.id,
        resolve: (message) => {
          let outcome: PermissionOutcome | undefined;
          if ('error' in message && message.error) {
            outcome = { outcome: 'cancelled' };
          } else if ('result' in message) {
            // The client replies with { outcome: { outcome, optionId? } }.
            const result = message.result as { outcome?: PermissionOutcome } | undefined;
            outcome = result?.outcome;
          }
          resolve(isApprovalOutcome(outcome, options));
        },
      });
      this.write({
        jsonrpc: '2.0',
        id,
        method: 'session/request_permission',
        params: {
          sessionId: session.id,
          toolCall: {
            toolCallId: call.id,
            title: call.name,
            kind: 'other',
            status: 'pending',
            rawInput: call.arguments ?? {},
            locations: [],
          },
          options,
        },
      });
    });
  }

  private cancelSession(sessionId: unknown): void {
    const id = String(sessionId ?? '');
    const session = this.sessions.get(id);
    if (session) session.cancel();
    for (const [requestId, pending] of this.pending) {
      if (pending.sessionId !== id) continue;
      this.pending.delete(requestId);
      pending.resolve({ jsonrpc: '2.0', id: requestId, error: { code: -32000, message: 'cancelled' } });
    }
  }

  private recordToolCall(sessionId: string, tool: string, toolCallId: string): void {
    let map = this.toolCallIds.get(sessionId);
    if (!map) {
      map = new Map();
      this.toolCallIds.set(sessionId, map);
    }
    map.set(tool, toolCallId);
  }

  private resolveToolCallId(sessionId: string, tool: string): string {
    return this.toolCallIds.get(sessionId)?.get(tool) ?? tool;
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  private respondError(id: JsonRpcId | null, code: number, message: string): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private notifyUpdate(sessionId: string, update: SessionUpdate): void {
    this.write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
  }

  private write(message: JsonRpcMessage): void {
    this.options.output.write(encodeMessage(message));
  }
}

export const runAcpServer = async (projectRoot: string): Promise<number> => {
  const server = new AcpServer({
    input: process.stdin,
    output: process.stdout,
    error: process.stderr,
    projectRoot,
  });
  await server.start();
  return 0;
};
