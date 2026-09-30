import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent,
  type ClientCapabilities,
  type ContentBlock,
  type PermissionOption,
  type SessionUpdate,
  type StopReason,
} from '@agentclientprotocol/sdk';
import type { AgentEvent, ApprovalDecision, RunResult } from '../core/types.js';
import type { RunOptions } from '../core/runtime/index.js';
import { entryText } from '../commands/host.js';
import type { EditorBridge } from '../types/tools.js';
import { editorBridge } from './editor.js';
import { createAcpSession, type AcpSessionController, type CreateAcpSessionOptions } from './session.js';
import { permissionInput, permissionTitle, stopReasonFor, toolKind, toolLocations, UpdateMapper } from './updates.js';
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

/** The question before a fan-out: grant what its children need for the session, or let them ask as they go. */
export const PREFLIGHT_OPTIONS: PermissionOption[] = [
  { optionId: 'allow-always', name: 'Allow for this session', kind: 'allow_always' },
  { optionId: 'reject-once', name: 'Ask as they go', kind: 'reject_once' },
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
  private readonly sessions = new Map<string, { controller: AcpSessionController; mapper: UpdateMapper; lane: Promise<unknown>; stopWaking?: () => void }>();
  /** What the editor said it offers when it connected: its files and terminals, for one. */
  private capabilities: ClientCapabilities | undefined;

  constructor(private readonly options: AcpServerOptions) {}

  async start(): Promise<void> {
    const stream = ndJsonStream(writable(this.options.output), readable(this.options.input));
    const connection = new AgentSideConnection((client) => this.agent(client), stream);
    await connection.closed;
    // The client has gone: stop every session's servers and background work.
    await Promise.allSettled([...this.sessions.values()].map((entry) => entry.controller.close?.()));
    this.sessions.clear();
  }

  private open(request: AcpNewSessionRequest, editor?: EditorBridge): Promise<AcpSessionController> {
    if (this.options.createSession) return this.options.createSession(request);
    return createAcpSession({
      projectRoot: this.options.projectRoot,
      cwd: request.cwd,
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(editor ? { editor } : {}),
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
    const register = (controller: AcpSessionController, cwd: string, written: Map<string, string>) => {
      const entry: { controller: AcpSessionController; mapper: UpdateMapper; lane: Promise<unknown>; stopWaking?: () => void } = { controller, mapper: new UpdateMapper(cwd, written), lane: Promise.resolve() };
      this.sessions.set(controller.id, entry);
      // A wake is a turn the session starts itself: the editor sees it as a message from the person, then the turn's updates.
      entry.stopWaking = controller.onWake?.((wake) => {
        void this.inLane(entry, async () => {
          if (!this.sessions.has(controller.id)) return;
          await update(controller.id, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: wake.display } });
          const result = await controller.run(wake.text, this.onEvent(client, controller, entry.mapper, update)).catch((error: any) => ({ status: 'error' as const, error: error?.message ?? String(error) }));
          if (result.status === 'error' && result.error) await update(controller.id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${result.error}\n` } });
        });
      });
    };
    /** The editor's files and terminals for a session, whose id is known once it is open. */
    const lent = (session: { id: string }, written: Map<string, string>) => editorBridge(client, this.capabilities, () => session.id, update, written);

    return {
      initialize: async (params) => {
        this.capabilities = params.clientCapabilities;
        return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: true },
        },
        agentInfo: this.options.agentInfo ?? { name: 'jamcli', version: JAMCLI_VERSION },
        authMethods: [],
        };
      },

      authenticate: async () => ({}),

      newSession: async (params) => {
        const cwd = params.cwd || this.options.projectRoot;
        let controller: AcpSessionController;
        const session = { id: '' };
        const written = new Map<string, string>();
        try {
          controller = await this.open({ cwd, mcpServers: params.mcpServers ?? [] }, lent(session, written));
        } catch (error: any) {
          throw RequestError.internalError(undefined, `Failed to create session: ${error?.message || error}`);
        }
        session.id = controller.id;
        register(controller, cwd, written);
        // After the reply, so the client knows the session the list belongs to.
        setTimeout(() => void announceCommands(controller), 0);
        return { sessionId: controller.id, configOptions: controller.configOptions, ...(controller.modes ? { modes: controller.modes } : {}) };
      },

      loadSession: async (params) => {
        const cwd = params.cwd || this.options.projectRoot;
        let controller: AcpSessionController;
        const written = new Map<string, string>();
        try {
          controller = await this.open({ cwd, mcpServers: params.mcpServers ?? [], sessionId: params.sessionId }, lent({ id: params.sessionId }, written));
        } catch (error: any) {
          throw RequestError.resourceNotFound(`${params.sessionId}: ${error?.message || error}`);
        }
        register(controller, cwd, written);
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
        const entry = this.session(params.sessionId);
        // A wake that went off runs first, and one that goes off now waits for this prompt.
        return this.inLane(entry, () => this.promptTurn(client, entry, params.prompt, update, () => queue));
      },

      cancel: async (params) => {
        this.sessions.get(params.sessionId)?.controller.cancel();
      },
    };
  }

  /** Run `work` after everything the session has in its lane, so no two turns overlap. */
  private inLane<T>(entry: { lane: Promise<unknown> }, work: () => Promise<T>): Promise<T> {
    const run = entry.lane.then(work, work);
    entry.lane = run.catch(() => undefined);
    return run;
  }

  /** What a turn's events become: session updates, and each call that asks, asked of the editor once. */
  private onEvent(client: AgentSideConnection, controller: AcpSessionController, mapper: UpdateMapper, update: (sessionId: string, update: SessionUpdate) => Promise<void>) {
    // Asks for the same call reach the editor as one request, whose answer settles them all.
    const asking = new Map<string, Promise<void>>();
    const decided = new Set<string>();
    return (event: AgentEvent) => {
      if (event.type === 'approval_request') {
        void this.askOnce(client, controller.id, mapper, event, asking, decided);
        return;
      }
      if (event.type === 'approval_decision') decided.add(event.callId);
      for (const item of mapper.map(event)) void update(controller.id, item);
    };
  }

  private async promptTurn(
    client: AgentSideConnection,
    entry: { controller: AcpSessionController; mapper: UpdateMapper; stopWaking?: () => void },
    prompt: ContentBlock[],
    update: (sessionId: string, update: SessionUpdate) => Promise<void>,
    sent: () => Promise<void>
  ): Promise<{ stopReason: StopReason }> {
    const { controller, mapper } = entry;
    const { text, context } = promptText(prompt);
    const onEvent = this.onEvent(client, controller, mapper, update);
    const runTurn = (prompt: string, turn: RunOptions = {}) => controller.run(context ? `${prompt}\n\n${context}` : prompt, onEvent, turn);
    let result: RunResult | undefined;
    if (controller.isCommand?.(text)) {
      // A command runs as it does in the interface: what it shows is the reply, and a turn it sends is this prompt's turn.
      await controller.runCommand!(text, {
        entry: (entry) => {
          if (entry.kind === 'event') for (const item of mapper.map(entry.event)) void update(controller.id, item);
          else void update(controller.id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${entryText(entry)}\n\n` } });
        },
        turn: async (prompt, turn) => {
          result = await runTurn(prompt, turn);
        },
        mode: (mode) => void update(controller.id, { sessionUpdate: 'current_mode_update', currentModeId: mode }),
        refresh: () => void update(controller.id, { sessionUpdate: 'config_option_update', configOptions: controller.configOptions }),
      });
      if (controller.exited) {
        this.sessions.delete(controller.id);
        entry.stopWaking?.();
        await controller.close?.().catch(() => undefined);
      }
    } else {
      result = await runTurn(text);
    }
    // A failed turn says why, as the interface does, so the editor shows the cause and not a bare refusal.
    if (result?.status === 'error' && result.error) await update(controller.id, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${result.error}\n` } });
    await sent();
    return { stopReason: result ? stopReasonFor(result.status) : 'end_turn' };
  }

  /**
   * Ask the editor about a call, once per call however many ask it: an ask whose call is
   * already before the editor waits for that answer, which settles it too, and asks on its
   * own only if it was not.
   */
  private async askOnce(
    client: AgentSideConnection,
    sessionId: string,
    mapper: UpdateMapper,
    event: Extract<AgentEvent, { type: 'approval_request' }>,
    asking: Map<string, Promise<void>>,
    decided: Set<string>
  ): Promise<void> {
    const key = event.request?.key;
    const open = key ? asking.get(key) : undefined;
    if (open) {
      await open;
      // What that answer settled arrives before this one looks.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (decided.delete(event.call.id)) return;
    }
    const asked = this.ask(client, sessionId, mapper, event);
    if (key) asking.set(key, asked);
    await asked;
    if (key && asking.get(key) === asked) asking.delete(key);
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
          title: permissionTitle(event),
          kind: toolKind(event.call.name),
          status: 'pending',
          rawInput: permissionInput(event),
          locations: toolLocations(event.call, root),
        },
        options: event.request?.grants ? PREFLIGHT_OPTIONS : PERMISSION_OPTIONS,
      });
      const chosen = answer.outcome.outcome === 'selected' ? PERMISSION_OPTIONS.find((option) => option.optionId === (answer.outcome as { optionId: string }).optionId) : undefined;
      if (chosen?.kind === 'allow_once') decision = { allow: true };
      else if (chosen?.kind === 'allow_always') decision = { allow: true, scope: 'session' };
      // Before a fan-out, a rejection grants nothing and lets the children start; a cancelled request still stops the turn.
      else if (chosen?.kind === 'reject_once' && event.request?.grants) decision = { allow: false, proceed: true };
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
