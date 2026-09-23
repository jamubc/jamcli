import { useCallback } from 'react';
import { McpManager } from '../services/McpManager.js';
import { LLMFactory } from '../services/LLMProvider.js';
import { CoreAgent } from '../core/agent.js';
import { adaptLegacyProvider } from '../core/providers/legacy.js';
import { createSession } from '../core/state.js';
import type { ChatMessage, TokenUsage } from '../core/types.js';
import type { Action } from '../store/index.js';
import { buildSystemPrompt, buildToolAvailabilityPrompt } from '../core/prompt.js';
import { selectToolsForQuery } from '../core/sensor.js';
import { truncateOutput } from './layoutFormat.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import type { Config, Profile, ToolPermission } from '../types/config.js';
import type { ToolName } from '../types/tools.js';
import { SAFE_TOOL_NAMES } from '../types/tools.js';

interface ToolConversationDeps {
  mcpManager: McpManager | null;
  activeProfile: Profile | null;
  config: Config | null;
  projectRoot: string;
  autoApproveActions: boolean;
  coreApprovalRef: { current: ((ok: boolean) => void) | null };
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string, usage?: TokenUsage, overrides?: Partial<ChatMessage>) => void;
  setStatus: (status: 'idle' | 'thinking' | 'streaming') => void;
  setPendingAction: (action: Action | null) => void;
  persistTurn: () => Promise<void>;
  incrementModelTokenUsage: (key: string, usage: TokenUsage) => void;
  performToolCall: (descriptor: any, args: Record<string, any>) => Promise<string>;
}

export function useToolConversation({
  mcpManager,
  activeProfile,
  config,
  projectRoot,
  autoApproveActions,
  coreApprovalRef,
  addMessage,
  updateLastMessage,
  setStatus,
  setPendingAction,
  persistTurn,
  incrementModelTokenUsage,
  performToolCall,
}: ToolConversationDeps) {
  const runToolEnabledConversation = useCallback(
    async ({
      provider,
      contextForModel,
      modelUsageKey,
      modelName,
      signal,
      userText,
    }: {
      provider: ReturnType<typeof LLMFactory.createProvider>;
      contextForModel: ChatMessage[];
      modelUsageKey: string;
      modelName?: string;
      signal?: AbortSignal;
      userText: string;
    }) => {
      if (!mcpManager) return false;

      const allTools = await mcpManager.listAllTools();
      const exposedTools = selectToolsForQuery(
        allTools.filter(
          (tool) => tool.source === 'server' || SAFE_TOOL_NAMES.includes(tool.name as ToolName)
        ),
        userText
      );
      if (!exposedTools.length) {
        return false;
      }

      const toolPrompt = buildToolAvailabilityPrompt(exposedTools);
      const systemPrompt = buildSystemPrompt(activeProfile);
      const systemContent = toolPrompt ? `${systemPrompt}\n\n${toolPrompt}` : systemPrompt;

      const toolMap = new Map(exposedTools.map((tool) => [tool.name, tool]));
      const openAiTools = exposedTools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
        },
      }));

      addMessage({
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        model: modelName,
        modelName,
        streaming: true,
      });

      let finalUsage: TokenUsage | undefined;
      const toolNames: string[] = [];

      const toolSession = createSession(projectRoot, 'tui-tools');
      const toolAgent = new CoreAgent({
        provider: adaptLegacyProvider(provider),
        model: modelName,
        temperature: activeProfile?.temperature,
        modelUsageKey,
        signal,
        dispatcher: {
          listTools: () => exposedTools.map((tool) => ({ name: tool.name })),
          requiresApproval: (name: string) => {
            const descriptor = toolMap.get(name);
            if (!descriptor) return false;
            return Boolean(descriptor.annotations?.destructiveHint) && !autoApproveActions;
          },
          execute: async (call) => {
            const descriptor = toolMap.get(call.name);
            if (!descriptor) {
              return {
                tool: call.name,
                success: false,
                output: `Tool ${call.name} not found or unavailable.`,
                durationMs: 0,
              };
            }
            const started = Date.now();
            try {
              const output = await performToolCall(descriptor, call.arguments || {});
              return { tool: call.name, success: true, output, durationMs: Date.now() - started };
            } catch (error: any) {
              return {
                tool: call.name,
                success: false,
                output: `Tool ${call.name} failed: ${error.message}`,
                durationMs: Date.now() - started,
              };
            }
          },
        },
        toolDefinitions: openAiTools,
        maxSteps: config?.agent_loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
        maxToolCallsPerTurn:
          config?.agent_loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
        truncationLimit:
          config?.agent_loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
        systemPrompt: systemContent,
      });
      toolSession.messages.push(
        ...contextForModel
          .filter((msg) => msg.role !== 'system')
          .map((msg) => ({ ...msg }))
      );

      const toolResult = await toolAgent.run(toolSession, userText, (event) => {
        if (event.type === 'tool_call') {
          toolNames.push(event.call.name);
          updateLastMessage(`Calling tools: ${toolNames.join(', ')}`, undefined, { streaming: true });
        } else if (event.type === 'tool_result') {
          const userMessage = [
            `tool_result:${event.result.tool}`,
            `output:\n${truncateOutput(event.result.output)}`,
          ].join('\n');
          addMessage({ role: 'system', content: userMessage, timestamp: Date.now() });
        } else if (event.type === 'usage') {
          finalUsage = event.usage;
        } else if (event.type === 'approval_request') {
          const descriptor = toolMap.get(event.call.name);
          const action: Action = {
            type: 'tool_call',
            params: {
              tool: event.call.name,
              args: event.call.arguments || {},
              descriptor,
              serverId: descriptor?.serverId,
            },
            status: 'pending',
          };
          coreApprovalRef.current = event.decide;
          setPendingAction(action);
          updateLastMessage(
            `Tool ${event.call.name} requires approval. Press [1]=yes, [2]=yes (don't ask again), [3]=no.`,
            finalUsage,
            { streaming: false }
          );
          setStatus('idle');
        }
      });

      if (toolResult.status === 'ok') {
        setStatus('streaming');
        updateLastMessage(toolResult.response, finalUsage, { streaming: false });
        await persistTurn();
        if (finalUsage) {
          incrementModelTokenUsage(modelUsageKey, finalUsage);
        }
        setStatus('idle');
        return true;
      }
      if (toolResult.status === 'refused') {
        setStatus('idle');
        return true;
      }
      updateLastMessage(toolResult.response || 'Tool run ended without a final answer.', finalUsage, {
        streaming: false,
      });
      setStatus('idle');
      return true;
    },
    [
      activeProfile,
      config,
      projectRoot,
      autoApproveActions,
      coreApprovalRef,
      addMessage,
      updateLastMessage,
      setStatus,
      setPendingAction,
      persistTurn,
      incrementModelTokenUsage,
      performToolCall,
      mcpManager,
    ]
  );

  return { runToolEnabledConversation };
}

export type { ToolPermission };
