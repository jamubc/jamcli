import type { ChatMessage } from '../types.js';
import type { ChatProvider, CompletionResult, ProviderRequestOptions, StreamChunk } from './types.js';

export interface LegacyStreamProvider {
  streamChat(messages: any[], options: any): AsyncGenerator<any>;
  complete(messages: any[], options: any): Promise<any>;
}

export function adaptLegacyProvider(legacy: LegacyStreamProvider): ChatProvider {
  return {
    async *streamChat(messages: ChatMessage[], options: ProviderRequestOptions): AsyncGenerator<StreamChunk> {
      for await (const chunk of legacy.streamChat(messages, options)) {
        yield {
          content: chunk.content ?? '',
          done: Boolean(chunk.done),
          ...(chunk.usage ? { usage: chunk.usage } : {}),
          ...(chunk.reasoning ? { reasoning: chunk.reasoning } : {}),
        };
      }
    },
    async complete(messages: ChatMessage[], options: ProviderRequestOptions): Promise<CompletionResult> {
      const result = await legacy.complete(messages, {
        ...options,
        tools: options.tools,
        toolChoice: 'auto',
        extraParams: { ...(options as any).extraParams, tools: options.tools, tool_choice: 'auto' },
      });
      const toolCalls = Array.isArray(result.toolCalls)
        ? result.toolCalls.map((call: any) => {
            if (call?.function?.name) return call;
            if (call?.name) {
              return {
                id: call.id,
                type: call.type || 'function',
                function: { name: call.name, arguments: call.arguments ?? {} },
              };
            }
            return call;
          })
        : undefined;
      return {
        content: result.content ?? '',
        ...(result.usage ? { usage: result.usage } : {}),
        ...(toolCalls ? { toolCalls } : {}),
      };
    },
  };
}
