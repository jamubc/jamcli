import path from 'path';
import { CoreAgent } from '../agent.js';
import type { AgentEvent, JamSession, RunResult } from '../types.js';
import { createSession } from '../state.js';
import { createChatProvider } from '../providers/factory.js';
import type { ChatProvider } from '../providers/types.js';
import { applyRules, loadRules, rulesPromptText } from '../rules/index.js';
import { createHookBus, emitHookEvent, type HookBus } from '../hooks/index.js';
import { createRedactor } from '../redact.js';
import { SessionLog, TranscriptRecorder } from '../transcript/index.js';
import { createBuiltinRegistry } from '../tools/registry.js';
import { ConfigService } from '../../services/ConfigService.js';
import { McpManager } from '../../services/McpManager.js';
import { DEFAULT_AGENT_LOOP_CONFIG, DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';
import { createToolSet, registerMcpTools, type McpSource, type ToolSet, type ToolSummary } from './tools.js';
import { categoriesOf, childLauncher, type ParentSession } from './children.js';
import { sessionPermissions } from './permissions.js';
import type { PermissionFlags } from '../permissions/config.js';
import type { PermissionEngine } from '../permissions/engine.js';
import type { PermissionMode } from '../permissions/modes.js';
import { LOCAL_CONFIG, grantedRules, writeProjectGrant } from '../permissions/grants.js';
import { detectSandbox, type Sandbox, type SandboxKind, type SandboxSettings } from '../sandbox/index.js';
import { buildRuntimePrompt } from './prompt.js';
import { configuredSecrets, resolveModel, trustClassifier, type ModelChoice } from './model.js';
import { expandReferences } from './references.js';

export type { ToolSummary, McpSource } from './tools.js';

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
}

export interface Runtime {
  readonly sessionId: string;
  /** The provider and model turns run on. */
  readonly model: ModelChoice;
  /** What the model is offered, with schemas. */
  readonly tools: ToolSummary[];
  /** The conversation so far, as the next request will carry it. */
  readonly session: JamSession;
  /** Problems found while assembling, also reported as notices by the first turn. */
  readonly notices: string[];
  readonly permissionMode: PermissionMode;
  /** Where commands run: `bwrap`, `seatbelt`, or `none`, with the reason. */
  readonly sandbox: { kind: SandboxKind; reason: string };
  /** Switch permission modes for later calls. Returns why not, changing nothing, when the mode is unavailable. */
  setPermissionMode(mode: PermissionMode, options?: { bypassConfirmed?: boolean }): string | undefined;
  run(input: string, onEvent?: (event: AgentEvent) => void): Promise<RunResult>;
  cancel(): void;
  /** Switch the provider and model for later turns. Throws if the provider is not configured. */
  setModel(ref: string): void;
  /** Copy this session, up to an event, into a new one, and return the new id. */
  fork(atEvent?: number): string;
  close(): Promise<void>;
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

  const configService = options.configService ?? new ConfigService(projectRoot);
  await configService.initialize();
  const config = await configService.getConfig();
  const profile = await configService.getActiveProfile();
  const mcpConfig = await configService.getMcpConfig();
  const redact = createRedactor(env, configuredSecrets(config.api_registry, env));

  const registry = createBuiltinRegistry();
  const mcp = options.mcp === false ? undefined : (options.mcp ?? new McpManager({ configService }));
  const mcpServers = mcp ? await registerMcpTools(registry, mcp, notices) : undefined;
  const depth = options.parent ? options.parent.depth : 0;

  const sandbox = options.sandbox ?? detectSandbox({ projectRoot, settings: (config as { sandbox?: SandboxSettings }).sandbox });

  let permissions: PermissionEngine;
  if (options.parent) {
    permissions = options.parent.permissions;
  } else {
    const assembled = sessionPermissions({
      projectRoot,
      registry,
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
    configService,
    mcp,
    env: options.env,
    sandbox,
    parent: () => ({ sessionId: log.id, depth: depth + 1, permissions }),
    create: createRuntime,
  });
  const taskTool = registry.get('task');
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
      descriptions: taskTool
        ? { task: `${taskTool.description} Categories: ${Object.keys(categoriesOf(config)).join(', ')}.` }
        : undefined,
      context: () => ({
        projectRoot,
        ignorePatterns: mcpConfig.ignore_patterns,
        commandTimeoutMs: config.agent_loop?.command_timeout_ms ?? DEFAULT_AGENT_LOOP_CONFIG.command_timeout_ms,
        ...(sandbox.kind === 'none' ? {} : { wrapCommand: sandbox.wrap, sandboxNote: sandbox.note }),
        delegate: delegateChild,
        delegationDepth: depth,
        delegationConfig: config.delegation ?? DEFAULT_DELEGATION_CONFIG,
      }),
    });
  let toolSet = buildTools();

  const rules = applyRules(loadRules(projectRoot, cwd), undefined);
  const hooks: HookBus = createHookBus();
  const trust = trustClassifier(config);
  if (trust.note) notices.push(trust.note);
  const buildPrompt = () =>
    buildRuntimePrompt({ profile, rulesText: rulesPromptText(rules), tools: toolSet.summaries, projectRoot, cwd, mode: permissions.mode });
  let systemPrompt = buildPrompt();

  let choice = resolveModel(options.model, profile, config.api_registry);
  let provider: ChatProvider | undefined = options.provider;
  let providerError: string | undefined;
  if (!provider) {
    try {
      provider = createChatProvider(choice.provider, config.api_registry);
    } catch (error: any) {
      providerError = error?.message ?? String(error);
    }
  }

  const loop = config.agent_loop;
  const buildAgent = () =>
    new CoreAgent({
      provider,
      model: choice.model,
      temperature: profile.temperature,
      modelUsageKey: `${choice.provider}:${choice.model}`,
      dispatcher: toolSet.dispatcher,
      toolDefinitions: toolSet.definitions,
      maxSteps: options.maxSteps ?? loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
      maxToolCallsPerTurn: loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
      truncationLimit: loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
      systemPrompt,
      hooks,
      trustProvider: trust.provider,
      trustModel: trust.model,
      trustThreshold: config.trust?.threshold,
      trustOffNote: true,
      redact,
      signal: options.signal,
    });
  let agent = buildAgent();

  const log = options.sessionId
    ? SessionLog.open(projectRoot, options.sessionId)
    : SessionLog.create(projectRoot, {
        cwd,
        surface: options.surface,
        delegatedBy: options.parent?.sessionId,
        permissionMode: permissions.mode,
      });
  let session = options.sessionId ? log.toSession() : createSession(projectRoot, log.id);
  let emitting: ((event: AgentEvent) => void) | undefined;
  const recorder = new TranscriptRecorder(log, {
    surface: options.surface,
    model: `${choice.provider}:${choice.model}`,
    onError: (error) => emitting?.({ type: 'notice', level: 'error', message: `The session log could not be written: ${error.message}` }),
  });
  await emitHookEvent(hooks, 'session_start', { session, profile: config.active_profile });

  const pending = [...notices];
  let running = false;
  let turns = 0;

  return {
    get sessionId() {
      return log.id;
    },
    get model() {
      return { ...choice };
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

    setPermissionMode(mode, modeOptions) {
      const from = permissions.mode;
      const refusal = permissions.setMode(mode, modeOptions);
      if (refusal || from === mode) return refusal;
      // What is offered, and what the model is told, both depend on the mode.
      toolSet = buildTools();
      systemPrompt = buildPrompt();
      agent = buildAgent();
      recorder.switchPermissionMode(from, mode);
      return undefined;
    },

    async run(input, onEvent) {
      if (running) throw new Error('A turn is already running in this session.');
      running = true;
      const emit = (event: AgentEvent) => {
        recorder.handle(event);
        onEvent?.(event);
      };
      emitting = emit;
      try {
        for (const message of pending.splice(0)) emit({ type: 'notice', level: 'warn', message });
        if (!provider) {
          const error = providerError ?? 'No model provider is configured for this session.';
          emit({ type: 'notice', level: 'error', message: error });
          return { status: 'error', sessionId: log.id, response: '', turns: 0, usage: { ...session.usage }, error, session };
        }
        const expanded = await expandReferences(input, cwd, redact);
        for (const message of expanded.notices) emit({ type: 'notice', level: 'warn', message });
        turns += 1;
        const result = await agent.run(session, expanded.prompt, emit);
        if (result.session) session = result.session;
        return result;
      } finally {
        running = false;
        emitting = undefined;
      }
    },

    cancel() {
      agent.cancel(session.id);
    },

    setModel(ref) {
      const next = resolveModel(ref, profile, config.api_registry);
      provider = createChatProvider(next.provider, config.api_registry);
      providerError = undefined;
      choice = next;
      agent = buildAgent();
      recorder.switchModel(`${next.provider}:${next.model}`);
    },

    fork(atEvent) {
      return SessionLog.fork(projectRoot, log.id, { atEvent, surface: options.surface }).id;
    },

    async close() {
      await emitHookEvent(hooks, 'session_end', { session, status: 'closed', turns });
      await mcp?.close?.();
    },
  };
}
