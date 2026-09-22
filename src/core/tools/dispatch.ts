import type { AgentEvent, ChatMessage, ToolCall, ToolResult } from '../types.js';

export interface DispatchableTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface ToolDispatcher {
  listTools(): DispatchableTool[];
  execute(call: ToolCall): Promise<ToolResult>;
  requiresApproval(name: string): boolean;
}

export interface DispatchOutcome {
  results: ToolResult[];
  stopped: boolean;
  stopReason?: 'budget' | 'approval';
  pendingCall?: ToolCall;
}

export async function dispatchToolCalls(
  calls: ToolCall[],
  dispatcher: ToolDispatcher,
  onEvent: (e: AgentEvent) => void,
  options: { maxCalls: number; alreadyUsed: number }
): Promise<DispatchOutcome> {
  const results: ToolResult[] = [];
  let used = options.alreadyUsed;

  for (const call of calls) {
    used += 1;
    if (used > options.maxCalls) {
      return { results, stopped: true, stopReason: 'budget' };
    }
    onEvent({ type: 'tool_call', call });
    if (dispatcher.requiresApproval(call.name)) {
      return { results, stopped: true, stopReason: 'approval', pendingCall: call };
    }
    try {
      const result = await dispatcher.execute(call);
      results.push(result);
      onEvent({ type: 'tool_result', result });
    } catch (error: any) {
      const failure: ToolResult = {
        tool: call.name,
        success: false,
        output: `Tool ${call.name} failed: ${error?.message || error}`,
        durationMs: 0,
      };
      results.push(failure);
      onEvent({ type: 'tool_result', result: failure });
    }
  }

  return { results, stopped: false };
}

export function toProviderToolMessages(call: ToolCall, callId: string, output: string): {
  assistant: ChatMessage;
  tool: ChatMessage;
} {
  return {
    assistant: {
      role: 'assistant' as const,
      content: '',
      timestamp: Date.now(),
      tool_calls: [
        {
          id: callId,
          type: call.type || 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
        },
      ],
    },
    tool: {
      role: 'tool' as const,
      content: output,
      timestamp: Date.now(),
      tool_call_id: callId,
    },
  };
}
