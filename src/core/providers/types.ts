import type { ChatMessage, ProviderToolCall, TokenUsage } from '../types.js';

export interface StreamChunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
  reasoning?: string;
  /**
   * Tool calls assembled from a streaming response, surfaced on the terminal
   * (done) chunk. Optional so every existing consumer keeps working.
   */
  toolCalls?: ProviderToolCall[];
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
  /** Reasoning text returned by a non-streaming completion, when present. */
  reasoning?: string;
}

export interface ProviderRequestOptions {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
  reasoning?: 'off' | 'on' | 'auto';
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Extra body fields merged into the request just before the known fields. */
  extraParams?: Record<string, unknown>;
}

export interface ChatProvider {
  streamChat(messages: ChatMessage[], options: ProviderRequestOptions): AsyncGenerator<StreamChunk>;
  complete(messages: ChatMessage[], options: ProviderRequestOptions): Promise<CompletionResult>;
}

export interface ProviderModelInfo {
  id: string;
  name?: string;
  description?: string;
  supports_tool_calling?: boolean;
}

/** A provider that can enumerate the models its endpoint exposes. */
export interface ListableProvider {
  listModels(): Promise<ProviderModelInfo[]>;
}

export const isListableProvider = (provider: ChatProvider): provider is ChatProvider & ListableProvider =>
  typeof (provider as { listModels?: unknown }).listModels === 'function';
