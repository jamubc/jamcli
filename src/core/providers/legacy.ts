import type { ChatMessage } from '../types.js';
import type { ChatProvider, ProviderRequestOptions, StreamChunk } from './types.js';

export interface LegacyStreamProvider {
  streamChat(messages: any[], options: any): AsyncGenerator<any>;
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
  };
}
