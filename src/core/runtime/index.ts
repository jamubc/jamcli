import path from 'path';
import { CoreAgent } from '../agent.js';
import type { AgentEvent, RunResult, ToolCall } from '../types.js';
import { describeCall, previewCall } from '../approval.js';
import { cleanDraft, draftPrompt, planCommit } from '../git/commit.js';
import { createSession } from '../state.js';
import { prefixSetNow, type ChatProvider } from '../providers/types.js';
import { applyRules, loadRules, rulesPromptText } from '../rules/index.js';
import { createHookBus, hookVerdict, type HookBus } from '../hooks/index.js';
import { createRedactor } from '../redact.js';
import { SessionLog, TranscriptRecorder, newSessionId, typedPrompts } from '../transcript/index.js';
import { createBuiltinRegistry } from '../tools/registry.js';
import { DEFAULT_AGENT_LOOP_CONFIG, DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';
import { createToolSet, registerMcpTools, type ToolSet } from './tools.js';
import { childLauncher } from './children.js';
import { SessionCheckpoints } from './checkpoints.js';
import { SessionHooks } from './hooks.js';
import { Elicitations } from './elicit.js';
import { ToolOffer } from './offer.js';
import { registerSkills, sessionMcp, sessionPlugins } from './sources.js';
import { loadAgents, routableAgents } from '../ext/agents.js';
import { taskDescription } from '../tools/task.js';
import { pinnedState } from '../tools/plan.js';
import { readTodos, stampTodos } from '../tools/todo.js';
import { executeBatch, WaitingAsks } from '../tools/dispatch.js';
import { MAX_COMMAND_TIMEOUT_MS } from '../tools/command.js';
import { Ledger, detectGates, handoffDue, handoffNote, registerVerifyMiddleware, renderHandoff, runGate, writeHandoff, type GateRow, type HandoffReason } from '../verify/index.js';
import { effortFor, thinkingFor } from '../routing/capabilities.js';
import { RuleEditor, sessionPermissions } from './permissions.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { PermissionMode } from '../permissions/modes.js';
import { WorkTable, workNews } from '../work.js';
import { parseRule } from '../permissions/rules.js';
import { detectSandbox, subprocessEnv, type SandboxSettings } from '../sandbox/index.js';
import { buildRuntimePrompt } from './prompt.js';
import { registerSteerMiddleware } from './steer.js';
import { describeGates } from '../verify/index.js';
import { SessionModel, configuredSecrets, keyVariables, listModels } from './model.js';
import { expandReferences } from './references.js';
import { skillInstructions, skillsPromptText } from '../ext/skills.js';
import { lessonFor, reflectionTools } from '../reflection/index.js';
import { DEFAULT_TOOL_SEARCH_THRESHOLD, toolSearchTool } from '../tools/toolSearch.js';
import { formatDiagnostic, LspManager } from '../lsp/manager.js';
import { lspTool } from '../tools/lsp.js';
import { webSearchTool } from '../tools/web/index.js';
import { SearchProviders } from '../tools/web/providers.js';
import { ModelCatalog, requestedOutputTokens } from '../catalog/index.js';
import { CostLedger } from '../catalog/cost.js';
import { TokenCounter, contextBudget } from '../context/index.js';
import { loadConfig, permissionLayers, type LoadedConfig } from '../config/load.js';
import { revealedKeys } from '../config/credentials.js';
import { observerFor } from '../observe/setup.js';
import { instrumentProvider } from '../observe/instrument.js';
import { exportTarget, otlpExporter } from '../observe/otlp.js';
import { observeSession, type SessionObservation } from '../observe/session.js';
import type { Observer } from '../observe/observer.js';

export type { ToolSummary, McpSource } from './tools.js';
export type { CheckpointInfo } from './checkpoints.js';
export type { EditableRuleScope } from './permissions.js';
export type * from './types.js';
import type { DryRunEntry, Runtime, RuntimeOptions, Thinking } from './types.js';

/** How long a provider has to list its models. */
const LIST_TIMEOUT_MS = 5_000;

/** Where the `models` block came from, for the catalog's messages: its file when only one layer sets it. */
function modelsLabel(settings: LoadedConfig): string {
  const labels = new Set([...settings.origins].filter(([key]) => key === 'models' || key.startsWith('models[') || key.startsWith('models.')).map(([, label]) => label));
  return labels.size === 1 ? `${[...labels][0]} models` : 'models';
}

/**
 * The one place a session is assembled. Every surface gets the same provider, tools,
 * policy, rules, hooks, redaction, and session log from here, and differs
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
  // Only the interface can put a question to the person, and only while a turn runs there.
  const elicitations = new Elicitations({ canAsk: options.surface === 'tui', emit: () => emitting });
  // Skills are listed by name and description; the skill tool loads one when asked.
  const skillSet = registerSkills(registry, projectRoot, (rules, label) => {
    permissions.narrow(rules, label);
    return permissions.narrowed?.rules ?? [];
  });
  notices.push(...skillSet.notices);
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
  const { plugins, notices: pluginNotices } = await sessionPlugins({ projectRoot, verify: !options.parent, sandboxSettings, envFor });
  notices.push(...pluginNotices);
  const mcp = await sessionMcp({
    given: options.mcp,
    projectRoot,
    servers: mcpConfig.servers ?? [],
    pluginServers: plugins.servers,
    env,
    envFor,
    elicit: elicitations.ask,
  });
  const mcpServers = mcp ? await registerMcpTools(registry, mcp, notices) : undefined;
  // Past a threshold, MCP tools are offered through search_tools rather than in every request;
  // so is the extended tier of built-ins when the model's window has no room for it.
  const offer = new ToolOffer({ registry, mcpServers, searchThreshold: config.tool_search?.threshold ?? DEFAULT_TOOL_SEARCH_THRESHOLD, toolSet: () => toolSet });
  registry.register({ ...toolSearchTool({ deferred: () => offer.searchList(), load: (names) => offer.load(names) }), hidden: true });
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
  /** What waits on an answer in this session, across its steps and rebuilds, so one answer settles every identical ask. */
  const waitingAsks = new WaitingAsks();
  // Loaded once, so the agents the model is shown and the routing it gets stay in step.
  const agents = loadAgents(projectRoot, config);
  notices.push(...agents.problems);
  const delegateChild = childLauncher({
    projectRoot,
    config,
    agents,
    mcp,
    env: options.env,
    sandbox,
    parent: () => ({ sessionId: log.id, depth: depth + 1, permissions, work: workTable, model: sessionModel.ref }),
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
  const grantProject = (text: string, how?: string) => {
    const problem = ruleEditor.grantProject(text, how);
    if (problem) emitting?.({ type: 'notice', level: 'warn', message: problem });
  };
  const buildTools = (): ToolSet => {
    const anySearchable = registry.visible().some((tool) => permissions.offers(tool.name) && offer.searchable(tool.name));
    return createToolSet({
      registry,
      mcpServers,
      permissions,
      alsoOffer: [...turnOffer, ...(anySearchable ? ['search_tools'] : [])],
      grantProject,
      deferred: (name: string) => offer.deferred(name),
      ...(options.dryRun ? { dryRun: recordDryRun } : {}),
      descriptions: {
        ...(taskTool ? { task: taskDescription(routableAgents(agents.agents, config.api_registry), agents.defaultAgent) } : {}),
        ...options.toolDescriptions,
      },
      context: () => ({
        projectRoot: workRoot,
        ignorePatterns: mcpConfig.ignore_patterns,
        commandTimeoutMs: config.agent_loop?.command_timeout_ms ?? DEFAULT_AGENT_LOOP_CONFIG.command_timeout_ms,
        env: commandEnv,
        ...(sandbox.kind === 'none' ? {} : { wrapCommand: sandbox.wrap, sandboxNote: sandbox.note }),
        delegate: delegateChild,
        work: workTable,
        delegationDepth: depth,
        // A block that sets only some limits keeps the defaults for the rest.
        delegationConfig: { ...DEFAULT_DELEGATION_CONFIG, ...config.delegation },
        ...(options.editor ? { editor: options.editor } : {}),
        // Only the interface can put a question to the person; elsewhere ask_user says so.
        ...(options.surface === 'tui' ? { elicit: elicitations.ask } : {}),
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
      offer.afterCall(call.name);
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
  // The trust gate was removed on 2026-09-29; a configuration that still names its classifier is told once.
  if (config.trust?.model && !options.parent) {
    notices.push(`${settings.origins.get('trust.model') ?? 'The configuration'} sets trust.model, but the trust gate was removed, so nothing screens tool output. The sandbox and the network rules are what hold auto mode.`);
  }
  // An agent's rules come before the project's, so a project's AGENTS.md has the last word.
  const agentRulesText = options.agentRules
    ? `Rules for the ${options.agentRules.agent} agent, from ${options.agentRules.source}:\n${options.agentRules.text}`
    : undefined;
  if (options.agentRules) notices.push(`This run follows the ${options.agentRules.agent} agent's rules from ${options.agentRules.source}.`);
  // Chosen before the provider, which may send it: some route and cache per conversation.
  const sessionId = options.sessionId ?? newSessionId();
  const sessionModel = new SessionModel({
    catalog,
    registry: config.api_registry,
    profile,
    sessionId,
    ref: options.model ?? config.model,
    ...(options.provider ? { provider: options.provider } : {}),
    observe: (target, name) => observed(target, name),
  });
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
      model: sessionModel.ref,
    });
  let systemPrompt = buildPrompt();
  /** Whether the extended tier fits the model's window, decided once the window is known; true when that changed. */
  const decideTiers = (): boolean => offer.decideTiers(systemPrompt, budgetFor(), windowKnown());

  const loop = config.agent_loop;
  /** Learns how the provider counts this session's requests, across model switches. */
  const counter = new TokenCounter();
  const autoCompact = config.context?.auto_compact !== false;
  const budgetFor = () => contextBudget(sessionModel.info.contextWindow, requestedOutputTokens(sessionModel.info, loop?.max_output_tokens));
  /**
   * When the request's prefix was last set: this process's start, a change of system prompt
   * or tools, or a compaction. Signed reasoning from before it is not replayed.
   */
  let reasoningSince = prefixSetNow();
  /** A guessed window is not compacted ahead of. */
  const windowKnown = () => sessionModel.windowKnown;
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
      provider: sessionModel.provider,
      model: sessionModel.choice.model,
      temperature: profile.temperature,
      ...(thinking.reasoning ? { reasoning: thinking.reasoning } : {}),
      ...(thinking.effort ? { effort: effortFor(thinking.effort, sessionModel.info.efforts), acceptsEffort: sessionModel.info.effort } : {}),
      modelUsageKey: sessionModel.ref,
      maxOutputTokens: requestedOutputTokens(sessionModel.info, loop?.max_output_tokens),
      context: { budget: budgetFor(), counter, auto: autoCompact, proactive: windowKnown() },
      // Only Ollama sizes its window per request; the others ignore it.
      contextLength: sessionModel.info.contextWindow,
      dispatcher: toolSet.dispatcher,
      waiting: waitingAsks,
      toolDefinitions: toolSet.definitions,
      maxSteps: options.maxSteps ?? loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
      // A child out of steps still reports what it found; the parent would otherwise redo it.
      ...(options.surface === 'child' ? { wrapUpOnLimit: true } : {}),
      maxToolCallsPerTurn: loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
      truncationLimit: loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
      systemPrompt,
      hooks,
      price: sessionModel.info.price,
      thinkingStyle: sessionModel.info.thinking,
      alwaysThinks: sessionModel.info.alwaysThinks,
      reasoningSince,
      redact,
      signal: options.signal,
      pinned: pinnedWithGates,
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
    model: sessionModel.ref,
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
      const batch = await executeBatch([call], { dispatcher: toolSet.dispatcher, emit, signal: gateController.signal, projectRoot: workRoot, session, hooks, redact, waiting: waitingAsks });
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
  });
  registerSteerMiddleware(hooks, {
    projectRoot: workRoot,
    modeWouldAsk: (call) => {
      const verdict = permissions.decide(call);
      return verdict.decision === 'ask' && verdict.by === 'mode';
    },
    emit: (event) => emitting?.(event),
  });
  /** The handoff, rendered from the log. A reset the person asked for is not overwritten by the session's end. */
  const writeHandoffNow = async (reason: HandoffReason): Promise<{ path: string; bytes: number } | undefined> => {
    if (options.parent) return undefined;
    const events = log.events();
    if (!handoffDue(events, reason)) return undefined;
    const todos = await readTodos({ projectRoot: workRoot });
    const written = writeHandoff(workRoot, renderHandoff(events, todos, { sessionId: log.id, reason }));
    recorder.handle({ type: 'handoff', ...written, reason });
    return written;
  };
  hooks.on('compaction', ({ strategy }) => (strategy === 'drop' ? writeHandoffNow('drop').then(() => undefined) : undefined), 'handoff on drop', { internal: true });
  hooks.on('pre_compact', () => ({ context: ['The todo list and the gate results are pinned after the summary; do not restate them.'] }), 'M6 pinned note', { internal: true });
  // A handoff the last session left for this one reaches the model with the first prompt, within a fixed budget.
  const handoff = !options.sessionId && !options.parent ? handoffNote(workRoot, log.id) : undefined;
  if (handoff) {
    turnNotes.push(handoff.note);
    const off = hooks.on(
      'turn_start',
      () => {
        emitting?.({ type: 'steer', handler: 'M1', detail: `handoff from session ${handoff.session} read with the first prompt` });
        off();
      },
      'handoff read',
      { internal: true }
    );
    notices.push(`The handoff session ${handoff.session} left in .jamcli/handoff.md reaches the model with the first prompt.`);
  }
  /** One request outside the conversation, counted and priced like the session's others. */
  async function completeOnce(prompt: string, request: { maxOutputTokens?: number; signal?: AbortSignal } = {}): Promise<string> {
    const { content, usage } = await sessionModel.complete(prompt, request);
    if (usage) {
      const event: AgentEvent = { type: 'usage', ...usage };
      account(event);
      recorder.handle(event);
    }
    return content;
  }


  observation = observeSession(observer, {
    sessionId: log.id,
    surface: options.surface,
    provider: sessionModel.choice.provider,
    model: sessionModel.choice.model,
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
    const asked = sessionModel.ref;
    try {
      const info = await sessionModel.resolve();
      if (!info) return;
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
      pending.push(`The details of ${asked} could not be read: ${error?.message ?? error}`);
    }
  };
  let modelReady = resolveModelInfo();

  /** Switch the provider and model for later turns. Throws if the provider is not configured. */
  const switchModel = (ref: string) => {
    const before = sessionModel.switch(ref);
    const after = sessionModel.ref;
    // The prompt names the model, so the switch rebuilds it; the model reads the change with its next prompt.
    reassemble();
    recorder.switchModel(after);
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
      return sessionModel.choice;
    },
    get modelInfo() {
      return sessionModel.info;
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
        await modelReady;
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
          const before = sessionModel.ref;
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
        await modelReady;
        for (const message of pending.splice(0)) emit({ type: 'notice', level: 'warn', message });
        // A command typed after `!` needs no model, and its text is not a prompt to expand.
        if (!sessionModel.provider && !turn.shell && !turn.tool) {
          const error = sessionModel.providerError ?? 'No model provider is configured for this session.';
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
      elicitations.cancelAll();
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

    listModels: (timeoutMs = LIST_TIMEOUT_MS) => listModels(catalog, config.api_registry, redact, timeoutMs),

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
    prompt: (text, state) => recorder.recordPrompt(text, state),
    prompts: () => typedPrompts(log.events()),
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
