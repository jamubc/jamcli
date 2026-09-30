import type { AvailableCommand, SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk';
import { createRuntime, type RunOptions, type RuntimeOptions } from '../core/runtime/index.js';
import { CommandHost, type HostEntry } from '../commands/host.js';
import type { ChoiceItem } from '../commands/types.js';
import { hostClipboard } from '../utils/clipboard.js';
import { PERMISSION_MODES, type PermissionMode } from '../core/permissions/modes.js';
import type { AgentEvent, ChatMessage, RunResult } from '../core/types.js';
import type { EditorBridge } from '../types/tools.js';
import { loadConfig } from '../core/config/load.js';
import type { FiredWake } from '../core/wake/index.js';

/** What the ACP server needs from a session in order to drive a turn. */
export interface AcpSessionController {
  id: string;
  cwd: string;
  model: string;
  profile: string;
  configOptions: SessionConfigOption[];
  /** The permission modes, as ACP session modes. */
  modes?: SessionModeState;
  run(prompt: string, onEvent: (event: AgentEvent) => void, turn?: RunOptions): Promise<RunResult>;
  cancel(): void;
  /** Release what the session holds, such as MCP server processes. */
  close?(): Promise<void>;
  /** Every command a client can offer after `/`: the built-in ones, custom commands, and MCP prompts. */
  commands?(): Promise<AvailableCommand[]>;
  /** Whether a prompt names a command, which then runs as it does in the interface. */
  isCommand?(text: string): boolean;
  /** Run a command line: what it shows, the turns it sends, and what it changes go through `handlers`. */
  runCommand?(text: string, handlers: CommandHandlers): Promise<void>;
  /** A command asked to leave; the server closes the session. */
  readonly exited?: boolean;
  /** The list a command offered that waits for /choose, when one does. */
  waitingChoice?(): { title: string; items: ChoiceItem[]; personOnly: boolean } | undefined;
  /** The recorded conversation, for `session/load`. */
  history?(): ChatMessage[];
  /** Switch the permission mode; returns why not when it cannot. */
  setMode?(mode: string): string | undefined;
  /** Switch the model, as `provider:model`. Throws when it cannot. */
  setModel?(ref: string): void;
  /** Hear each of the session's wakes as it goes off, to run it as a turn; returns how to stop. */
  onWake?(listener: (wake: FiredWake) => void): () => void;
}

/** Where a command's effects go, for the prompt that ran it. */
export interface CommandHandlers {
  entry(entry: HostEntry): void;
  /** Run a turn the command sends, as the prompt's own turn. */
  turn(prompt: string, turn: RunOptions): Promise<unknown>;
  /** The permission mode changed. */
  mode(mode: PermissionMode): void;
  /** The session's settings may have changed, such as its model. */
  refresh(): void;
}

export interface CreateAcpSessionOptions {
  projectRoot: string;
  cwd: string;
  /** Continue a recorded session instead of starting one. */
  sessionId?: string;
  maxSteps?: number;
  /** The editor's files and terminals, when it lends them. */
  editor?: EditorBridge;
  /** Assembly overrides, for tests. */
  runtime?: Partial<RuntimeOptions>;
}

const MODE_TEXT: Record<PermissionMode, { name: string; description: string }> = {
  plan: { name: 'Plan', description: 'Read and plan; nothing is changed.' },
  default: { name: 'Default', description: 'Ask before each change or command.' },
  'accept-edits': { name: 'Accept edits', description: 'Edit inside the project without asking; ask for commands.' },
  auto: { name: 'Auto', description: 'Edit inside the project and run commands in the sandbox without asking.' },
  bypass: { name: 'Bypass', description: 'Run everything without asking.' },
};

/**
 * Bypass is not offered over ACP: entering it needs the person's confirmation in a
 * terminal, which an editor's mode picker does not give.
 */
export const acpModes = (current: PermissionMode): SessionModeState => ({
  currentModeId: current,
  availableModes: PERMISSION_MODES.filter((mode) => mode !== 'bypass').map((mode) => ({ id: mode, ...MODE_TEXT[mode] })),
});

/**
 * An ACP session is a runtime like any other surface's: the same provider, tools,
 * policy, and session log. It differs only in forwarding approval requests to the editor
 * and rendering events as session updates, which the server does.
 */
export const createAcpSession = async (options: CreateAcpSessionOptions): Promise<AcpSessionController> => {
  const runtime = await createRuntime({
    projectRoot: options.projectRoot,
    cwd: options.cwd,
    surface: 'acp',
    sessionId: options.sessionId,
    maxSteps: options.maxSteps,
    ...(options.editor ? { editor: options.editor } : {}),
    ...options.runtime,
  });
  const config = loadConfig({ projectRoot: options.projectRoot }).config;
  const modelOption = (): SessionConfigOption => {
    const current = `${runtime.model.provider}:${runtime.model.model}`;
    return { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: current, options: [{ value: current, name: current }] };
  };

  // A command runs through the same host headless uses; each prompt that runs one lends it where its effects go.
  let handlers: CommandHandlers | undefined;
  let exited = false;
  const clipboard = hostClipboard();
  const host = new CommandHost({
    runtime,
    projectRoot: options.projectRoot,
    onEntry: (entry) => handlers?.entry(entry),
    runTurn: (prompt, { display: _display, ...turn }) => handlers?.turn(prompt, turn) ?? Promise.resolve(),
    openRefusal: 'Your editor opens sessions: load one from its session list, or start a new one there.',
    answerHint: 'Answer with /choose <number or key>, or /choose none.',
    laterInput: true,
    copy: async (text) => ((await clipboard.write(text)) ? 'system' : false),
    onMode: (mode) => handlers?.mode(mode),
    onRefresh: () => handlers?.refresh(),
    onExit: () => {
      exited = true;
    },
  });
  await host.load();

  const controller: AcpSessionController = {
    id: runtime.sessionId,
    cwd: options.cwd,
    model: runtime.model.model,
    profile: config.active_profile,
    get configOptions() {
      return [modelOption()];
    },
    get modes() {
      return acpModes(runtime.permissionMode);
    },
    run: (prompt, onEvent, turn) => runtime.run(prompt, onEvent, turn),
    cancel: () => runtime.cancel(),
    close: async () => {
      clipboard.dispose();
      await runtime.close();
    },
    async commands() {
      return host.commands().map((command) => ({
        name: command.name,
        description: command.summary,
        ...(command.args ? { input: { hint: command.args } } : {}),
      }));
    },
    isCommand: (text) => Boolean(host.commandFor(text)),
    async runCommand(text, given) {
      handlers = given;
      try {
        await host.run(text);
      } finally {
        handlers = undefined;
      }
    },
    get exited() {
      return exited;
    },
    waitingChoice() {
      const open = host.waiting;
      return open ? { title: open.request.title, items: open.items, personOnly: Boolean(open.request.personOnly) } : undefined;
    },
    history: () => runtime.session.messages,
    setMode: (mode) => (PERMISSION_MODES.includes(mode as PermissionMode) && mode !== 'bypass' ? runtime.setPermissionMode(mode as PermissionMode) : `There is no mode ${mode} here.`),
    setModel: (ref) => runtime.setModel(ref),
    onWake: (listener) => runtime.onWake(listener),
  };
  return controller;
};
