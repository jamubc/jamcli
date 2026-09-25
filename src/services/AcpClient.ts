import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  ClientSideConnection,
  InitializeResponse,
  PermissionOption,
  RequestPermissionOutcome,
  SessionConfigOption,
  SessionUpdate,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import { pathExists, readJson } from '../utils/fsx.js';
import { subprocessEnv } from '../core/sandbox/env.js';

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
  /** Variables passed from JamCLI's environment by name, such as the agent's own key. */
  env_passthrough?: string[];
  cwd?: string;
}

export type AcpInitializeResult = InitializeResponse;

export interface AcpSessionInfo {
  sessionId: string;
  configOptions: SessionConfigOption[];
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export type PermissionOutcome = RequestPermissionOutcome;

export type PermissionHandler = (request: AcpPermissionRequest) => Promise<PermissionOutcome> | PermissionOutcome;

export interface AcpPromptOptions {
  onUpdate?: (update: SessionUpdate) => void;
  onPermission?: PermissionHandler;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AcpPromptResult {
  stopReason: string;
}

/**
 * A client for the Agent Client Protocol, on the official SDK. It starts an ACP agent as
 * a subprocess with the minimal environment and drives a session. A permission request
 * with no handler is cancelled, which denies it. The agent is not offered JamCLI's file
 * system or terminals: it works with its own, outside JamCLI's permissions, as any
 * program the person runs.
 */
export class AcpClient {
  private child?: ChildProcessWithoutNullStreams;
  private connection?: ClientSideConnection;
  private exited?: Promise<Error>;
  private updateHandler?: (update: SessionUpdate) => void;
  private permissionHandler?: PermissionHandler;
  private stderrText = '';

  constructor(private readonly config: AcpAgentConfig) {}

  get stderr(): string {
    return this.stderrText;
  }

  async start(timeoutMs = 15000): Promise<AcpInitializeResult> {
    if (this.child) throw new Error('ACP client is already running');
    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      env: subprocessEnv(process.env, { passthrough: this.config.env_passthrough, extra: this.config.env }),
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrText += chunk;
    });
    this.exited = new Promise<Error>((resolve) => {
      child.on('error', (error) => resolve(error));
      child.on('exit', (code) => resolve(new Error(`ACP agent exited with code ${code}`)));
    });
    this.child = child;
    // The SDK is loaded when an agent is started, not with every session that offers delegation.
    const { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } = await import('@agentclientprotocol/sdk');
    const stream = ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>);
    this.connection = new ClientSideConnection(
      () => ({
        requestPermission: async (params) => ({
          outcome: this.permissionHandler
            ? await this.permissionHandler({ sessionId: params.sessionId, toolCall: params.toolCall, options: params.options })
            : { outcome: 'cancelled' },
        }),
        sessionUpdate: async (params) => this.updateHandler?.(params.update),
      }),
      stream
    );
    return this.within(this.connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} }), 'initialize', timeoutMs);
  }

  async newSession(cwd: string, mcpServers: any[] = [], timeoutMs = 15000): Promise<AcpSessionInfo> {
    const result = await this.within(this.live().newSession({ cwd: path.resolve(cwd), mcpServers }), 'session/new', timeoutMs);
    return { sessionId: result.sessionId, configOptions: result.configOptions ?? [] };
  }

  async prompt(sessionId: string, text: string, options: AcpPromptOptions = {}): Promise<AcpPromptResult> {
    this.updateHandler = options.onUpdate;
    this.permissionHandler = options.onPermission;
    const onAbort = () => this.cancel(sessionId);
    options.signal?.addEventListener('abort', onAbort);
    try {
      const result = await this.within(this.live().prompt({ sessionId, prompt: [{ type: 'text', text }] }), 'session/prompt', options.timeoutMs ?? 600000);
      return { stopReason: result.stopReason ?? 'end_turn' };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      this.updateHandler = undefined;
      this.permissionHandler = undefined;
    }
  }

  cancel(sessionId: string): void {
    void this.connection?.cancel({ sessionId }).catch(() => {});
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.connection = undefined;
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      // The pipe may already be closed.
    }
    child.kill();
    await Promise.race([this.exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }

  private live(): ClientSideConnection {
    if (!this.connection) throw new Error('ACP agent is not running');
    return this.connection;
  }

  /** A request that fails when it takes too long or the agent exits first. */
  private async within<T>(request: Promise<T>, method: string, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    const gone = this.exited!.then((error) => {
      throw error;
    });
    try {
      return await Promise.race([request, late, gone]);
    } finally {
      clearTimeout(timer);
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
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') chunks.push(update.content.text);
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
  if (!(await pathExists(file))) return [];
  try {
    return normalizeAgentsFile(await readJson(file));
  } catch {
    return [];
  }
};
