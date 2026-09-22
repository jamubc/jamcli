import type { ChatMessage, TokenUsage } from '../types.js';

export interface StreamChunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
  reasoning?: string;
}

export interface ProviderRequestOptions {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
  reasoning?: 'off' | 'on' | 'auto';
}
export interface ChatProvider {
  streamChat(messages: ChatMessage[], options: ProviderRequestOptions): AsyncGenerator<StreamChunk>;
}
