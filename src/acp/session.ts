import type { AvailableCommand, SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk';
import { createRuntime, type RunOptions, type RuntimeOptions } from '../core/runtime/index.js';
import { ConfigService } from '../services/ConfigService.js';
import { loadCommands } from '../core/ext/commands.js';
import { customCommandTurn } from '../core/ext/commandTurn.js';
import { promptHint } from '../core/mcp/prompts.js';
import { PERMISSION_MODES, type PermissionMode } from '../core/permissions/modes.js';
import type { AgentEvent, ChatMessage, RunResult } from '../core/types.js';

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
  /** The custom commands and MCP prompts a client can offer after `/`. */
  commands?(): Promise<AvailableCommand[]>;
  /** A prompt naming a command, as its prompt and how the turn differs. */
  expand?(text: string): Promise<{ prompt: string; turn: RunOptions }>;
  /** The recorded conversation, for `session/load`. */
  history?(): ChatMessage[];
  /** Switch the permission mode; returns why not when it cannot. */
  setMode?(mode: string): string | undefined;
  /** Switch the model, as `provider:model`. Throws when it cannot. */
  setModel?(ref: string): void;
}

export interface CreateAcpSessionOptions {
  projectRoot: string;
  cwd: string;
  /** Continue a recorded session instead of starting one. */
  sessionId?: string;
  maxSteps?: number;
  configService?: ConfigService;
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
  const configService = options.configService ?? new ConfigService(options.projectRoot);
  const runtime = await createRuntime({
    projectRoot: options.projectRoot,
    cwd: options.cwd,
    surface: 'acp',
    sessionId: options.sessionId,
    maxSteps: options.maxSteps,
    configService,
    ...options.runtime,
  });
  const config = await configService.getConfig();
  const modelOption = (): SessionConfigOption => {
    const current = `${runtime.model.provider}:${runtime.model.model}`;
    return { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: current, options: [{ value: current, name: current }] };
  };

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
    close: () => runtime.close(),
    async commands() {
      const custom = loadCommands(options.projectRoot).commands.map((command) => ({
        name: command.name,
        description: command.description ?? `A ${command.scope} command`,
        ...(command.argumentHint ? { input: { hint: command.argumentHint } } : {}),
      }));
      const prompts = (await runtime.mcpPrompts().catch(() => [])).map((prompt) => ({
        name: `${prompt.serverId}:${prompt.name}`,
        description: prompt.description ?? `A prompt from MCP server ${prompt.serverId}`,
        ...(prompt.arguments.length ? { input: { hint: promptHint(prompt) } } : {}),
      }));
      return [...custom, ...prompts];
    },
    expand: (text) => customCommandTurn(text, options.projectRoot, runtime),
    history: () => runtime.session.messages,
    setMode: (mode) => (PERMISSION_MODES.includes(mode as PermissionMode) && mode !== 'bypass' ? runtime.setPermissionMode(mode as PermissionMode) : `There is no mode ${mode} here.`),
    setModel: (ref) => runtime.setModel(ref),
  };
  return controller;
};
