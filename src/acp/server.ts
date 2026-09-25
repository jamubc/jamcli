import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent,
  type ContentBlock,
  type PermissionOption,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { AgentEvent, ApprovalDecision } from '../core/types.js';
import { createAcpSession, type AcpSessionController, type CreateAcpSessionOptions } from './session.js';
import { stopReasonFor, toolKind, toolLocations, toolTitle, UpdateMapper } from './updates.js';
import { JAMCLI_VERSION } from '../core/version.js';

export interface AcpNewSessionRequest {
  cwd: string;
  mcpServers?: unknown[];
  /** Continue this recorded session: `session/load`. */
  sessionId?: string;
}

export interface AcpServerOptions {
  input: AsyncIterable<Buffer | string | Uint8Array>;
  output: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
  projectRoot: string;
  agentInfo?: { name: string; version: string };
  /** Overridable so tests can drive the protocol without a provider. */
  createSession?: (request: AcpNewSessionRequest) => Promise<AcpSessionController>;
  /** Passed to every session the server creates, for tests. */
  sessionOptions?: Partial<CreateAcpSessionOptions>;
}

export const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Allow for this session', kind: 'allow_always' },
  { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
  { optionId: 'reject-always', name: 'Reject, and say so', kind: 'reject_always' },
];

/**
 * The prompt's blocks as a turn takes them: what was typed, where a `/command` is read,
 * and the context the editor attached, added after it: embedded resources quoted, links named.
 */
export function promptText(blocks: ContentBlock[]): { text: string; context: string } {
  const typed: string[] = [];
  const context: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') typed.push(block.text);
    else if (block.type === 'resource' && 'text' in block.resource) context.push(`Resource ${block.resource.uri}:\n\`\`\`\n${block.resource.text}\n\`\`\``);
    else if (block.type === 'resource_link') context.push(`Linked: [${block.name}](${block.uri})`);
  }
  return { text: typed.join(''), context: context.join('\n\n') };
}

const readable = (input: AsyncIterable<Buffer | string | Uint8Array>): ReadableStream<Uint8Array> => {
  const iterator = input[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(typeof next.value === 'string' ? encoder.encode(next.value) : new Uint8Array(next.value));
    },
  });
};

const writable = (output: NodeJS.WritableStream): WritableStream<Uint8Array> =>
  new WritableStream<Uint8Array>({
    write: (chunk) => new Promise<void>((resolve, reject) => output.write(chunk, (error) => (error ? reject(error) : resolve()))),
  });

/**
 * The Agent Client Protocol server, on the official SDK: the SDK frames, validates, and
 * routes messages; this maps them onto runtimes. A call that asks is sent to the editor as
 * `session/request_permission`.
 */
export class AcpServer {
  private readonly sessions = new Map<string, { controller: AcpSessionController; mapper: UpdateMapper }>();

  constructor(private readonly options: AcpServerOptions) {}

  async start(): Promise<void> {
    const stream = ndJsonStream(writable(this.options.output), readable(this.options.input));
    const connection = new AgentSideConnection((client) => this.agent(client), stream);
    await connection.closed;
    // The client has gone: stop every session's servers and background work.
    await Promise.allSettled([...this.sessions.values()].map((entry) => entry.controller.close?.()));
    this.sessions.clear();
  }

  private open(request: AcpNewSessionRequest): Promise<AcpSessionController> {
    if (this.options.createSession) return this.options.createSession(request);
    return createAcpSession({
      projectRoot: this.options.projectRoot,
      cwd: request.cwd,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...this.options.sessionOptions,
    });
  }

  private session(sessionId: string) {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw RequestError.resourceNotFound(sessionId);
    return entry;
  }

  private agent(client: AgentSideConnection): Agent {
    // Updates go out in order: each waits for the one before it.
    let queue = Promise.resolve();
    const update = (sessionId: string, update: SessionUpdate) => {
      queue = queue.then(() => client.sessionUpdate({ sessionId, update })).catch(() => {});
      return queue;
    };
    const announceCommands = async (controller: AcpSessionController) => {
      const commands = (await controller.commands?.().catch(() => [])) ?? [];
      if (commands.length) await update(controller.id, { sessionUpdate: 'available_commands_update', availableCommands: commands });
    };
    const register = (controller: AcpSessionController, cwd: string) => {
      this.sessions.set(controller.id, { controller, mapper: new UpdateMapper(cwd) });
    };

    return {
      initialize: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: true },
        },
        agentInfo: this.options.agentInfo ?? { name: 'jamcli', version: JAMCLI_VERSION },
        authMethods: [],
      }),

      authenticate: async () => ({}),

      newSession: async (params) => {
        const cwd = params.cwd || this.options.projectRoot;
        let controller: AcpSessionController;
        try {
          controller = await this.open({ cwd, mcpServers: params.mcpServers ?? [] });
        } catch (error: any) {
          throw RequestError.internalError(undefined, `Failed to create session: ${error?.message || error}`);
        }
        register(controller, cwd);
        // After the reply, so the client knows the session the list belongs to.
        setTimeout(() => void announceCommands(controller), 0);
        return { sessionId: controller.id, configOptions: controller.configOptions, ...(controller.modes ? { modes: controller.modes } : {}) };
      },

      loadSession: async (params) => {
        const cwd = params.cwd || this.options.projectRoot;
        let controller: AcpSessionController;
        try {
          controller = await this.open({ cwd, mcpServers: params.mcpServers ?? [], sessionId: params.sessionId });
        } catch (error: any) {
          throw RequestError.resourceNotFound(`${params.sessionId}: ${error?.message || error}`);
        }
        register(controller, cwd);
        const mapper = this.sessions.get(controller.id)!.mapper;
        // The conversation is replayed before the reply, as the protocol asks.
        for (const item of mapper.replay(controller.history?.() ?? [])) await update(controller.id, item);
        setTimeout(() => void announceCommands(controller), 0);
        return { configOptions: controller.configOptions, ...(controller.modes ? { modes: controller.modes } : {}) };
      },

      setSessionMode: async (params) => {
        const { controller } = this.session(params.sessionId);
        const refusal = controller.setMode ? controller.setMode(params.modeId) : 'This session has no modes.';
        if (refusal) throw RequestError.invalidParams(undefined, refusal);
        await update(controller.id, { sessionUpdate: 'current_mode_update', currentModeId: params.modeId });
        return {};
      },

      setSessionConfigOption: async (params) => {
        const { controller } = this.session(params.sessionId);
        if (params.configId !== 'model' || typeof params.value !== 'string' || !controller.setModel) {
          throw RequestError.invalidParams(undefined, `There is no setting ${params.configId} to change.`);
        }
        try {
          controller.setModel(params.value);
        } catch (error: any) {
          throw RequestError.invalidParams(undefined, error?.message ?? String(error));
        }
        return { configOptions: controller.configOptions };
      },

      prompt: async (params) => {
        const { controller, mapper } = this.session(params.sessionId);
        const { text, context } = promptText(params.prompt);
        let expanded: { prompt: string; turn: object } = { prompt: text, turn: {} };
        try {
          expanded = (await controller.expand?.(text)) ?? expanded;
        } catch (error: any) {
          throw RequestError.invalidParams(undefined, error?.message ?? String(error));
        }
        const onEvent = (event: AgentEvent) => {
          if (event.type === 'approval_request') {
            void this.ask(client, controller.id, mapper, event);
            return;
          }
          for (const item of mapper.map(event)) void update(controller.id, item);
        };
        const result = await controller.run(context ? `${expanded.prompt}\n\n${context}` : expanded.prompt, onEvent, expanded.turn);
        await queue;
        return { stopReason: stopReasonFor(result.status) };
      },

      cancel: async (params) => {
        this.sessions.get(params.sessionId)?.controller.cancel();
      },
    };
  }

  /** Ask the editor about a call. A cancelled or failed request denies it. */
  private async ask(client: AgentSideConnection, sessionId: string, mapper: UpdateMapper, event: Extract<AgentEvent, { type: 'approval_request' }>): Promise<void> {
    const root = mapper.root;
    let decision: ApprovalDecision = { allow: false, feedback: 'The editor did not answer.' };
    try {
      const answer = await client.requestPermission({
        sessionId,
        toolCall: {
          toolCallId: event.call.id,
          title: toolTitle(event.call),
          kind: toolKind(event.call.name),
          status: 'pending',
          rawInput: event.call.arguments ?? {},
          locations: toolLocations(event.call, root),
        },
        options: PERMISSION_OPTIONS,
      });
      const chosen = answer.outcome.outcome === 'selected' ? PERMISSION_OPTIONS.find((option) => option.optionId === (answer.outcome as { optionId: string }).optionId) : undefined;
      if (chosen?.kind === 'allow_once') decision = { allow: true };
      else if (chosen?.kind === 'allow_always') decision = { allow: true, scope: 'session' };
      else decision = { allow: false, ...(answer.outcome.outcome === 'cancelled' ? { feedback: 'The editor cancelled the request.' } : {}) };
    } catch {
      // The editor went away or answered with an error: the call does not run.
    }
    event.decide(decision);
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
