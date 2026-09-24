import path from 'path';
import { CoreAgent } from '../agent.js';
import type { AgentEvent, ApprovalPreview, JamSession, RunResult, ToolCall } from '../types.js';
import { describeCall, previewCall } from '../approval.js';
import { CheckpointStore, filesOfCall, type Checkpoint, type RestorePreview } from '../git/checkpoints.js';
import { createSession } from '../state.js';
import { createChatProvider, listConfiguredProviders } from '../providers/factory.js';
import { isListableProvider, prefixSetNow, type ChatProvider } from '../providers/types.js';
import { applyRules, loadRules, rulesPromptText } from '../rules/index.js';
import { createHookBus, emitHookEvent, type HookBus } from '../hooks/index.js';
import { createRedactor } from '../redact.js';
import { SessionLog, TranscriptRecorder, ensureProjectStateDir } from '../transcript/index.js';
import { createBuiltinRegistry } from '../tools/registry.js';
import type { ConfigService } from '../../services/ConfigService.js';
import { DEFAULT_AGENT_LOOP_CONFIG, DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';
import { createToolSet, registerMcpTools, type McpSource, type ToolSet, type ToolSummary } from './tools.js';
import { categoriesOf, childLauncher, type ParentSession } from './children.js';
import { sessionPermissions } from './permissions.js';
import type { PermissionFlags } from '../permissions/config.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { PermissionMode } from '../permissions/modes.js';
import { LOCAL_CONFIG, editRuleList, grantedRules, writeProjectGrant } from '../permissions/grants.js';
import { parseRule, type Decision, type Rule, type RuleScope } from '../permissions/rules.js';
import { detectSandbox, subprocessEnv, type Sandbox, type SandboxKind, type SandboxSettings } from '../sandbox/index.js';
import { buildRuntimePrompt } from './prompt.js';
import { configuredSecrets, keyVariables, resolveModel, trustClassifier, type ModelChoice } from './model.js';
import { expandReferences } from './references.js';
import { ModelCatalog, requestedOutputTokens, type ModelInfo } from '../catalog/index.js';
import { CostLedger, type SpendSummary } from '../catalog/cost.js';
import { TokenCounter, contextBudget } from '../context/index.js';
import { displayPath, loadConfig, localConfigFile, permissionLayers, projectConfigFile, userConfigFile, type LoadedConfig } from '../config/load.js';
import { revealedKeys } from '../config/credentials.js';
import { observerFor, type ObserveSettings } from '../observe/setup.js';
import { instrumentProvider } from '../observe/instrument.js';
import { exportTarget, otlpExporter } from '../observe/otlp.js';
import { observeSession, type SessionObservation } from '../observe/session.js';
import type { Observer, Span } from '../observe/observer.js';

export type { ToolSummary, McpSource } from './tools.js';

/** Where a person may add a rule: for this session, or in one of the configuration files. */
export type EditableRuleScope = 'session' | 'local' | 'project' | 'user';
const EDITABLE: RuleScope[] = ['session', 'local', 'project', 'user'];
/** How long a provider has to list its models. */
const LIST_TIMEOUT_MS = 5_000;
/** The per-tool block of the legacy MCP file, whose rules are edited in that file. */
const LEGACY_TOOLS_FILE = '.jamcli/mcp.json';

/** The surface a runtime serves. It is recorded with every decision in the session log. */
export type Surface = 'tui' | 'headless' | 'acp' | 'workflow' | 'child';

export interface RuntimeOptions {
  projectRoot: string;
  /** Where `@` references resolve. Defaults to the project root. */
  cwd?: string;
  surface: Surface;
  /** Continue this session. It must exist. */
  sessionId?: string;
  /** `provider:model`, or a model on the profile's provider. */
  model?: string;
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
  /** Log level and files, from `-v`, `--log-file`, and `--trace-file`. The environment is read when absent. */
  observe?: ObserveSettings;
  /** Record into this observer instead, under `parentSpan`: a delegated run shares its parent's. */
  observer?: { observer: Observer; parentSpan?: Span };
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

export interface Runtime {
  readonly sessionId: string;
  /** The provider and model turns run on. */
  readonly model: ModelChoice;
  /** What the catalog knows about that model: its limits, capabilities, and prices, and where each came from. */
  readonly modelInfo: ModelInfo;
  /** What the session has cost so far, by model, with requests that had no known price counted apart. */
  spend(): SpendSummary;
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
  run(input: string, onEvent?: (event: AgentEvent) => void): Promise<RunResult>;
  cancel(): void;
  /** Switch the provider and model for later turns. Throws if the provider is not configured. */
  setModel(ref: string): void;
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
  close(): Promise<void>;
}

/** A checkpoint as the session log records it, numbered from 1. */
export interface CheckpointInfo extends Checkpoint {
  n: number;
  label: string;
  ts: number;
  /** Where the turn that made the change began, for forking the conversation back to it. */
  turn?: number;
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
  const cwd = path.resolve(options.cwd ?? projectRoot);
  const env = options.env ?? process.env;
  const notices: string[] = [];

  const settings = loadConfig({ projectRoot, env });
  notices.push(...settings.errors);
  const { config, profile, mcp: mcpConfig } = settings;
  const redact = createRedactor(env, configuredSecrets(config.api_registry, env), revealedKeys);
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
  const withheld = keyVariables(config.api_registry);
  /** Every process the session starts inherits this, with no credential unless one is named. */
  const envFor = (passthrough: string[] = [], values?: Record<string, string>) =>
    subprocessEnv(env, {
      policy: sandboxSettings.env,
      passthrough: [...(sandboxSettings.env_passthrough ?? []), ...passthrough],
      withheld,
      extra: values,
    });

  const registry = createBuiltinRegistry();
  // The MCP client is loaded only when a server is configured: it is the heaviest import a
  // session would otherwise make for nothing.
  const serversConfigured = (mcpConfig.servers ?? []).some((server) => server.enabled !== false);
  const mcp: McpSource | undefined =
    options.mcp === false
      ? undefined
      : (options.mcp ??
        (serversConfigured
          ? new (await import('../../services/McpManager.js')).McpManager({
              // The legacy configuration service loads only when an MCP server needs it.
              configService: options.configService ?? new (await import('../../services/ConfigService.js')).ConfigService(projectRoot),
              envFor: (server) => envFor(server.env_passthrough, server.env),
            })
          : undefined));
  const mcpServers = mcp ? await registerMcpTools(registry, mcp, notices) : undefined;
  const depth = options.parent ? options.parent.depth : 0;

  const sandbox = options.sandbox ?? detectSandbox({ projectRoot, settings: sandboxSettings });
  // Inside bubblewrap, /tmp is the sandbox's own, so a temporary directory elsewhere would not exist.
  const commandEnv = { ...envFor(), ...(sandbox.kind === 'bwrap' ? { TMPDIR: '/tmp' } : {}) };

  let permissions: PermissionEngine;
  if (options.parent) {
    permissions = options.parent.permissions;
  } else {
    const assembled = sessionPermissions({
      projectRoot,
      registry,
      layers: permissionLayers(settings),
      legacyTools: mcpConfig.tools,
      flags: { allowTools: options.allowTools, denyTools: options.denyTools, ...options.permissions },
      bypass: options.bypassPermissions,
      sandboxed: sandbox.kind !== 'none',
      env,
    });
    permissions = assembled.engine;
    notices.push(...assembled.notices);
  }

  const delegateChild = childLauncher({
    projectRoot,
    config,
    ...(options.configService ? { configService: options.configService } : {}),
    mcp,
    env: options.env,
    sandbox,
    parent: () => ({ sessionId: log.id, depth: depth + 1, permissions }),
    create: createRuntime,
    // While a turn runs, a child's request reaches this session's surface too; a background
    // child that outlives the turn is still counted and recorded.
    onUsage: (event) => (emitting ? emitting(event) : (account(event), recorder.handle(event))),
    observer: () => ({ observer, parentSpan: observation?.current() }),
  });
  const taskTool = registry.get('task');
  const dryRunReport: DryRunEntry[] = [];
  const recordDryRun = (call: ToolCall) => {
    const preview = previewCall(call, projectRoot);
    dryRunReport.push({ callId: call.id, tool: call.name, summary: describeCall(call), ...(preview ? { preview } : {}) });
  };
  /** A project grant applies at once and is written for later sessions. */
  const grantProject = (text: string) => {
    const { rules, errors } = grantedRules(text, 'local', `${LOCAL_CONFIG} permissions.allow (granted at a prompt)`);
    if (errors.length) {
      emitting?.({ type: 'notice', level: 'warn', message: `The grant was not saved: ${errors.join(' ')}` });
      return;
    }
    try {
      writeProjectGrant(projectRoot, rules.map((rule) => rule.text));
      for (const rule of rules) permissions.add(rule);
    } catch (error: any) {
      emitting?.({ type: 'notice', level: 'warn', message: error?.message ?? String(error) });
      for (const rule of rules) permissions.add({ ...rule, scope: 'session' });
    }
  };
  const buildTools = (): ToolSet =>
    createToolSet({
      registry,
      mcpServers,
      permissions,
      grantProject,
      ...(options.dryRun ? { dryRun: recordDryRun } : {}),
      descriptions: taskTool
        ? { task: `${taskTool.description} Categories: ${Object.keys(categoriesOf(config)).join(', ')}.` }
        : undefined,
      context: () => ({
        projectRoot,
        ignorePatterns: mcpConfig.ignore_patterns,
        commandTimeoutMs: config.agent_loop?.command_timeout_ms ?? DEFAULT_AGENT_LOOP_CONFIG.command_timeout_ms,
        env: commandEnv,
        ...(sandbox.kind === 'none' ? {} : { wrapCommand: sandbox.wrap, sandboxNote: sandbox.note }),
        delegate: delegateChild,
        delegationDepth: depth,
        delegationConfig: config.delegation ?? DEFAULT_DELEGATION_CONFIG,
      }),
    });
  let toolSet = buildTools();

  const rules = applyRules(loadRules(projectRoot, cwd), undefined);
  const hooks: HookBus = createHookBus({ onRun: (run) => observation?.hookRun(run) });
  /** A provider whose requests are timed and logged under the current turn. */
  const observed = (target: ChatProvider, name: string, purpose?: string) =>
    instrumentProvider(target, { observer, providerName: name, parent: () => observation?.current(), purpose, includeContent });
  const trust = trustClassifier(config);
  if (trust.note) notices.push(trust.note);
  if (trust.provider && trust.choice) trust.provider = observed(trust.provider, trust.choice.provider, 'trust');
  const buildPrompt = () =>
    buildRuntimePrompt({ profile, rulesText: rulesPromptText(rules), tools: toolSet.summaries, projectRoot, cwd, mode: permissions.mode });
  let systemPrompt = buildPrompt();

  let choice = resolveModel(options.model ?? config.model, profile, config.api_registry);
  let provider: ChatProvider | undefined = options.provider;
  let providerError: string | undefined;
  if (!provider) {
    try {
      provider = createChatProvider(choice.provider, config.api_registry);
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
  const buildAgent = () =>
    new CoreAgent({
      provider,
      model: choice.model,
      temperature: profile.temperature,
      modelUsageKey: `${choice.provider}:${choice.model}`,
      maxOutputTokens: requestedOutputTokens(modelInfo, loop?.max_output_tokens),
      context: { budget: budgetFor(), counter, auto: autoCompact, proactive: windowKnown() },
      // Only Ollama sizes its window per request; the others ignore it.
      contextLength: modelInfo.contextWindow,
      dispatcher: toolSet.dispatcher,
      toolDefinitions: toolSet.definitions,
      maxSteps: options.maxSteps ?? loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
      maxToolCallsPerTurn: loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
      truncationLimit: loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
      systemPrompt,
      hooks,
      trustProvider: trust.provider,
      trustModel: trust.model,
      trustUsageKey: trustKey,
      trustPrice: trustInfo?.price,
      price: modelInfo.price,
      thinkingStyle: modelInfo.thinking,
      alwaysThinks: modelInfo.alwaysThinks,
      reasoningSince,
      trustThreshold: config.trust?.threshold,
      trustOffNote: true,
      redact,
      signal: options.signal,
      // A delegated run shares the working copy; the checkpoint before its task call covers it.
      ...(options.surface === 'child' ? {} : { beforeChange: takeCheckpoint, afterChange: settleCheckpoint }),
    });
  let agent = buildAgent();
  /** What is offered, and what the model is told, depend on the mode and the rules. */
  const reassemble = () => {
    toolSet = buildTools();
    systemPrompt = buildPrompt();
    reasoningSince = prefixSetNow();
    agent = buildAgent();
  };
  /** The file a rule of a scope is saved in, and how messages name it. */
  const ruleFile = (scope: Exclude<EditableRuleScope, 'session'>) => {
    const file = scope === 'user' ? userConfigFile() : scope === 'project' ? projectConfigFile(projectRoot) : localConfigFile(projectRoot);
    return { file, label: displayPath(file, projectRoot) };
  };

  const log = options.sessionId
    ? SessionLog.open(projectRoot, options.sessionId)
    : SessionLog.create(projectRoot, {
        cwd,
        surface: options.surface,
        delegatedBy: options.parent?.sessionId,
        permissionMode: permissions.mode,
      });
  let session = options.sessionId ? log.toSession() : createSession(projectRoot, log.id);
  /** A continued session keeps what it cost before, as each request was priced then. */
  const ledger = options.sessionId ? CostLedger.fromEvents(log.events()) : new CostLedger();
  const account = (event: AgentEvent) => {
    if (event.type === 'usage') ledger.record({ model: event.model, usage: event.usage, cost: event.cost, delegated: Boolean(event.delegatedSession) });
    // The agent that compacted moved its own; later agents start from here.
    if (event.type === 'compaction') reasoningSince = prefixSetNow();
  };
  let emitting: ((event: AgentEvent) => void) | undefined;
  const recorder = new TranscriptRecorder(log, {
    surface: options.surface,
    model: `${choice.provider}:${choice.model}`,
    onError: (error) => emitting?.({ type: 'notice', level: 'error', message: `The session log could not be written: ${error.message}` }),
  });
  const checkpointStore = new CheckpointStore(projectRoot, log.id);
  let checkpointsFailed = false;
  /** The step's checkpoint, taken before its first change and recorded once the step is done. */
  let stepCheckpoint: { taken: Checkpoint; label: string } | undefined;
  const checkpointsOff = (error: any) => {
    checkpointsFailed = true;
    stepCheckpoint = undefined;
    emitting?.({ type: 'notice', level: 'warn', message: `Checkpoints are off for this session, so /undo cannot restore its changes: ${error?.message ?? error}` });
  };
  /** Before a step's first change: a checkpoint of the working copy. */
  async function takeCheckpoint(call: ToolCall): Promise<void> {
    if (checkpointsFailed) return;
    const label = describeCall(call);
    try {
      const taken = await checkpointStore.take(label, filesOfCall(call, projectRoot));
      stepCheckpoint = taken ? { taken, label } : undefined;
    } catch (error: any) {
      checkpointsOff(error);
    }
  }
  /** Once the step is done: what it changed, recorded in the log; a step that changed nothing leaves no checkpoint. */
  async function settleCheckpoint(): Promise<void> {
    const pending = stepCheckpoint;
    stepCheckpoint = undefined;
    if (!pending) return;
    try {
      const after = await checkpointStore.settle(pending.taken, pending.label);
      if (pending.taken.kind === 'git' && !after) return;
      const { taken, label } = pending;
      recorder.recordCheckpoint({ ref: taken.ref, ...(taken.files ? { files: taken.files } : {}), ...(after ? { after } : {}), label });
    } catch (error: any) {
      checkpointsOff(error);
    }
  }
  const checkpointList = (): CheckpointInfo[] =>
    log
      .events()
      .filter((event): event is Extract<typeof event, { type: 'checkpoint' }> => event.type === 'checkpoint')
      .map((event, index) => ({
        n: index + 1,
        ref: event.ref,
        kind: event.files ? 'files' : 'git',
        ...(event.files ? { files: event.files } : {}),
        ...(event.after ? { after: event.after } : {}),
        label: event.label ?? 'a change',
        ts: event.ts,
        ...(event.turn !== undefined ? { turn: event.turn } : {}),
      }));
  /** A change the person asked for, between two checkpoints, recorded like a step's. */
  async function withCheckpoint<T>(label: string, change: () => Promise<T>, files: string[] = []): Promise<T> {
    if (running) throw new Error('A turn is running; wait for it to end.');
    const before = await checkpointStore.take(label, files);
    const result = await change();
    const after = before ? await checkpointStore.settle(before, label) : undefined;
    if (before && (before.kind === 'files' || after)) recorder.recordCheckpoint({ ref: before.ref, ...(before.files ? { files: before.files } : {}), ...(after ? { after } : {}), label });
    return result;
  }
  const checkpointNumbered = (n: number): CheckpointInfo => {
    const found = checkpointList().find((entry) => entry.n === n);
    if (!found) throw new Error(`This session has no checkpoint ${n}.`);
    return found;
  };

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
  await emitHookEvent(hooks, 'session_start', { session, profile: config.active_profile });

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
      agent = buildAgent();
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
  const trustReady = trust.choice
    ? catalog.resolve(trust.choice.provider, trust.choice.model, trust.provider).then(
        (info) => {
          trustInfo = info;
          agent = buildAgent();
        },
        () => undefined
      )
    : Promise.resolve();

  return {
    get sessionId() {
      return log.id;
    },
    get model() {
      return { ...choice };
    },
    get modelInfo() {
      return modelInfo;
    },
    spend() {
      return ledger.summary();
    },
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
    get permissionMode() {
      return permissions.mode;
    },
    sandbox: { kind: sandbox.kind, reason: sandbox.reason },
    dryRunReport,

    setPermissionMode(mode, modeOptions) {
      const from = permissions.mode;
      const refusal = permissions.setMode(mode, modeOptions);
      if (refusal || from === mode) return refusal;
      reassemble();
      recorder.switchPermissionMode(from, mode);
      return undefined;
    },

    permissionRules() {
      return permissions.list();
    },

    addPermissionRule(decision, text, scope) {
      if (running) return 'A turn is running; change rules when it ends.';
      const target = scope === 'session' ? undefined : ruleFile(scope);
      const parsed = parseRule(text, decision, scope, target ? `${target.label} permissions.${decision}` : 'added in this session');
      if ('error' in parsed) return parsed.error;
      if (target) {
        try {
          if (scope !== 'user') ensureProjectStateDir(projectRoot);
          editRuleList(target.file, target.label, decision, [parsed.rule.text], 'add');
        } catch (error: any) {
          return error?.message ?? String(error);
        }
      }
      permissions.add(parsed.rule);
      reassemble();
      return undefined;
    },

    removePermissionRule(text) {
      if (running) return { removed: [], kept: [], error: 'A turn is running; change rules when it ends.' };
      const wanted = text.trim();
      const editable = (rule: Rule) => EDITABLE.includes(rule.scope) && !rule.source.startsWith(LEGACY_TOOLS_FILE);
      const matching = permissions.list().filter((rule) => rule.text === wanted);
      const kept = matching.filter((rule) => !editable(rule));
      try {
        for (const rule of matching.filter(editable)) {
          if (rule.scope === 'session') continue;
          const target = ruleFile(rule.scope as Exclude<EditableRuleScope, 'session'>);
          editRuleList(target.file, target.label, rule.decision, [rule.text], 'remove');
        }
      } catch (error: any) {
        return { removed: [], kept, error: error?.message ?? String(error) };
      }
      const removed = permissions.remove((rule) => rule.text === wanted && editable(rule));
      if (removed.length) reassemble();
      return { removed, kept };
    },

    async run(input, onEvent) {
      if (running) throw new Error('A turn is already running in this session.');
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
        for (const message of pending.splice(0)) emit({ type: 'notice', level: 'warn', message });
        if (!provider) {
          const error = providerError ?? 'No model provider is configured for this session.';
          emit({ type: 'notice', level: 'error', message: error });
          return { status: 'error', sessionId: log.id, response: '', turns: 0, usage: { ...session.usage }, error, session };
        }
        const expanded = await expandReferences(input, cwd, redact);
        for (const message of expanded.notices) emit({ type: 'notice', level: 'warn', message });
        turns += 1;
        turnAgent = agent;
        observation?.startTurn(expanded.prompt);
        let result: RunResult | undefined;
        try {
          result = await turnAgent.run(session, expanded.prompt, emit);
        } catch (error) {
          observation?.endTurn(undefined, error);
          throw error;
        }
        observation?.endTurn(result);
        if (result.session) session = result.session;
        return result;
      } finally {
        running = false;
        emitting = undefined;
        turnAgent = undefined;
      }
    },

    cancel() {
      (turnAgent ?? agent).cancel(session.id);
    },

    setModel(ref) {
      const next = resolveModel(ref, profile, config.api_registry);
      provider = observed(createChatProvider(next.provider, config.api_registry), next.provider);
      providerError = undefined;
      choice = next;
      modelInfo = catalog.lookup(next.provider, next.model, provider.family);
      agent = buildAgent();
      recorder.switchModel(`${next.provider}:${next.model}`);
      modelReady = resolveModelInfo();
    },

    async listModels(timeoutMs = LIST_TIMEOUT_MS) {
      const problems: string[] = [];
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
              const info = catalog.lookup(id, entry.id, listed.family);
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

    checkpoints: checkpointList,

    async previewCheckpoint(n) {
      return checkpointStore.preview(checkpointNumbered(n));
    },

    async restoreCheckpoint(n) {
      const target = checkpointNumbered(n);
      // What the restore replaces is checkpointed like a step's change, so it can be undone too.
      return withCheckpoint(`before restoring checkpoint ${n}`, () => checkpointStore.restore(target), target.files ?? []);
    },

    withCheckpoint,

    async close() {
      await emitHookEvent(hooks, 'session_end', { session, status: 'closed', turns });
      await mcp?.close?.();
      await observation?.close('closed');
    },
  };
}
