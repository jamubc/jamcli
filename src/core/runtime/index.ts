import path from 'path';
import { CoreAgent } from '../agent.js';
import type { AgentEvent, ApprovalPreview, JamSession, RunResult, ToolCall } from '../types.js';
import { describeCall, previewCall } from '../approval.js';
import type { RestorePreview } from '../git/checkpoints.js';
import { cleanDraft, draftPrompt, planCommit } from '../git/commit.js';
import { createSession } from '../state.js';
import { createChatProvider, listConfiguredProviders } from '../providers/factory.js';
import { isListableProvider, prefixSetNow, type ChatProvider } from '../providers/types.js';
import { applyRules, loadRules, rulesPromptText } from '../rules/index.js';
import { createHookBus, hookVerdict, type HookBus } from '../hooks/index.js';
import type { HookCommand } from '../hooks/commands.js';
import { createRedactor } from '../redact.js';
import { SessionLog, TranscriptRecorder, newSessionId } from '../transcript/index.js';
import { createBuiltinRegistry } from '../tools/registry.js';
import type { ConfigService } from '../../services/ConfigService.js';
import { DEFAULT_AGENT_LOOP_CONFIG, DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';
import type { EditorBridge, JsonSchema } from '../../types/tools.js';
import { createToolSet, registerMcpTools, type McpSource, type ToolSet, type ToolSummary } from './tools.js';
import { childLauncher, type ParentSession } from './children.js';
import { SessionCheckpoints, type CheckpointInfo } from './checkpoints.js';
import { SessionHooks } from './hooks.js';
import { loadAgents, routableAgents } from '../ext/agents.js';
import { taskDescription } from '../tools/task.js';
import { pinnedState } from '../tools/plan.js';
import { readTodos, stampTodos } from '../tools/todo.js';
import { executeBatch } from '../tools/dispatch.js';
import { HeadTailBuffer, MAX_COMMAND_TIMEOUT_MS } from '../tools/command.js';
import { Ledger, detectGates, readResetHandoff, registerVerifyMiddleware, renderHandoff, runGate, writeHandoff, type Gate, type GateRow, type HandoffReason } from '../verify/index.js';
import { effortFor, thinkingFor, type EffortLevel, type ReasoningLevel } from '../routing/capabilities.js';
import { RuleEditor, sessionPermissions, type EditableRuleScope } from './permissions.js';
import type { PermissionFlags } from '../permissions/config.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { PermissionMode } from '../permissions/modes.js';
import { WorkTable, workNews, type WorkItem } from '../work.js';
import { parseRule, type Decision, type Rule } from '../permissions/rules.js';
import { detectSandbox, subprocessEnv, type Sandbox, type SandboxKind, type SandboxSettings } from '../sandbox/index.js';
import { buildRuntimePrompt } from './prompt.js';
import { registerSteerMiddleware } from './steer.js';
import { completeWithinCap } from '../providers/complete.js';
import { estimateRequest } from '../context/estimate.js';
import { describeGates } from '../verify/index.js';
import { configuredSecrets, keyVariables, resolveModel, trustClassifier, type ModelChoice } from './model.js';
import { expandReferences } from './references.js';
import { loadSkills, skillInstructions, skillsPromptText, type Skill } from '../ext/skills.js';
import { skillTool } from '../tools/skill.js';
import { lessonFor, reflectionTools } from '../reflection/index.js';
import { DEFAULT_TOOL_SEARCH_THRESHOLD, toolSearchTool } from '../tools/toolSearch.js';
import { formatDiagnostic, LspManager } from '../lsp/manager.js';
import { enabledPlugins, installedPlugins, verifyPlugins } from '../plugins/lock.js';
import type { PluginParts } from '../plugins/runtime.js';
import { lspTool } from '../tools/lsp.js';
import { webSearchTool } from '../tools/web/index.js';
import { SearchProviders } from '../tools/web/providers.js';
import type { ElicitationAnswer, ElicitationRequest } from '../mcp/connect.js';
import { answerOutputTokens, ModelCatalog, requestedOutputTokens, type ModelInfo } from '../catalog/index.js';
import { CostLedger, requestCost, type SpendSummary } from '../catalog/cost.js';
import { TokenCounter, contextBudget } from '../context/index.js';
import { loadConfig, permissionLayers, type LoadedConfig } from '../config/load.js';
import { revealedKeys } from '../config/credentials.js';
import { observerFor, type ObserveSettings } from '../observe/setup.js';
import { instrumentProvider } from '../observe/instrument.js';
import { exportTarget, otlpExporter } from '../observe/otlp.js';
import { observeSession, type SessionObservation } from '../observe/session.js';
import type { Observer, Span } from '../observe/observer.js';

export type { ToolSummary, McpSource } from './tools.js';
export type { CheckpointInfo } from './checkpoints.js';
export type { EditableRuleScope } from './permissions.js';

/** How long a provider has to list its models. */
const LIST_TIMEOUT_MS = 5_000;
/** Characters a handoff may take of the first prompt: about 600 tokens. */
const HANDOFF_NOTE_CHARS = 2_400;

/** The surface a runtime serves. It is recorded with every decision in the session log. */
export type Surface = 'tui' | 'headless' | 'acp' | 'workflow' | 'child';

/** What a harness search may vary, in place of the shipped constants. */
export interface HarnessOverrides {
  /** Replaces the tool guidance block of the system prompt. */
  guidance?: string;
  /** Programs the harness treats as read-only commands, replacing the built-in list. */
  readOnlyCommands?: string[];
  /** How many times a turn's stop may be denied for a failing gate. */
  maxStopDenials?: number;
  /** The last duration above which the after-edit gate waits for the stop instead. */
  afterEditBoundMs?: number;
  /** The gate tiers a stop runs, in order. */
  stopTiers?: ('T1' | 'T2')[];
  /** The share of the compaction trigger at which older results are stubbed. */
  elideAt?: number;
  /** Per tool: the description or wire schema offered instead of its own. */
  tools?: Record<string, { description?: string; wireSchema?: JsonSchema }>;
}

export interface RuntimeOptions {
  projectRoot: string;
  /**
   * Where the work happens when it is not the project root: the git worktree a
   * `--worktree` session or an isolated task runs in. Tools, rules, `@` references, and
   * checkpoints use it; configuration, grants, and the session log stay with the project.
   */
  workTree?: string;
  /** Where `@` references resolve. Defaults to the work tree. */
  cwd?: string;
  surface: Surface;
  /** Continue this session. It must exist. */
  sessionId?: string;
  /** `provider:model`, or a model on the profile's provider. */
  model?: string;
  /** The reasoning level every request asks for. The agent loop's default when absent. */
  reasoning?: ReasoningLevel;
  /** How hard the model thinks on every request, where it takes a level. */
  effort?: EffortLevel;
  /** Descriptions to offer instead of tools' own, by name: how a trial compares tool prompts. */
  toolDescriptions?: Record<string, string>;
  /**
   * The harness surface a trial searches: prompt parts, middleware constants, and tool
   * wire schemas, each in place of the shipped value. Never read from configuration;
   * an accepted value lands in the source as a commit.
   */
  harness?: HarnessOverrides;
  /** A delegated run's agent rules, read before the project's, which win a conflict. */
  agentRules?: { agent: string; source: string; text: string };
  /** `--allow-tool` names for this run. */
  allowTools?: string[];
  /** `--deny-tool` names for this run. */
  denyTools?: string[];
  /** `--allowed-tools`, `--disallowed-tools`, and `--permission-mode`. */
  permissions?: Omit<PermissionFlags, 'allowTools' | 'denyTools'>;
  /** `--dangerously-bypass-permissions`: start in bypass mode. */
  bypassPermissions?: boolean;
  /** `--dry-run`: make no change, and report each call that would have made one. */
  dryRun?: boolean;
  /** The sandbox commands run in. Detected from the platform and `sandbox` settings when not given. */
  sandbox?: Sandbox;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Serve this provider instead of building one from configuration. */
  provider?: ChatProvider;
  /** Where MCP tools come from; `false` offers none. Defaults to the configured servers. */
  mcp?: McpSource | false;
  /** The environment credentials are redacted from. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
  configService?: ConfigService;
  /** Set on a delegated run: the session that started it, whose policy it decides with. */
  parent?: ParentSession;
  /** Set on a delegated run the person can look in on: what they have said to it since it last asked. */
  heard?: () => string[];
  /** Log level and files, from `-v`, `--log-file`, and `--trace-file`. The environment is read when absent. */
  observe?: ObserveSettings;
  /** Record into this observer instead, under `parentSpan`: a delegated run shares its parent's. */
  observer?: { observer: Observer; parentSpan?: Span };
  /** What an ACP editor lends the session's own tools: its files and its terminal. */
  editor?: EditorBridge;
}

/** An MCP server's prompt. */
export interface McpPrompt {
  serverId: string;
  name: string;
  description?: string;
  arguments: { name: string; description?: string; required?: boolean }[];
}

/** How one turn differs from the session's, as a custom command's front matter asks. */
export interface RunOptions {
  /** Run this turn on this model, then return to the session's. */
  model?: string;
  /** Narrow the tools for this turn to these rules; nothing is allowed that was not already. */
  allowedTools?: string[];
  /** What narrows them, such as `/review`, for the reason a refused call gives. */
  label?: string;
  /** The input is a command the person typed after `!`: run it as `run_command`, without the model. */
  shell?: boolean;
  /** Call this tool once, without the model, as a workflow's `tool` step does. The input is what the log shows. */
  tool?: { name: string; arguments: Record<string, unknown> };
  /** Hidden tools offered for this turn only, such as `/reflect`'s, so no other turn pays for their schemas. */
  offer?: string[];
}

export interface ContextUsage {
  /** Estimated tokens of the next request, corrected by what the provider has reported. */
  used: number;
  /** The model's context window. */
  window: number;
  /** What a request may use: the window, less the output reserve and a margin. */
  budget: number;
  /** Where compaction starts. */
  trigger: number;
  /** The factor learned from the provider's counts; 1 until it has reported one. */
  correction: number;
  autoCompact: boolean;
  /** False when the window is a guess, which is compacted against only when the provider refuses a request. */
  windowKnown: boolean;
}

/** A call a dry run did not make: what it would have done. */
export interface DryRunEntry {
  callId: string;
  tool: string;
  summary: string;
  preview?: ApprovalPreview;
}

/** How a session's turns think. Absent parts are left to the model's default. */
export interface Thinking {
  reasoning?: ReasoningLevel;
  effort?: EffortLevel;
}

export interface Runtime {
  readonly sessionId: string;
  /** Where the tools work: the project root, or the worktree the session runs in. */
  readonly workRoot: string;
  /** The provider and model turns run on. */
  readonly model: ModelChoice;
  /** What the catalog knows about that model: its limits, capabilities, and prices, and where each came from. */
  readonly modelInfo: ModelInfo;
  /** What the session has cost so far, by model, with requests that had no known price counted apart. */
  spend(): SpendSummary;
  /** How much of what the session sent the provider had cached, and how often the request prefix changed. */
  cacheStats(): { promptTokens: number; cachedTokens: number; cacheBreaks: number };
  /** The gates this project declares, which the harness runs after edits and before a turn ends with them. */
  readonly gates: Gate[];
  /**
   * Render the handoff from the log now, marked for the next session to read on its first
   * turn, as `/handoff` asks. Resolves to nothing when the session has no messages yet.
   */
  handoff(): Promise<{ path: string; bytes: number } | undefined>;
  /** How full the context is: the next request's estimate against the model's budget. */
  contextUsage(): ContextUsage;
  /**
   * Summarize the older part of the conversation now, giving particular attention to
   * `focus`, as `/compact` does. Resolves false when there is nothing to compact.
   */
  compact(focus?: string, onEvent?: (event: AgentEvent) => void): Promise<boolean>;
  /** What the model is offered, with schemas. */
  readonly tools: ToolSummary[];
  /** The conversation so far, as the next request will carry it. */
  readonly session: JamSession;
  /** Problems found while assembling, also reported as notices by the first turn. */
  readonly notices: string[];
  /**
   * The notices the first turn would report, handed over now instead: a surface that
   * shows them when the session opens takes them, so the turn does not report them again.
   */
  takeNotices(): string[];
  /** The skills found, which the system prompt lists and the skill tool loads. */
  readonly skills: Skill[];
  /** The language servers that can run here, by name. */
  readonly lspServers: string[];
  /** The prompts the MCP servers offer, each of which becomes `/server:name`. */
  mcpPrompts(): Promise<McpPrompt[]>;
  /** A server's prompt, filled in, as the text of one message. */
  mcpPrompt(serverId: string, name: string, args: Record<string, string>): Promise<string>;
  /** The resources the MCP servers offer, each of which can be referred to as `@server:uri`. */
  mcpResources(): Promise<{ serverId: string; uri: string; name: string; description?: string }[]>;
  /** The configured hooks, and whether the project's are trusted to run. */
  hooks(): { hooks: HookCommand[]; projectTrusted: boolean };
  /** Trust the project's hooks as they are now, for this and later sessions, and start running them. */
  trustProjectHooks(): void;
  readonly permissionMode: PermissionMode;
  /** Where commands run: `bwrap`, `seatbelt`, or `none`, with the reason. */
  readonly sandbox: { kind: SandboxKind; reason: string };
  /** In a dry run, every call that would have changed something, with its preview. */
  readonly dryRunReport: DryRunEntry[];
  /** Switch permission modes for later calls. Returns why not, changing nothing, when the mode is unavailable. */
  setPermissionMode(mode: PermissionMode, options?: { bypassConfirmed?: boolean }): string | undefined;
  /** Every rule deciding calls now, lowest scope first, each with its scope and source. */
  permissionRules(): Rule[];
  /**
   * Add a rule for this session, or save it in the user's, the project's, or the
   * project-local configuration. It applies to the next call. Returns why not, changing
   * nothing, when the rule does not parse, the file cannot be written, or a turn is running.
   */
  addPermissionRule(decision: Decision, text: string, scope: EditableRuleScope): string | undefined;
  /**
   * Remove every rule written as `text` from the scopes a person edits: the session and
   * the user, project, and project-local files. Built-in rules, the run's flags, and the
   * legacy `.jamcli/mcp.json` block are kept, and returned as such.
   */
  removePermissionRule(text: string): { removed: Rule[]; kept: Rule[]; error?: string };
  run(input: string, onEvent?: (event: AgentEvent) => void, options?: RunOptions): Promise<RunResult>;
  cancel(): void;
  /** Switch the provider and model for later turns. Throws if the provider is not configured. */
  setModel(ref: string): void;
  /** How later turns think: the reasoning switch and, where the model takes one, the effort level. */
  readonly thinking: Thinking;
  /** Change how later turns think. An empty value returns to the model's default. */
  setThinking(next: Thinking): void;
  /**
   * Every model the configured providers list, each with what the catalog knows of it
   * without asking further, and why any provider could not be asked. Each provider has
   * `timeoutMs` to answer, and one that does not is left out.
   */
  listModels(timeoutMs?: number): Promise<{ models: ModelInfo[]; problems: string[] }>;
  /** Copy this session, up to an event, into a new one, and return the new id. */
  fork(atEvent?: number): string;
  /** The checkpoints this session took before its changes, oldest first. */
  checkpoints(): CheckpointInfo[];
  /** What restoring checkpoint `n` would change in the working copy. */
  previewCheckpoint(n: number): Promise<RestorePreview>;
  /**
   * Put the working copy back as checkpoint `n` found it, after taking a checkpoint of how
   * it is now, so the restore can itself be undone. Refused while a turn runs.
   */
  restoreCheckpoint(n: number): Promise<string[]>;
  /**
   * Run a change the person asked for, such as reverting a hunk, between two checkpoints,
   * so /rewind can take it back. Refused while a turn runs.
   */
  withCheckpoint<T>(label: string, change: () => Promise<T>, files?: string[]): Promise<T>;
  /** Ask this session's model for a conventional commit message for what would be committed. */
  draftCommitMessage(paths?: string[], signal?: AbortSignal): Promise<string>;
  /**
   * One request to this session's model, outside the conversation, such as for a pull
   * request's description. It is counted and priced like the session's other requests.
   */
  complete(prompt: string, options?: { maxOutputTokens?: number; signal?: AbortSignal }): Promise<string>;
  /** What runs beside the turn, and what ended lately: background commands and child agents. */
  work(): WorkItem[];
  /** Called whenever that changes, between turns included; returns how to stop listening. */
  watchWork(listener: () => void): () => void;
  /** Stop one of them. False when nothing by that id is running. */
  stopWork(id: string): boolean;
  /** What one child agent has done so far, as its own events, oldest first, for looking in on it. */
  workEvents(id: string): AgentEvent[];
  /** Each further event of that child as it happens; returns how to stop listening. */
  watchWorkEvents(id: string, listener: (event: AgentEvent) => void): () => void;
  /** Say something to a running child; it reads it with its next step. False when nothing by that id runs. */
  sayToWork(id: string, text: string): boolean;
  /**
   * Plant a tester's note at this point of the session log. Notes are for people reading
   * the session back; the model never sees them.
   */
  note(text: string): void;
  /** The notes planted in this session, oldest first. */
  notes(): SessionNote[];
  close(): Promise<void>;
}

/** A tester's note as the session log holds it. */
export interface SessionNote {
  text: string;
  ts: number;
}

/** Where the `models` block came from, for the catalog's messages: its file when only one layer sets it. */
function modelsLabel(settings: LoadedConfig): string {
  const labels = new Set([...settings.origins].filter(([key]) => key === 'models' || key.startsWith('models[') || key.startsWith('models.')).map(([, label]) => label));
  return labels.size === 1 ? `${[...labels][0]} models` : 'models';
}

/**
 * The one place a session is assembled. Every surface gets the same provider, tools,
 * policy, rules, hooks, trust gate, redaction, and session log from here, and differs
 * only in how it renders events and answers approval requests.
 */
export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const projectRoot = path.resolve(options.projectRoot);
  const workRoot = path.resolve(options.workTree ?? projectRoot);
  const cwd = path.resolve(options.cwd ?? workRoot);
  const env = options.env ?? process.env;
  const notices: string[] = [];

  const settings = loadConfig({ projectRoot, env });
  notices.push(...settings.errors);
  // A key in the project goes wherever the folder does, so every session says how to move it.
  for (const layer of settings.layers) {
    if (layer.scope !== 'project' && layer.scope !== 'local') continue;
    for (const [provider, entry] of Object.entries(layer.values.api_registry ?? {})) {
      if (!(entry as { api_key?: unknown })?.api_key) continue;
      notices.push(
        `${layer.label} holds the ${provider} key, where a commit or a copy of the folder would carry it. ` +
          `Move it with jamcli auth set ${provider}, then jamcli config unset api_registry.${provider}.api_key --scope ${layer.scope}.`
      );
    }
  }
  const { config, profile, mcp: mcpConfig } = settings;
  const redact = createRedactor(env, configuredSecrets(config.api_registry, env, config.search), revealedKeys);
  let observer: Observer;
  const includeContent = config.otel?.include_content === true;
  if (options.observer) observer = options.observer.observer;
  else {
    // Traces leave the machine only when the configuration turns the exporter on.
    const exporter = config.otel?.enabled
      ? otlpExporter({
          ...exportTarget(config.otel, env),
          env,
          onError: (message) => {
            observer.log('warn', message);
            if (emitting) emitting({ type: 'notice', level: 'warn', message });
            else pending.push(message);
          },
        })
      : undefined;
    const made = observerFor({ ...options.observe, spans: [...(options.observe?.spans ?? []), ...(exporter ? [exporter] : [])] }, env, redact);
    observer = made.observer;
    notices.push(...made.problems);
  }
  /** The session's spans and log lines; set once the session has an id. */
  let observation: SessionObservation | undefined;
  const catalog = new ModelCatalog({ models: config.models, modelsSource: modelsLabel(settings), registry: config.api_registry });
  notices.push(...catalog.problems);

  const sandboxSettings: SandboxSettings = config.sandbox ?? {};
  const withheld = keyVariables(config.api_registry, config.search);
  /** Every process the session starts inherits this, with no credential unless one is named. */
  const envFor = (passthrough: string[] = [], values?: Record<string, string>) =>
    subprocessEnv(env, {
      policy: sandboxSettings.env,
      passthrough: [...(sandboxSettings.env_passthrough ?? []), ...passthrough],
      withheld,
      extra: values,
    });

  const registry = createBuiltinRegistry();
  /**
   * A server's request for input goes to the person through the interface, while a turn
   * runs there. Other surfaces, and requests outside a turn, are declined with a notice.
   */
  let elicitations = 0;
  /** Requests still waiting on the person, answered "cancel" when the turn is stopped. */
  const waitingElicitations = new Set<(answer: ElicitationAnswer) => void>();
  const elicitFromSurface = (request: ElicitationRequest): Promise<ElicitationAnswer> =>
    new Promise((resolve) => {
      const emit = emitting;
      if (!emit || options.surface !== 'tui') {
        emit?.({ type: 'notice', level: 'warn', message: `MCP server ${request.server} asked for input ("${request.message}"), which this surface cannot give, so it was declined.` });
        return resolve({ action: 'decline' });
      }
      let answered = false;
      const respond = (answer: ElicitationAnswer) => {
        if (answered) return;
        answered = true;
        waitingElicitations.delete(respond);
        resolve(answer);
      };
      waitingElicitations.add(respond);
      emit({ type: 'elicitation_request', id: `elicit-${++elicitations}`, request, respond });
    });
  // Skills are listed by name and description; the skill tool loads one when asked.
  const skillSet = loadSkills(projectRoot);
  notices.push(...skillSet.problems.map((problem) => `A skill was not loaded: ${problem}`));
  if (skillSet.skills.length) {
    registry.register(
      skillTool({
        skills: skillSet.skills,
        activate: (skill) => {
          if (!skill.allowedTools) return undefined;
          const label = `the skill ${skill.name}`;
          const rules = skill.allowedTools.flatMap((text) => {
            const parsed = parseRule(text, 'allow', 'session', `${label} allowed-tools`);
            return 'rule' in parsed ? [parsed.rule] : [];
          });
          permissions.narrow(rules, label);
          return `While this skill is active, until this turn ends, only these tools may run: ${permissions.narrowed?.rules.map((rule) => rule.text).join(', ') || 'none'}.`;
        },
      })
    );
  }
  const reflection = options.parent
    ? undefined
    : {
        projectRoot: workRoot,
        events: () => log.events(),
        known: () => [...rules.files.flatMap((file) => file.sections.map((section) => section.body)), ...skillSet.skills.map(skillInstructions)],
      };
  // Registered hidden: only a turn that offers them, /reflect's, shows them to the model.
  if (reflection) for (const tool of reflectionTools(reflection)) registry.register({ ...tool, hidden: true });
  /** Tools offered for the running turn beyond the visible ones, and hooks that exist only while they are. */
  let turnOffer: string[] = [];
  const offerHooks = new Map<string, () => () => void>();
  // Plugins: each installed copy is hashed again, and one that changed is turned off. The
  // code that loads them is imported only when one is on, so a session without any pays nothing.
  if (!options.parent && installedPlugins(projectRoot).length) {
    for (const result of verifyPlugins(projectRoot)) {
      if (!result.ok) notices.push(`Plugin ${result.name} is off: ${result.problem}. Install it again to use it.`);
    }
  }
  const plugins: PluginParts = enabledPlugins(projectRoot).length
    ? await (async () => {
        const { loadPlugins, pluginParts } = await import('../plugins/runtime.js');
        const loaded = loadPlugins(projectRoot);
        notices.push(...loaded.problems);
        const parts = pluginParts(loaded.plugins, { projectRoot, sandboxSettings, envFor: (passthrough) => envFor(passthrough) });
        notices.push(...parts.notices);
        return parts;
      })()
    : { processes: [], servers: [], notices: [] };
  // The MCP client is loaded only when a server is configured: it is the heaviest import a
  // session would otherwise make for nothing.
  const serversConfigured = (mcpConfig.servers ?? []).some((server) => server.enabled !== false) || plugins.servers.length > 0;
  const mcp: McpSource | undefined =
    options.mcp === false
      ? undefined
      : (options.mcp ??
        (serversConfigured
          ? await (async () => {
              const [{ McpManager }, { ConfigService }, { StoredOAuthProvider }, { transportKind }, { detectStore }] = await Promise.all([
                import('../../services/McpManager.js'),
                import('../../services/ConfigService.js'),
                import('../mcp/oauth.js'),
                import('../mcp/connect.js'),
                import('../config/credentials.js'),
              ]);
              let store: ReturnType<typeof detectStore> | undefined;
              return new McpManager({
                // The legacy configuration service loads only when an MCP server needs it.
                configService: options.configService ?? new ConfigService(projectRoot),
                envFor: (server) => envFor(server.env_passthrough, server.env),
                // A signed-in HTTP server's tokens come from the credential store; signing in is `jamcli mcp login`.
                authFor: (server) => (transportKind(server) === 'http' ? new StoredOAuthProvider(server, (store ??= detectStore(env))) : undefined),
                elicit: (request) => elicitFromSurface(request),
                extraServers: plugins.servers,
              });
            })()
          : undefined));
  const mcpServers = mcp ? await registerMcpTools(registry, mcp, notices) : undefined;
  // Past a threshold, MCP tools are offered through search_tools rather than in every request;
  // so is the extended tier of built-ins when the model's window has no room for it.
  const searchThreshold = config.tool_search?.threshold ?? DEFAULT_TOOL_SEARCH_THRESHOLD;
  const loadedTools = new Set<string>();
  const searchingMcp = Boolean(mcpServers && searchThreshold > 0 && mcpServers.size > searchThreshold);
  /** Decided once the model's window is known: whether the extended tier is held behind search_tools. */
  let extendedHeld = false;
  /** The task and delegate families are offered once one of them has started, not before. */
  const FAMILY_TOOLS = new Set(['task_status', 'task_result', 'task_cancel', 'delegate_status', 'delegate_result', 'delegate_cancel']);
  let familyReleased = false;
  const searchable = (name: string) => !loadedTools.has(name) && ((searchingMcp && Boolean(mcpServers?.has(name))) || (extendedHeld && !mcpServers?.has(name) && registry.get(name)?.tier !== 'core' && name !== 'search_tools'));
  const held = (name: string) => FAMILY_TOOLS.has(name) && !familyReleased;
  const offerNow = (names: string[]) => {
    for (const name of names) {
      const tool = toolSet.summaries.find((entry) => entry.name === name);
      // Added to the running turn's list too, so the next request carries it.
      if (tool && !toolSet.definitions.some((entry) => entry.function.name === name)) toolSet.definitions.push({ type: 'function', function: { name, description: tool.description, parameters: tool.parameters as Record<string, unknown> } });
    }
  };
  registry.register({
    ...toolSearchTool({
      deferred: () =>
        toolSet.summaries
          .filter((tool) => searchable(tool.name))
          .map((tool) => ({ name: tool.name, description: tool.description, ...(tool.server ? { server: tool.server } : {}) })),
      load: (names) => {
        for (const name of names) loadedTools.add(name);
        offerNow(names);
      },
    }),
    hidden: true,
  });
  /** The servers that are on, for `@server:uri` references and `/server:prompt` commands. */
  const enabledServers = async () => (mcp ? (await mcp.listServers()).filter((server) => server.enabled !== false) : []);
  const resourceReader =
    mcp?.readServerResource && {
      servers: async () => (await enabledServers()).map((server) => server.id),
      read: (server: string, uri: string) => mcp.readServerResource!(server, uri),
    };
  const depth = options.parent ? options.parent.depth : 0;

  const sandbox = options.sandbox ?? detectSandbox({ projectRoot, settings: sandboxSettings });
  // Inside bubblewrap, /tmp is the sandbox's own, so a temporary directory elsewhere would not exist.
  const commandEnv = { ...envFor(), ...(sandbox.kind === 'bwrap' ? { TMPDIR: '/tmp' } : {}) };
  // Language servers run with the same minimal environment, each started when first needed.
  // A delegated run has none, so a task does not start a second copy of each server.
  const lsp = options.parent || config.lsp?.enabled === false ? undefined : new LspManager(workRoot, config.lsp ?? {}, envFor(), sandbox.kind === 'none' ? undefined : sandbox.wrap);
  if (lsp?.available.length) registry.register(lspTool(lsp));

  const searchProviders = new SearchProviders(config.search);
  if (searchProviders.available.length) registry.register(webSearchTool(searchProviders));

  let permissions: PermissionEngine;
  if (options.parent) {
    permissions = options.parent.permissions.derive();
  } else {
    const assembled = sessionPermissions({
      projectRoot,
      workRoot,
      registry,
      layers: permissionLayers(settings),
      legacyTools: mcpConfig.tools,
      flags: { allowTools: options.allowTools, denyTools: options.denyTools, ...options.permissions },
      bypass: options.bypassPermissions,
      sandboxed: sandbox.kind !== 'none',
      env,
      commitInBypass: config.git?.allow_commit_in_bypass === true,
      webSearchHost: searchProviders.host,
    });
    permissions = assembled.engine;
    notices.push(...assembled.notices);
  }

  // What runs beside the turn. A child shares its parent's table, so its jobs are the person's to see and stop too.
  const workTable = options.parent?.work ?? new WorkTable();
  // Loaded once, so the agents the model is shown and the routing it gets stay in step.
  const agents = loadAgents(projectRoot, config);
  notices.push(...agents.problems);
  const delegateChild = childLauncher({
    projectRoot,
    config,
    agents,
    ...(options.configService ? { configService: options.configService } : {}),
    mcp,
    env: options.env,
    sandbox,
    parent: () => ({ sessionId: log.id, depth: depth + 1, permissions, work: workTable, model: `${choice.provider}:${choice.model}` }),
    create: createRuntime,
    // While a turn runs, a child's request reaches this session's surface too; a background
    // child that outlives the turn is still counted and recorded.
    onUsage: (event) => (emitting ? emitting(event) : (account(event), recorder.handle(event))),
    observer: () => ({ observer, parentSpan: observation?.current() }),
  });
  const taskTool = registry.get('task');
  const dryRunReport: DryRunEntry[] = [];
  const recordDryRun = (call: ToolCall) => {
    const preview = previewCall(call, workRoot);
    dryRunReport.push({ callId: call.id, tool: call.name, summary: describeCall(call), ...(preview ? { preview } : {}) });
  };
  const ruleEditor = new RuleEditor(permissions, projectRoot);
  /** A project grant applies at once and is written for later sessions. */
  const grantProject = (text: string) => {
    const problem = ruleEditor.grantProject(text);
    if (problem) emitting?.({ type: 'notice', level: 'warn', message: problem });
  };
  const buildTools = (): ToolSet => {
    const anySearchable = registry.visible().some((tool) => permissions.offers(tool.name) && searchable(tool.name));
    return createToolSet({
      registry,
      mcpServers,
      permissions,
      alsoOffer: [...turnOffer, ...(anySearchable ? ['search_tools'] : [])],
      grantProject,
      deferred: (name: string) => searchable(name) || held(name),
      ...(options.dryRun ? { dryRun: recordDryRun } : {}),
      descriptions: {
        ...(taskTool ? { task: taskDescription(routableAgents(agents.agents, config.api_registry), agents.defaultAgent) } : {}),
        ...options.toolDescriptions,
        ...Object.fromEntries(Object.entries(options.harness?.tools ?? {}).flatMap(([name, tool]) => (tool.description ? [[name, tool.description]] : []))),
      },
      schemas: Object.fromEntries(Object.entries(options.harness?.tools ?? {}).flatMap(([name, tool]) => (tool.wireSchema ? [[name, tool.wireSchema]] : []))),
      context: () => ({
        projectRoot: workRoot,
        ignorePatterns: mcpConfig.ignore_patterns,
        commandTimeoutMs: config.agent_loop?.command_timeout_ms ?? DEFAULT_AGENT_LOOP_CONFIG.command_timeout_ms,
        env: commandEnv,
        ...(sandbox.kind === 'none' ? {} : { wrapCommand: sandbox.wrap, sandboxNote: sandbox.note }),
        delegate: delegateChild,
        work: workTable,
        delegationDepth: depth,
        delegationConfig: config.delegation ?? DEFAULT_DELEGATION_CONFIG,
        ...(options.editor ? { editor: options.editor } : {}),
        // Only the interface can put a question to the person; elsewhere ask_user says so.
        ...(options.surface === 'tui' ? { elicit: elicitFromSurface } : {}),
        exitPlanMode: () => {
          if (permissions.mode !== 'plan') return { refusal: 'the session is not in plan mode' };
          const target = modeBeforePlan ?? 'default';
          const refusal = switchMode(target);
          return refusal ? { refusal } : { mode: target };
        },
      }),
    });
  };
  let toolSet = buildTools();
  /** The mode held before plan mode, which an approved exit returns to. */
  let modeBeforePlan: PermissionMode | undefined;
  const switchMode = (mode: PermissionMode, modeOptions?: { bypassConfirmed?: boolean }): string | undefined => {
    const from = permissions.mode;
    const refusal = permissions.setMode(mode, modeOptions);
    if (refusal || from === mode) return refusal;
    modeBeforePlan = mode === 'plan' ? from : undefined;
    reassemble();
    recorder.switchPermissionMode(from, mode);
    if (session.messages.length) turnNotes.push(`[Mode changed: ${from} to ${mode}. Earlier calls were decided under ${from}.]`);
    return undefined;
  };

  const rules = applyRules(loadRules(workRoot, cwd), undefined);
  const hooks: HookBus = createHookBus({ onRun: (run) => observation?.hookRun(run) });
  // The task and delegate families are offered from the step after one starts.
  hooks.on(
    'post_tool',
    ({ call }) => {
      if (familyReleased || (call.name !== 'task' && call.name !== 'delegate')) return undefined;
      familyReleased = true;
      offerNow(toolSet.summaries.filter((tool) => FAMILY_TOOLS.has(tool.name)).map((tool) => tool.name));
      return undefined;
    },
    'family tools',
    { internal: true }
  );
  let currentStep = 0;
  /** Records a gate row once the verification middleware is up; the language server's verdict is tier T0. */
  let verify: { record: (row: GateRow) => void } | undefined;
  // After an edit, the model reads the errors the language server finds in what it changed.
  if (lsp?.available.length && config.lsp?.diagnostics_after_edit !== false) {
    hooks.on(
      'post_tool',
      async ({ call, result }) => {
        if (!result.success || !['edit', 'write_file', 'apply_patch'].includes(call.name)) return undefined;
        const files: string[] =
          call.name === 'apply_patch'
            ? ((result.metadata?.files as { path: string; op?: string }[] | undefined) ?? []).filter((file) => file.op !== 'delete').map((file) => file.path)
            : typeof call.arguments?.path === 'string'
              ? [call.arguments.path]
              : [];
        const reports: string[] = [];
        const served = files.filter((file) => lsp.serves(file));
        for (const file of served) {
          const { diagnostics } = await lsp.diagnostics(path.resolve(workRoot, file), 3000).catch(() => ({ diagnostics: [] }));
          const errors = diagnostics.filter((item) => (item.severity ?? 1) === 1);
          if (errors.length) reports.push(...errors.slice(0, 20).map((item) => redact(formatDiagnostic(path.relative(workRoot, path.resolve(workRoot, file)), item))));
        }
        const tree = checkpoints.lastTree;
        if (served.length && tree && verify) {
          verify.record({ tier: 'T0', name: 'lsp', command: 'language server diagnostics', tree, step: currentStep, status: reports.length ? 'failed' : 'passed', durationMs: 0, ts: Date.now() });
        }
        return reports.length ? { context: [`The language server reports errors after this change:\n${reports.join('\n')}`] } : undefined;
      },
      'language server diagnostics'
    );
  }
  if (reflection) {
    const sources = reflection;
    // A lesson that fails the gates is denied before anyone is asked, and only on a turn that offers it.
    offerHooks.set('propose_lesson', () =>
      hooks.on(
        'pre_tool',
        ({ call }) => {
          if (call.name !== 'propose_lesson') return undefined;
          const plan = lessonFor(sources, call.arguments ?? {});
          return plan.ok ? undefined : { decision: 'deny', reason: plan.reason };
        },
        'reflection gates'
      )
    );
  }
  // The configuration's hooks and the plugins' on the bus; a project's only once the person trusts them.
  const sessionHooks = new SessionHooks({
    bus: hooks,
    layers: settings.layers,
    plugins: plugins.processes,
    projectRoot,
    workRoot,
    surface: options.surface,
    sessionId: () => log.id,
    env: () => envFor(),
    sandbox,
    matches: (matcher, call) => permissions.matches(matcher, call),
  });
  if (sessionHooks.notice) notices.push(sessionHooks.notice);
  /** What session_start hooks add to the system prompt. */
  let hookContext: string[] = [];
  /** A provider whose requests are timed and logged under the current turn. */
  const observed = (target: ChatProvider, name: string, purpose?: string) =>
    instrumentProvider(target, { observer, providerName: name, parent: () => observation?.current(), purpose, includeContent });
  // The trust gate screens tool output only in auto mode, where no one reads it first.
  const trust = trustClassifier(config, (target, name) => observed(target, name, 'trust'));
  if (trust.note && permissions.mode === 'auto') notices.push(trust.note);
  const gated = () => permissions.mode === 'auto';
  // An agent's rules come before the project's, so a project's AGENTS.md has the last word.
  const agentRulesText = options.agentRules
    ? `Rules for the ${options.agentRules.agent} agent, from ${options.agentRules.source}:\n${options.agentRules.text}`
    : undefined;
  if (options.agentRules) notices.push(`This run follows the ${options.agentRules.agent} agent's rules from ${options.agentRules.source}.`);
  // Chosen before the provider, which may send it: some route and cache per conversation.
  const sessionId = options.sessionId ?? newSessionId();
  let choice = resolveModel(options.model ?? config.model, profile, config.api_registry);
  // The project's own gates, detected once; their durations come from the ledger once the log is open.
  const gates = detectGates(workRoot);
  let ledger: Ledger | undefined;
  const buildPrompt = () =>
    buildRuntimePrompt({
      profile,
      rulesText: [
        agentRulesText,
        rulesPromptText(rules),
        toolSet.summaries.some((tool) => tool.name === 'skill') ? skillsPromptText(skillSet.skills) : undefined,
        hookContext.length ? hookContext.join('\n') : undefined,
      ]
        .filter(Boolean)
        .join('\n\n'),
      tools: toolSet.summaries,
      projectRoot: workRoot,
      cwd,
      mode: permissions.mode,
      gates: gates.length && permissions.mode !== 'plan' ? describeGates(gates, (name) => ledger?.lastDuration(name)) : undefined,
      model: `${choice.provider}:${choice.model}`,
      ...(options.harness?.guidance ? { guidance: options.harness.guidance } : {}),
    });
  let systemPrompt = buildPrompt();
  /**
   * Whether the extended tier fits: the window's budget, less what the prompt and the core
   * tools cost, must leave twice the output reserve. Decided from the model's window, once
   * it is known, so a small local model is offered what it has room for.
   */
  const decideTiers = (): boolean => {
    const budget = budgetFor();
    const core = toolSet.definitions.filter((definition) => registry.get(definition.function.name)?.tier === 'core');
    const base = estimateRequest({ system: systemPrompt, tools: core, messages: [] });
    // A guessed window is not held against; only the provider's refusal compacts it, and only a known one narrows the tools.
    const hold = windowKnown() && budget.budget - base < 2 * budget.outputReserve;
    const changed = hold !== extendedHeld;
    extendedHeld = hold;
    return changed;
  };
  let provider: ChatProvider | undefined = options.provider;
  let providerError: string | undefined;
  if (!provider) {
    try {
      provider = createChatProvider(choice.provider, config.api_registry, { sessionId });
    } catch (error: any) {
      providerError = error?.message ?? String(error);
    }
  }
  if (provider) provider = observed(provider, choice.provider);

  let modelInfo: ModelInfo = catalog.lookup(choice.provider, choice.model, provider?.family);
  const trustKey = trust.choice ? `${trust.choice.provider}:${trust.choice.model}` : undefined;
  let trustInfo: ModelInfo | undefined = trust.choice ? catalog.lookup(trust.choice.provider, trust.choice.model, trust.provider?.family) : undefined;

  const loop = config.agent_loop;
  /** Learns how the provider counts this session's requests, across model switches. */
  const counter = new TokenCounter();
  const autoCompact = config.context?.auto_compact !== false;
  const budgetFor = () => contextBudget(modelInfo.contextWindow, requestedOutputTokens(modelInfo, loop?.max_output_tokens));
  /**
   * When the request's prefix was last set: this process's start, a change of system prompt
   * or tools, or a compaction. Signed reasoning from before it is not replayed.
   */
  let reasoningSince = prefixSetNow();
  /** A guessed window is not compacted ahead of; Ollama's window is the one JamCLI asks for, so it is always known. */
  const windowKnown = () => modelInfo.sources.contextWindow !== 'default' || modelInfo.provider === 'ollama';
  if (decideTiers()) {
    toolSet = buildTools();
    systemPrompt = buildPrompt();
  }
  // A run's own settings, as a delegated agent's, win over the configured default.
  let thinking: Thinking =
    options.reasoning || options.effort
      ? { ...(options.reasoning ? { reasoning: options.reasoning } : {}), ...(options.effort ? { effort: options.effort } : {}) }
      : thinkingFor(config.effort ?? 'auto');
  const buildAgent = () =>
    new CoreAgent({
      provider,
      model: choice.model,
      temperature: profile.temperature,
      ...(thinking.reasoning ? { reasoning: thinking.reasoning } : {}),
      ...(thinking.effort ? { effort: effortFor(thinking.effort, modelInfo.efforts), acceptsEffort: modelInfo.effort } : {}),
      modelUsageKey: `${choice.provider}:${choice.model}`,
      maxOutputTokens: requestedOutputTokens(modelInfo, loop?.max_output_tokens),
      context: { budget: budgetFor(), counter, auto: autoCompact, proactive: windowKnown() },
      // Only Ollama sizes its window per request; the others ignore it.
      contextLength: modelInfo.contextWindow,
      dispatcher: toolSet.dispatcher,
      toolDefinitions: toolSet.definitions,
      maxSteps: options.maxSteps ?? loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
      // A child out of steps still reports what it found; the parent would otherwise redo it.
      ...(options.surface === 'child' ? { wrapUpOnLimit: true } : {}),
      maxToolCallsPerTurn: loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
      truncationLimit: loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
      systemPrompt,
      hooks,
      ...(gated() ? { trustClassifier: trust.classifier, trustUsageKey: trustKey, trustPrice: trustInfo?.price } : {}),
      price: modelInfo.price,
      thinkingStyle: modelInfo.thinking,
      alwaysThinks: modelInfo.alwaysThinks,
      reasoningSince,
      trustThreshold: config.trust?.threshold,
      trustDedupe: config.trust?.dedupe,
      trustOffNote: gated(),
      redact,
      signal: options.signal,
      pinned: pinnedWithGates,
      ...(options.harness?.elideAt !== undefined ? { elideAt: options.harness.elideAt } : {}),
      protectedPaths: async () => {
        const todos = await readTodos({ projectRoot: workRoot });
        return todos.filter((todo) => todo.status !== 'completed').flatMap((todo) => `${todo.content} ${todo.check ?? ''}`.match(/[\w./-]+\.[A-Za-z0-9]+/g) ?? []);
      },
      // Only the top-level session tells the model what ended: a child sharing the table must not take the news.
      ...(options.parent ? {} : { news: () => workTable.drainEnded().map(workNews) }),
      ...(options.heard ? { heard: options.heard } : {}),
      turnNotes: () => turnNotes.splice(0),
      // A delegated run shares the working copy; the checkpoint before its task call covers it.
      ...(options.surface === 'child' ? {} : { beforeChange: (call: ToolCall) => checkpoints.take(call), afterChange: () => checkpoints.settle() }),
    });
  let agent = buildAgent();
  /** What the harness must tell the model with its next prompt, each in bracket form. */
  const turnNotes: string[] = [];
  /** The pinned state a summary carries, with one line per gate from the ledger. */
  async function pinnedWithGates(): Promise<string | undefined> {
    const state = await pinnedState(workRoot);
    const tail = ledger?.tail() ?? [];
    if (!tail.length) return state;
    return [state, `Gates:\n${tail.join('\n')}`].filter(Boolean).join('\n\n');
  }
  /** What is offered, and what the model is told, depend on the mode, the rules, and the model's window. */
  const reassemble = () => {
    toolSet = buildTools();
    systemPrompt = buildPrompt();
    if (decideTiers()) {
      toolSet = buildTools();
      systemPrompt = buildPrompt();
    }
    reasoningSince = prefixSetNow();
    agent = buildAgent();
  };

  const log = options.sessionId
    ? SessionLog.open(projectRoot, options.sessionId)
    : SessionLog.create(projectRoot, {
        id: sessionId,
        cwd,
        surface: options.surface,
        delegatedBy: options.parent?.sessionId,
        permissionMode: permissions.mode,
      });
  let session = options.sessionId ? log.toSession() : createSession(projectRoot, log.id);
  /** A continued session keeps what it cost before, as each request was priced then. */
  const costLedger = options.sessionId ? CostLedger.fromEvents(log.events()) : new CostLedger();
  const account = (event: AgentEvent) => {
    if (event.type === 'usage') costLedger.record({ model: event.model, usage: event.usage, cost: event.cost, delegated: Boolean(event.delegatedSession) });
    // The agent that compacted moved its own; later agents start from here.
    if (event.type === 'compaction') reasoningSince = prefixSetNow();
  };
  let emitting: ((event: AgentEvent) => void) | undefined;
  const recorder = new TranscriptRecorder(log, {
    surface: options.surface,
    model: `${choice.provider}:${choice.model}`,
    onError: (error) => emitting?.({ type: 'notice', level: 'error', message: `The session log could not be written: ${error.message}` }),
  });
  const checkpoints = new SessionCheckpoints({
    workRoot,
    sessionId: log.id,
    events: () => log.events(),
    record: (checkpoint) => recorder.recordCheckpoint(checkpoint),
    warn: (message) => emitting?.({ type: 'notice', level: 'warn', message }),
    busy: () => running,
  });
  hooks.on(
    'turn_start',
    () => {
      checkpoints.startTurn();
    },
    'verify turn tree',
    { internal: true }
  );

  // Verification: the project's own gates, run through the same path as a model's command.
  ledger = Ledger.fromEvents(log.events());
  const gateLedger = ledger;
  if (gateLedger.all().length) systemPrompt = buildPrompt();
  let gateController: AbortController | undefined;
  const runGateCommand = async (command: string) => {
    const emit = emitting ?? (() => undefined);
    gateController = new AbortController();
    if (options.signal?.aborted) gateController.abort();
    const call: ToolCall = { id: `gate-${Date.now().toString(36)}`, name: 'run_command', arguments: { command, timeout_ms: MAX_COMMAND_TIMEOUT_MS } };
    try {
      const batch = await executeBatch([call], { dispatcher: toolSet.dispatcher, emit, signal: gateController.signal, projectRoot: workRoot, session, hooks, redact });
      const [result] = batch.results;
      return { status: result.status ?? (result.success ? ('ok' as const) : ('error' as const)), output: result.output, durationMs: result.durationMs };
    } finally {
      gateController = undefined;
    }
  };
  verify = registerVerifyMiddleware(hooks, {
    gates,
    ledger: gateLedger,
    currentTree: () => checkpoints.lastTree,
    changedThisTurn: () => checkpoints.changedThisTurn,
    step: () => currentStep,
    run: (gate) => runGate(gate, { run: runGateCommand, tree: checkpoints.lastTree, step: currentStep }),
    emit: (event) => emitting?.(event),
    todos: { read: () => readTodos({ projectRoot: workRoot }), stamp: async (stamp) => void (await stampTodos({ projectRoot: workRoot }, stamp)) },
    backpressure: options.surface !== 'child',
    ...(options.harness?.maxStopDenials !== undefined ? { maxStopDenials: options.harness.maxStopDenials } : {}),
    ...(options.harness?.afterEditBoundMs !== undefined ? { afterEditBoundMs: options.harness.afterEditBoundMs } : {}),
    ...(options.harness?.stopTiers ? { stopTiers: options.harness.stopTiers } : {}),
  });
  registerSteerMiddleware(hooks, {
    projectRoot: workRoot,
    ...(options.harness?.readOnlyCommands ? { readOnlyCommands: new Set(options.harness.readOnlyCommands) } : {}),
    modeWouldAsk: (call) => {
      const verdict = permissions.decide(call);
      return verdict.decision === 'ask' && verdict.by === 'mode';
    },
    currentTree: () => checkpoints.lastTree,
    emit: (event) => emitting?.(event),
  });
  /** The handoff, rendered from the log. A reset the person asked for is not overwritten by the session's end. */
  const writeHandoffNow = async (reason: HandoffReason): Promise<{ path: string; bytes: number } | undefined> => {
    if (options.parent) return undefined;
    const events = log.events();
    if (!events.some((event) => event.type === 'message')) return undefined;
    if (reason === 'session_end') {
      const lastHandoff = events.map((event, index) => ({ event, index })).filter(({ event }) => event.type === 'handoff').at(-1);
      if (lastHandoff && (lastHandoff.event as { reason?: string }).reason === 'reset' && !events.slice(lastHandoff.index + 1).some((event) => event.type === 'message')) return undefined;
    }
    const todos = await readTodos({ projectRoot: workRoot });
    const written = writeHandoff(workRoot, renderHandoff(events, todos, { sessionId: log.id, reason }));
    recorder.handle({ type: 'handoff', ...written, reason });
    return written;
  };
  hooks.on('compaction', ({ strategy }) => (strategy === 'drop' ? writeHandoffNow('drop').then(() => undefined) : undefined), 'handoff on drop', { internal: true });
  hooks.on('pre_compact', () => ({ context: ['The todo list and the gate results are pinned after the summary; do not restate them.'] }), 'M6 pinned note', { internal: true });
  // A handoff the last session left for this one reaches the model with the first prompt, within a fixed budget.
  if (!options.sessionId && !options.parent) {
    const reset = readResetHandoff(workRoot);
    if (reset && reset.session !== log.id) {
      const buffer = new HeadTailBuffer(HANDOFF_NOTE_CHARS);
      buffer.push(reset.text);
      turnNotes.push(`[Handoff from the previous session ${reset.session}:\n${buffer.toString()}]`);
      const off = hooks.on(
        'turn_start',
        () => {
          emitting?.({ type: 'steer', handler: 'M1', detail: `handoff from session ${reset.session} read with the first prompt` });
          off();
        },
        'handoff read',
        { internal: true }
      );
      notices.push(`The handoff session ${reset.session} left in .jamcli/handoff.md reaches the model with the first prompt.`);
    }
  }
  /** One request outside the conversation, counted and priced like the session's others. */
  async function completeOnce(prompt: string, request: { maxOutputTokens?: number; signal?: AbortSignal } = {}): Promise<string> {
    if (!provider) throw new Error(providerError ?? 'No model provider is configured for this session.');
    const result = await completeWithinCap(provider, [{ role: 'user', content: prompt, timestamp: Date.now() }], {
      model: choice.model,
      maxOutputTokens: answerOutputTokens(modelInfo, request.maxOutputTokens ?? 800) ?? request.maxOutputTokens ?? 800,
      contextLength: modelInfo.contextWindow,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (result.usage) {
      const cost = requestCost(result.usage, modelInfo.price);
      const event: AgentEvent = { type: 'usage', usage: result.usage, model: `${choice.provider}:${choice.model}`, ...(cost !== undefined ? { cost } : {}) };
      account(event);
      recorder.handle(event);
    }
    return result.content ?? '';
  }


  observation = observeSession(observer, {
    sessionId: log.id,
    surface: options.surface,
    provider: choice.provider,
    model: choice.model,
    permissionMode: permissions.mode,
    sandbox: sandbox.kind,
    parent: options.observer?.parentSpan,
    includeContent,
  });
  {
    const started = await hookVerdict(hooks, 'session_start', { session, profile: config.active_profile, source: options.sessionId ? 'resume' : 'new' }, (event) => {
      if (event.type === 'notice') notices.push(event.message);
    });
    if (started.context.length) {
      hookContext = started.context;
      reassemble();
    }
  }

  const pending = [...notices];
  let running = false;
  let turns = 0;
  /** The agent running the current turn. A switch during the turn builds a new agent for later turns. */
  let turnAgent: CoreAgent | undefined;

  /**
   * Ask the provider about the model, then size requests from the answer. Turns wait for
   * it, so a session starts without waiting on the network, and the first request is
   * sized from the provider's own numbers.
   */
  const resolveModelInfo = async (): Promise<void> => {
    const asked = choice;
    try {
      const info = await catalog.resolve(asked.provider, asked.model, provider);
      if (asked !== choice) return;
      modelInfo = info;
      if (decideTiers()) reassemble();
      else agent = buildAgent();
      if (info.sources.contextWindow === 'default' && info.provider !== 'ollama') {
        const notice =
          `JamCLI does not know the context window of ${info.provider}:${info.model}, so it compacts the conversation only when the provider refuses it as too long. ` +
          `Set models["${info.provider}:${info.model}"].context_window in .jamcli/config.json.`;
        notices.push(notice);
        pending.push(notice);
      }
    } catch (error: any) {
      pending.push(`The details of ${asked.provider}:${asked.model} could not be read: ${error?.message ?? error}`);
    }
  };
  let modelReady = resolveModelInfo();
  // The classifier is fixed for the session, so it is asked about once.
  const trustReady = trust.choice && trust.provider
    ? catalog.resolve(trust.choice.provider, trust.choice.model, trust.provider).then(
        (info) => {
          trustInfo = info;
          agent = buildAgent();
        },
        () => undefined
      )
    : Promise.resolve();

  /** Switch the provider and model for later turns. Throws if the provider is not configured. */
  const switchModel = (ref: string) => {
    const next = resolveModel(ref, profile, config.api_registry);
    const before = `${choice.provider}:${choice.model}`;
    provider = observed(createChatProvider(next.provider, config.api_registry, { sessionId: log.id }), next.provider);
    providerError = undefined;
    choice = next;
    modelInfo = catalog.lookup(next.provider, next.model, provider.family);
    // The prompt names the model, so the switch rebuilds it; the model reads the change with its next prompt.
    reassemble();
    recorder.switchModel(`${next.provider}:${next.model}`);
    const after = `${next.provider}:${next.model}`;
    if (before !== after && session.messages.length) turnNotes.push(`[Model changed: ${before} to ${after}. Messages above were written by ${before}.]`);
    modelReady = resolveModelInfo();
  };

  return {
    skills: skillSet.skills,
    lspServers: lsp?.available ?? [],
    async mcpPrompts() {
      if (!mcp?.listServerPrompts) return [];
      const lists = await Promise.all((await enabledServers()).map((server) => mcp.listServerPrompts!(server).catch(() => [])));
      return lists.flat();
    },
    async mcpPrompt(serverId, name, args) {
      if (!mcp?.getServerPrompt) throw new Error('No MCP server offers prompts here.');
      return mcp.getServerPrompt(serverId, name, args);
    },
    async mcpResources() {
      if (!mcp?.listServerResources) return [];
      const lists = await Promise.all((await enabledServers()).map((server) => mcp.listServerResources!(server).catch(() => [])));
      return lists.flat();
    },
    hooks: () => ({ hooks: sessionHooks.commands, projectTrusted: sessionHooks.projectTrusted }),
    trustProjectHooks: () => sessionHooks.trust(),
    get sessionId() {
      return log.id;
    },
    workRoot,
    get model() {
      return { ...choice };
    },
    get modelInfo() {
      return modelInfo;
    },
    spend() {
      return costLedger.summary();
    },
    cacheStats() {
      const { promptTokens, cachedTokens, cacheBreaks } = recorder.summary();
      return { promptTokens, cachedTokens, cacheBreaks };
    },
    gates,
    handoff: () => writeHandoffNow('reset'),
    contextUsage() {
      const budget = budgetFor();
      return {
        used: counter.count({ system: systemPrompt, tools: toolSet.definitions, messages: session.messages }),
        window: budget.window,
        budget: budget.budget,
        trigger: budget.trigger,
        correction: counter.correction,
        autoCompact,
        windowKnown: windowKnown(),
      };
    },

    async compact(focus, onEvent) {
      if (running) throw new Error('A turn is running in this session; compact after it ends.');
      running = true;
      const emit = (event: AgentEvent) => {
        account(event);
        recorder.handle(event);
        observation?.event(event);
        onEvent?.(event);
      };
      emitting = emit;
      try {
        await Promise.all([modelReady, trustReady]);
        turnAgent = agent;
        const result = await turnAgent.compact(session, emit, { focus });
        session = result.session;
        return result.compacted;
      } finally {
        running = false;
        emitting = undefined;
        turnAgent = undefined;
      }
    },
    get tools() {
      return toolSet.summaries;
    },
    get session() {
      return session;
    },
    notices,
    takeNotices: () => pending.splice(0),
    get permissionMode() {
      return permissions.mode;
    },
    sandbox: { kind: sandbox.kind, reason: sandbox.reason },
    dryRunReport,

    setPermissionMode(mode, modeOptions) {
      return switchMode(mode, modeOptions);
    },

    permissionRules() {
      return permissions.list();
    },

    addPermissionRule(decision, text, scope) {
      if (running) return 'A turn is running; change rules when it ends.';
      const problem = ruleEditor.add(decision, text, scope);
      if (!problem) reassemble();
      return problem;
    },

    removePermissionRule(text) {
      if (running) return { removed: [], kept: [], error: 'A turn is running; change rules when it ends.' };
      const result = ruleEditor.remove(text);
      if (result.removed.length) reassemble();
      return result;
    },

    async run(input, onEvent, turn = {}) {
      if (running) throw new Error('A turn is already running in this session.');
      running = true;
      const emit = (event: AgentEvent) => {
        if (event.type === 'step_start') currentStep = event.step;
        account(event);
        recorder.handle(event);
        observation?.event(event);
        onEvent?.(event);
        // Notification hooks hear when the person is wanted; they never hold the turn up.
        if (event.type === 'approval_request') {
          void hookVerdict(hooks, 'notification', { session, message: `JamCLI asks to run ${event.call.name}.`, level: 'info' }, onEvent);
        }
      };
      emitting = emit;
      let restoreModel: string | undefined;
      const unsubscribes: (() => void)[] = [];
      try {
        if (turn.model) {
          const before = `${choice.provider}:${choice.model}`;
          try {
            switchModel(turn.model);
            restoreModel = before;
          } catch (error: any) {
            emit({ type: 'notice', level: 'warn', message: `${turn.label ?? 'This turn'} asks for ${turn.model}, which cannot be used here (${error?.message ?? error}), so it runs on ${before}.` });
          }
        }
        if (turn.offer?.length) {
          turnOffer = turn.offer;
          for (const name of turn.offer) {
            const subscribe = offerHooks.get(name);
            if (subscribe) unsubscribes.push(subscribe());
          }
          if (!turn.allowedTools) reassemble();
        }
        if (turn.allowedTools) {
          const label = turn.label ?? 'this command';
          const parsed = turn.allowedTools.map((text) => parseRule(text, 'allow', 'session', `${label} allowed-tools`));
          for (const item of parsed) if ('error' in item) emit({ type: 'notice', level: 'warn', message: `${label}: ${item.error}` });
          permissions.narrow(parsed.flatMap((item) => ('rule' in item ? [item.rule] : [])), label);
          reassemble();
        }
        await Promise.all([modelReady, trustReady]);
        for (const message of pending.splice(0)) emit({ type: 'notice', level: 'warn', message });
        // A command typed after `!` needs no model, and its text is not a prompt to expand.
        if (!provider && !turn.shell && !turn.tool) {
          const error = providerError ?? 'No model provider is configured for this session.';
          emit({ type: 'notice', level: 'error', message: error });
          return { status: 'error', sessionId: log.id, response: '', turns: 0, usage: { ...session.usage }, error, session };
        }
        const expanded = turn.shell || turn.tool ? { prompt: input, notices: [] } : await expandReferences(input, cwd, redact, resourceReader);
        for (const message of expanded.notices) emit({ type: 'notice', level: 'warn', message });
        turns += 1;
        turnAgent = agent;
        observation?.startTurn(expanded.prompt);
        let result: RunResult | undefined;
        try {
          result = await turnAgent.run(session, expanded.prompt, emit, turn.shell ? { shell: true } : turn.tool ? { tool: turn.tool } : {});
        } catch (error) {
          observation?.endTurn(undefined, error);
          throw error;
        }
        observation?.endTurn(result);
        if (result.session) session = result.session;
        return result;
      } finally {
        // What a command or a skill narrowed lasts the turn. A delegated run's engine is
        // derived from its parent's, so what it narrowed is its own to let go.
        if (permissions.narrowed) {
          permissions.narrow(undefined);
          reassemble();
        }
        if (turnOffer.length) {
          turnOffer = [];
          for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
          reassemble();
        }
        if (restoreModel) switchModel(restoreModel);
        running = false;
        emitting = undefined;
        turnAgent = undefined;
      }
    },

    cancel() {
      for (const respond of [...waitingElicitations]) respond({ action: 'cancel' });
      gateController?.abort();
      (turnAgent ?? agent).cancel(session.id);
    },

    setModel(ref) {
      switchModel(ref);
    },

    get thinking() {
      return thinking;
    },

    setThinking(next) {
      thinking = { ...(next.reasoning ? { reasoning: next.reasoning } : {}), ...(next.effort ? { effort: next.effort } : {}) };
      agent = buildAgent();
    },

    async listModels(timeoutMs = LIST_TIMEOUT_MS) {
      const problems: string[] = [];
      await catalog.refreshDirectory();
      const lists = await Promise.all(
        listConfiguredProviders(config.api_registry).map(async (id): Promise<ModelInfo[]> => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const listed = createChatProvider(id, config.api_registry);
            if (!isListableProvider(listed)) return [];
            const late = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`did not answer within ${Math.round(timeoutMs / 100) / 10} s`)), timeoutMs);
            });
            const offered = await Promise.race([listed.listModels(), late]);
            return offered.map((entry) => {
              const info = catalog.lookup(id, entry.id, listed.family, entry.contextWindow ? { contextWindow: entry.contextWindow } : undefined);
              return info.tools === undefined && entry.supports_tool_calling !== undefined ? { ...info, tools: entry.supports_tool_calling } : info;
            });
          } catch (error: any) {
            problems.push(`${id}: ${redact(error?.message ?? String(error))}`);
            return [];
          } finally {
            clearTimeout(timer);
          }
        })
      );
      return { models: lists.flat(), problems };
    },

    fork(atEvent) {
      return SessionLog.fork(projectRoot, log.id, { atEvent, surface: options.surface }).id;
    },

    checkpoints: () => checkpoints.list(),
    previewCheckpoint: (n) => checkpoints.preview(n),
    restoreCheckpoint: (n) => checkpoints.restore(n),
    withCheckpoint: (label, change, files) => checkpoints.withCheckpoint(label, change, files),

    async draftCommitMessage(paths = [], signal) {
      const plan = planCommit(workRoot, paths);
      if (!plan.files.length) throw new Error('Nothing would be committed, so there is nothing to describe.');
      const message = cleanDraft(await completeOnce(draftPrompt(plan), { maxOutputTokens: 400, ...(signal ? { signal } : {}) }));
      if (!message) throw new Error('The model sent back an empty message.');
      return message;
    },

    complete: completeOnce,

    work: () => workTable.list(),
    watchWork: (listener) => workTable.watch(listener),
    stopWork: (id) => workTable.stop(id),
    workEvents: (id) => workTable.events(id),
    watchWorkEvents: (id, listener) => workTable.watchEvents(id, listener),
    sayToWork: (id, text) => workTable.say(id, text),
    note: (text) => recorder.recordNote(text),
    notes: () => log.events().flatMap((event) => (event.type === 'note' ? [{ text: event.text, ts: event.ts }] : [])),

    async close() {
      // Cancelling a turn leaves jobs running; closing the session that owns them stops them.
      if (!options.parent) workTable.stopAll();
      await writeHandoffNow('session_end').catch(() => undefined);
      await hookVerdict(hooks, 'session_end', { session, status: 'closed', turns });
      await mcp?.close?.();
      await lsp?.close();
      await observation?.close('closed');
    },
  };
}
