import fs from 'fs-extra';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  ACP_PROTOCOL_VERSION,
  decodeMessage,
  encodeMessage,
  permissionOptions,
  type AcpConfigOption,
  type JsonRpcId,
  type JsonRpcMessage,
  type PermissionOption,
  type PermissionOutcome,
} from '../acp/protocol.js';

/**
 * A Zed-compatible agent configuration: a command, its arguments, and an
 * optional environment. `id` and `name` are optional labels JamCLI adds.
 */
export interface AcpAgentConfig {
  id?: string;
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities?: Record<string, unknown>;
  agentInfo?: { name: string; version: string };
  authMethods?: { id: string; name?: string }[];
}

export interface AcpSessionInfo {
  sessionId: string;
  configOptions: AcpConfigOption[];
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: { toolCallId?: string; title?: string; kind?: string; rawInput?: unknown };
  options: PermissionOption[];
}

export type PermissionHandler = (
  request: AcpPermissionRequest
) => Promise<PermissionOutcome> | PermissionOutcome;

export interface AcpPromptOptions {
  onUpdate?: (update: any) => void;
  onPermission?: PermissionHandler;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AcpPromptResult {
  stopReason: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

/**
 * A client for the Agent Client Protocol. It starts an ACP-speaking agent as a
 * subprocess and drives initialize, session/new, session/prompt, session/cancel,
 * the session/update stream, and the session/request_permission round trip.
 * When no permission handler is supplied, a request is denied by default.
 */
export class AcpClient {
  private readonly config: AcpAgentConfig;
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private buffer = '';
  private updateHandler?: (update: any) => void;
  private permissionHandler?: PermissionHandler;
  private stderrText = '';

  constructor(config: AcpAgentConfig) {
    this.config = config;
  }

  get stderr(): string {
    return this.stderrText;
  }

  async start(timeoutMs = 15000): Promise<AcpInitializeResult> {
    if (this.child) throw new Error('ACP client is already running');
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: { ...process.env, ...(this.config.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onChunk(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrText += chunk;
    });
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code) => this.failAll(new Error(`ACP agent exited with code ${code}`)));

    this.child = child;

    return this.request<AcpInitializeResult>(
      'initialize',
      {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      },
      timeoutMs
    );
  }

  async newSession(cwd: string, mcpServers: unknown[] = [], timeoutMs = 15000): Promise<AcpSessionInfo> {
    const result = await this.request<AcpSessionInfo>(
      'session/new',
      { cwd: path.resolve(cwd), mcpServers },
      timeoutMs
    );
    return { sessionId: result.sessionId, configOptions: result.configOptions ?? [] };
  }

  async prompt(sessionId: string, text: string, options: AcpPromptOptions = {}): Promise<AcpPromptResult> {
    this.updateHandler = options.onUpdate;
    this.permissionHandler = options.onPermission;
    const onAbort = () => this.cancel(sessionId);
    options.signal?.addEventListener('abort', onAbort);
    try {
      const result = await this.request<{ stopReason?: string }>(
        'session/prompt',
        { sessionId, prompt: [{ type: 'text', text }] },
        options.timeoutMs ?? 600000
      );
      return { stopReason: result?.stopReason ?? 'end_turn' };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      this.updateHandler = undefined;
      this.permissionHandler = undefined;
    }
  }

  cancel(sessionId: string): void {
    if (!this.child) return;
    this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    this.failAll(new Error('ACP client stopped'));
    try {
      child.stdin.end();
    } catch {
      // The pipe may already be closed.
    }
    child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
      setTimeout(resolve, 2000);
    });
  }

  private request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private send(message: JsonRpcMessage): void {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error('ACP agent is not running');
    }
    this.child.stdin.write(encodeMessage(message));
  }

  private onChunk(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.handleLine(line);
  }

  private handleLine(line: string): void {
    const message = decodeMessage(line);
    if (!message) return;

    if ('method' in message && 'id' in message) {
      void this.handleServerRequest(message.method, message.id, message.params);
      return;
    }
    if ('method' in message) {
      if (message.method === 'session/update') {
        const params = (message.params && typeof message.params === 'object' ? message.params : {}) as {
          update?: unknown;
        };
        this.updateHandler?.(params.update);
      }
      return;
    }

    const id = message.id as JsonRpcId;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private async handleServerRequest(method: string, id: JsonRpcId, params: unknown): Promise<void> {
    const data = (params && typeof params === 'object' ? params : {}) as Record<string, any>;
    try {
      if (method === 'session/request_permission') {
        const options = Array.isArray(data.options) ? (data.options as PermissionOption[]) : permissionOptions();
        const request: AcpPermissionRequest = {
          sessionId: String(data.sessionId ?? ''),
          toolCall: data.toolCall ?? {},
          options,
        };
        const outcome: PermissionOutcome = this.permissionHandler
          ? await this.permissionHandler(request)
          : { outcome: 'cancelled' };
        this.send({ jsonrpc: '2.0', id, result: { outcome } });
        return;
      }
      if (method === 'fs/read_text_file') {
        const content = await fs.readFile(String(data.path), 'utf8');
        this.send({ jsonrpc: '2.0', id, result: { content } });
        return;
      }
      if (method === 'fs/write_text_file') {
        await fs.writeFile(String(data.path), String(data.content ?? ''), 'utf8');
        this.send({ jsonrpc: '2.0', id, result: {} });
        return;
      }
      this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported method: ${method}` } });
    } catch (error: any) {
      this.send({ jsonrpc: '2.0', id, error: { code: -32000, message: error?.message || String(error) } });
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }
}

export interface DelegationOptions {
  cwd?: string;
  projectRoot?: string;
  onUpdate?: (update: any) => void;
  onPermission?: PermissionHandler;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DelegationResult {
  agent: string;
  sessionId: string;
  response: string;
  stopReason: string;
}

/**
 * Initialize an agent, open a session in the project root, send one prompt, and
 * collect the streamed text. This is the seam a delegation tool calls.
 */
export const delegateToAgent = async (
  config: AcpAgentConfig,
  prompt: string,
  options: DelegationOptions = {}
): Promise<DelegationResult> => {
  const client = new AcpClient(config);
  const chunks: string[] = [];
  try {
    await client.start();
    const session = await client.newSession(options.cwd ?? options.projectRoot ?? process.cwd());
    const result = await client.prompt(session.sessionId, prompt, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      onPermission: options.onPermission,
      onUpdate: (update) => {
        if (update && update.sessionUpdate === 'agent_message_chunk') {
          chunks.push(String(update.content?.text ?? ''));
        }
        options.onUpdate?.(update);
      },
    });
    return {
      agent: config.name ?? config.id ?? config.command,
      sessionId: session.sessionId,
      response: chunks.join(''),
      stopReason: result.stopReason,
    };
  } finally {
    await client.stop();
  }
};

const isAgentConfig = (value: unknown): value is AcpAgentConfig =>
  Boolean(value) && typeof value === 'object' && typeof (value as AcpAgentConfig).command === 'string';

/**
 * Accept a Zed-compatible agents file. Both an `agents` array of
 * `{ command, args, env }` entries and a Zed `agent_servers` map are understood.
 */
export const normalizeAgentsFile = (raw: unknown): AcpAgentConfig[] => {
  const agents: AcpAgentConfig[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) if (isAgentConfig(entry)) agents.push(entry);
    return agents;
  }
  if (!raw || typeof raw !== 'object') return agents;

  const record = raw as Record<string, any>;
  if (Array.isArray(record.agents)) {
    for (const entry of record.agents) if (isAgentConfig(entry)) agents.push(entry);
  }
  if (record.agent_servers && typeof record.agent_servers === 'object') {
    for (const [id, entry] of Object.entries(record.agent_servers)) {
      if (isAgentConfig(entry)) agents.push({ id, ...entry });
    }
  }
  return agents;
};

export const loadAgentConfigs = async (projectRoot: string): Promise<AcpAgentConfig[]> => {
  const file = path.join(projectRoot, '.jamcli', 'agents.json');
  if (!(await fs.pathExists(file))) return [];
  try {
    return normalizeAgentsFile(await fs.readJson(file));
  } catch {
    return [];
  }
};
