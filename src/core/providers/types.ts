import type { ChatMessage, ProviderToolCall, ReasoningBlock, TokenUsage } from '../types.js';
import type { RetryInfo } from './http.js';
import type { ModelFacts } from '../catalog/types.js';

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
  /** Reasoning with signatures, surfaced on the terminal chunk when the provider returns it. */
  reasoningBlocks?: ReasoningBlock[];
  /** Why generation stopped, in the provider's words (`end_turn`, `tool_calls`, `length`). */
  stopReason?: string;
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
  reasoningBlocks?: ReasoningBlock[];
  stopReason?: string;
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
  /** Called before each retry of a failed request. */
  onRetry?: (info: RetryInfo) => void;
  /** Most tokens the model may generate. */
  maxOutputTokens?: number;
  /** Context window to request, for providers that size it per request (Ollama). */
  contextLength?: number;
}

/** The wire family a provider speaks. Signed reasoning is replayed only within a family. */
export type ProviderFamily = 'openai' | 'anthropic' | 'ollama';

export interface ChatProvider {
  /** The family this provider speaks, used to decide what reasoning may be replayed to it. */
  readonly family?: ProviderFamily;
  streamChat(messages: ChatMessage[], options: ProviderRequestOptions): AsyncGenerator<StreamChunk>;
  complete(messages: ChatMessage[], options: ProviderRequestOptions): Promise<CompletionResult>;
  /**
   * What the provider's own metadata says about one model, or undefined when it does not
   * list the model. Throws when the provider cannot be asked. One attempt, no retries.
   */
  describeModel?(model: string, signal?: AbortSignal): Promise<ModelFacts | undefined>;
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

/** Refuse a request with no model instead of silently choosing one. */
export const requireModel = (provider: string, model: string | undefined): string => {
  if (model && model.trim()) return model;
  throw new Error(
    `No model is configured for ${provider}. Choose one with /model, pass --model ${provider}:<model>, or set preferred_model in the active profile.`
  );
};
