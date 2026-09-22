import type { ChatMessage, ProviderToolCall, TokenUsage } from '../types.js';

export interface StreamChunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
  reasoning?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface CompletionResult {
  content: string;
  usage?: TokenUsage;
  toolCalls?: ProviderToolCall[];
}

export interface ProviderRequestOptions {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
  reasoning?: 'off' | 'on' | 'auto';
  tools?: ToolDefinition[];
}

export interface ChatProvider {
  streamChat(messages: ChatMessage[], options: ProviderRequestOptions): AsyncGenerator<StreamChunk>;
  complete(messages: ChatMessage[], options: ProviderRequestOptions): Promise<CompletionResult>;
}
