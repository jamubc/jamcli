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
import { DEFAULT_AGENT_LOOP_CONFIG } from '../../types/config.js';
import { createToolSet, registerMcpTools, type McpSource, type ToolSummary } from './tools.js';
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
  maxSteps?: number;
  signal?: AbortSignal;
  /** Serve this provider instead of building one from configuration. */
  provider?: ChatProvider;
  /** Where MCP tools come from; `false` offers none. Defaults to the configured servers. */
  mcp?: McpSource | false;
  /** The environment credentials are redacted from. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
  configService?: ConfigService;
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
  const toolSet = createToolSet({
    registry,
    mcpServers,
    permissions: mcpConfig.tools,
    allowTools: options.allowTools,
    denyTools: options.denyTools,
    context: () => ({
      projectRoot,
      ignorePatterns: mcpConfig.ignore_patterns,
      commandTimeoutMs: config.agent_loop?.command_timeout_ms ?? DEFAULT_AGENT_LOOP_CONFIG.command_timeout_ms,
    }),
  });
  for (const name of toolSet.policy.unknownFlags) notices.push(`No tool is named ${name}, so the flag naming it has no effect.`);

  const rules = applyRules(loadRules(projectRoot, cwd), undefined);
  const hooks: HookBus = createHookBus();
  const trust = trustClassifier(config);
  if (trust.note) notices.push(trust.note);
  const systemPrompt = buildRuntimePrompt({ profile, rulesText: rulesPromptText(rules), tools: toolSet.summaries, projectRoot, cwd });

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
    : SessionLog.create(projectRoot, { cwd, surface: options.surface });
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
    tools: toolSet.summaries,
    get session() {
      return session;
    },
    notices,

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
