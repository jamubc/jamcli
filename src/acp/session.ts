import { CoreAgent } from '../core/agent.js';
import { adaptLegacyProvider } from '../core/providers/legacy.js';
import { createSession } from '../core/state.js';
import { buildSystemPrompt } from '../core/prompt.js';
import { LLMFactory } from '../services/LLMProvider.js';
import { ConfigService } from '../services/ConfigService.js';
import { ToolService } from '../services/ToolService.js';
import { resolveToolPolicy } from '../core/policy/index.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import type { Profile, ToolPermissionValue } from '../types/config.js';
import { SAFE_TOOL_NAMES, TOOL_DEFINITIONS } from '../types/tools.js';
import type { ToolName } from '../types/tools.js';
import type { AgentEvent, RunResult } from '../core/types.js';
import type { ToolDispatcher } from '../core/tools/dispatch.js';
import type { AcpConfigOption } from './protocol.js';

/** What the ACP server needs from a session in order to drive a turn. */
export interface AcpSessionController {
  id: string;
  cwd: string;
  model: string;
  profile: string;
  configOptions: AcpConfigOption[];
  run(prompt: string, onEvent: (event: AgentEvent) => void): Promise<RunResult>;
  cancel(): void;
}

export interface CreateAcpSessionOptions {
  projectRoot: string;
  cwd: string;
  sessionId?: string;
  maxSteps?: number;
  configService?: ConfigService;
}

/**
 * Build a session that drives the same core agent the TUI and the headless
 * runner use. The ACP surface only differs in how it presents events and
 * resolves approvals.
 */
export const createAcpSession = async (options: CreateAcpSessionOptions): Promise<AcpSessionController> => {
  const configService = options.configService ?? new ConfigService(options.projectRoot);
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
  const policySource = { permissions: permissions as unknown as Record<string, ToolPermissionValue> };

  const usableTools = (SAFE_TOOL_NAMES as ToolName[]).filter(
    (name) => resolveToolPolicy(name, policySource).decision !== 'deny'
  );

  const dispatcher: ToolDispatcher = {
    listTools: () => usableTools.map((name) => ({ name })),
    requiresApproval: (name) => resolveToolPolicy(name, policySource).decision === 'ask',
    execute: async (call) => {
      const started = Date.now();
      try {
        const output = await toolService.execute({ tool: call.name as ToolName, params: call.arguments || {} });
        return { tool: call.name, success: true, output: output.output, durationMs: Date.now() - started };
      } catch (error: any) {
        return {
          tool: call.name,
          success: false,
          output: `Tool ${call.name} failed: ${error?.message || error}`,
          durationMs: Date.now() - started,
        };
      }
    },
  };

  const toolDefinitions = usableTools.map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description: TOOL_DEFINITIONS[name]?.description,
      parameters: { type: 'object', properties: {}, additionalProperties: true },
    },
  }));

  const agent = new CoreAgent({
    provider: adaptLegacyProvider(provider),
    model: modelName,
    temperature: profile.temperature,
    modelUsageKey: `${profile.preferred_provider || providerKey}:${modelName}`,
    dispatcher,
    toolDefinitions,
    maxSteps: options.maxSteps ?? config.agent_loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
    maxToolCallsPerTurn:
      config.agent_loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
    truncationLimit:
      config.agent_loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
    systemPrompt: toolDefinitions.length
      ? `${buildSystemPrompt(profile)}\n\nA tool is available. Call it rather than describing it.`
      : buildSystemPrompt(profile),
  });

  const session = createSession(options.projectRoot, options.sessionId);

  const configOptions: AcpConfigOption[] = [
    { id: 'model', name: 'Model', category: 'model', currentValue: modelName },
    { id: 'profile', name: 'Profile', category: 'profile', currentValue: config.active_profile },
  ];

  return {
    id: session.id,
    cwd: options.cwd,
    model: modelName,
    profile: config.active_profile,
    configOptions,
    run: (prompt, onEvent) => agent.run(session, prompt, onEvent),
    cancel: () => agent.cancel(session.id),
  };
};
