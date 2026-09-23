import { CoreAgent } from '../core/agent.js';
import { createChatProvider } from '../core/providers/factory.js';
import { createSession } from '../core/state.js';
import type { AgentEvent, ChatMessage, RunResult, TokenUsage } from '../core/types.js';
import { buildSystemPrompt } from '../core/prompt.js';
import { applyRules, loadRules, rulesPromptText } from '../core/rules/index.js';
import { createHookBus, emitHookEvent } from '../core/hooks/index.js';
import { ConfigService } from '../services/ConfigService.js';
import { ToolService } from '../services/ToolService.js';
import { HistoryService } from '../services/HistoryService.js';
import { McpManager } from '../services/McpManager.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import type { Profile } from '../types/config.js';
import { SAFE_TOOL_NAMES, ALL_TOOL_NAMES, TOOL_DEFINITIONS } from '../types/tools.js';
import type { ToolName } from '../types/tools.js';
import type { ToolDispatcher } from '../core/tools/dispatch.js';
import { resolveToolPolicy } from '../core/policy/index.js';
import type { ToolDecision } from '../core/policy/index.js';
import type { ToolPermissionValue } from '../types/config.js';

export interface HeadlessOptions {
  prompt: string;
  cwd?: string;
  maxTurns?: number;
  projectRoot: string;
  sessionId?: string;
  allowTools?: string[];
  denyTools?: string[];
  onEvent?: (event: AgentEvent) => void;
}

export interface HeadlessResult {
  result: RunResult;
  provider: string;
  model: string;
  messages: ChatMessage[];
  refusals: string[];
}

const parseToolList = (values: string[] | undefined): ToolName[] => {
  if (!values?.length) return [];
  const names: ToolName[] = [];
  for (const raw of values) {
    for (const part of raw.split(',')) {
      const normalized = part.trim().toLowerCase();
      if (!normalized) continue;
      const match = ALL_TOOL_NAMES.find((name) => name === normalized);
      if (match) names.push(match);
    }
  }
  return names;
};

export const runHeadless = async (options: HeadlessOptions): Promise<HeadlessResult> => {
  const hooks = createHookBus();
  const rules = applyRules(loadRules(options.projectRoot, options.cwd ?? process.cwd()), undefined);

  const configService = new ConfigService(options.projectRoot);
  await configService.initialize();
  const config = await configService.getConfig();
  const profile: Profile = await configService.getActiveProfile();
  const permissions = await configService.getToolPermissions();

  const providerName = profile.preferred_provider || 'ollama';
  const provider = createChatProvider(providerName, config.api_registry);
  const modelName = profile.preferred_model || 'default';

  const toolService = new ToolService({ projectRoot: options.projectRoot, configService });
  const mcpManager = new McpManager({ configService });

  const allowed = parseToolList(options.allowTools);
  const denied = parseToolList(options.denyTools);

  const policySource = {
    permissions: permissions as unknown as Record<string, ToolPermissionValue>,
    allowTools: allowed.length ? allowed : undefined,
    denyTools: denied.length ? denied : undefined,
  };

  const candidates: ToolName[] = allowed.length ? allowed : (SAFE_TOOL_NAMES as ToolName[]);
  const decisions = new Map<string, ToolDecision>();
  const usableTools = candidates.filter((name) => {
    const decision = resolveToolPolicy(name, policySource).decision;
    decisions.set(name, decision);
    return decision !== 'deny';
  });

  const dispatcher: ToolDispatcher | undefined = usableTools.length
    ? {
        listTools: () => usableTools.map((name) => ({ name })),
        requiresApproval: (name) => resolveToolPolicy(name, policySource).decision === 'ask',
        execute: async (call) => {
          const started = Date.now();
          try {
            const output = await toolService.execute({
              tool: call.name as ToolName,
              params: call.arguments || {},
            });
            return { tool: call.name, success: true, output: output.output, durationMs: Date.now() - started };
          } catch (error: any) {
            return {
              tool: call.name,
              success: false,
              output: `Tool ${call.name} failed: ${error.message}`,
              durationMs: Date.now() - started,
            };
          }
        },
      }
    : undefined;

  const toolDefinitions = usableTools.map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description: TOOL_DEFINITIONS[name]?.description,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    },
  }));

  const historyService = new HistoryService(options.projectRoot, options.sessionId);
  await historyService.initialize();
  const priorMessages = options.sessionId ? await historyService.loadMessagesFromHistory() : [];

  const agent = new CoreAgent({
    provider,
    model: modelName,
    temperature: profile.temperature,
    modelUsageKey: `${providerName}:${modelName}`,
    dispatcher,
    toolDefinitions,
    maxSteps: options.maxTurns ?? config.agent_loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
    maxToolCallsPerTurn:
      config.agent_loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
    truncationLimit:
      config.agent_loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
    systemPrompt: toolDefinitions.length
      ? `${buildSystemPrompt(profile, rulesPromptText(rules))}\n\nA tool is available. Call it rather than describing it.`
      : buildSystemPrompt(profile, rulesPromptText(rules)),
    hooks,
  });

  const session = createSession(options.projectRoot, options.sessionId);
  session.messages.push(...priorMessages.map((message) => ({ ...message })));

  await emitHookEvent(hooks, 'session_start', { session, profile: config.active_profile });

  const events: AgentEvent[] = [];
  const refusals: string[] = [];
  const result = await agent.run(session, options.prompt, (event) => {
    events.push(event);
    options.onEvent?.(event);
    if (event.type === 'approval_request') {
      const decision = resolveToolPolicy(event.call.name, policySource).decision;
      if (decision === 'allow') {
        event.decide(true);
        return;
      }
      refusals.push(
        decision === 'deny'
          ? `Tool ${event.call.name} is denied by policy and did not run.`
          : `Tool ${event.call.name} asks for approval, which a headless run cannot grant; pass --allow-tool ${event.call.name} to permit it.`
      );
      event.decide(false);
    }
  });

  await emitHookEvent(hooks, 'session_end', { session, status: result.status, turns: result.turns });

  const usage: TokenUsage | undefined = result.usage;
  const lastAssistant = [...session.messages].reverse().find((message) => message.role === 'assistant');
  if (lastAssistant) {
    await historyService.appendTurn(
      [
        { role: 'user', content: options.prompt, timestamp: Date.now() },
        { role: 'assistant', content: lastAssistant.content, timestamp: Date.now() },
      ],
      usage
    );
  }

  return {
    result,
    provider: providerName,
    model: modelName,
    messages: session.messages,
    refusals,
  };
};
