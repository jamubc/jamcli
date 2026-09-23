import { CoreAgent } from '../core/agent.js';
import { adaptLegacyProvider } from '../core/providers/legacy.js';
import { createSession } from '../core/state.js';
import type { AgentEvent, ChatMessage, RunResult, TokenUsage } from '../core/types.js';
import { buildSystemPrompt } from '../core/prompt.js';
import { applyRules, loadRules, rulesPromptText } from '../core/rules/index.js';
import { createHookBus, emitHookEvent } from '../core/hooks/index.js';
import { LLMFactory } from '../services/LLMProvider.js';
import { ConfigService } from '../services/ConfigService.js';
import { ToolService } from '../services/ToolService.js';
import { HistoryService } from '../services/HistoryService.js';
import { McpManager } from '../services/McpManager.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import type { Profile } from '../types/config.js';
import { SAFE_TOOL_NAMES, ALL_TOOL_NAMES, TOOL_DEFINITIONS } from '../types/tools.js';
import type { ToolName } from '../types/tools.js';
import type { ToolDispatcher } from '../core/tools/dispatch.js';

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

  const providerKey: 'ollama' | 'openrouter' = profile.preferred_provider === 'openrouter' ? 'openrouter' : 'ollama';
  const providerConfig =
    providerKey === 'openrouter' ? config.api_registry.openrouter || {} : config.api_registry.ollama || {};
  const provider = LLMFactory.createProvider(providerKey, providerConfig);
  const modelName = profile.preferred_model || 'default';

  const toolService = new ToolService({ projectRoot: options.projectRoot, configService });
  const mcpManager = new McpManager({ configService });

  const allowed = parseToolList(options.allowTools);
  const denied = new Set(parseToolList(options.denyTools));

  const toolNames: ToolName[] = allowed.length ? allowed : (SAFE_TOOL_NAMES as ToolName[]);
  const usableTools = toolNames.filter((name) => {
    if (denied.has(name)) return false;
    const permission = permissions[name];
    return permission ? permission.allowed : true;
  });

  const dispatcher: ToolDispatcher | undefined = usableTools.length
    ? {
        listTools: () => usableTools.map((name) => ({ name })),
        requiresApproval: (name) => {
          const toolName = name as ToolName;
          if (denied.has(toolName)) return true;
          const permission = permissions[toolName];
          if (!permission) return true;
          return Boolean(permission.require_approval);
        },
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
    provider: adaptLegacyProvider(provider),
    model: modelName,
    temperature: profile.temperature,
    modelUsageKey: `${profile.preferred_provider || providerKey}:${modelName}`,
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
  const result = await agent.run(session, options.prompt, (event) => {
    events.push(event);
    options.onEvent?.(event);
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
    provider: profile.preferred_provider || providerKey,
    model: modelName,
    messages: session.messages,
  };
};
