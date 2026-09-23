import { Message, TokenUsage } from '../core/types.js';
import type {
  ChatProvider,
  CompletionResult as CoreCompletionResult,
  ProviderRequestOptions,
} from '../core/providers/types.js';
import { createChatProvider, isSupportedProvider, type SupportedProvider } from '../core/providers/factory.js';
import type { ApiRegistry } from '../types/config.js';

export interface ModelOptions {
  temperature?: number;
  model?: string;
  signal?: AbortSignal;
  reasoning?: 'off' | 'on' | 'auto';
  extraParams?: Record<string, unknown>;
  tools?: LLMTool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface Chunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
  reasoning?: string;
}

export interface CompletionResult {
  content: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  finishReason?: string;
  rawMessage?: any;
}

export interface ToolCall {
  id?: string;
  name: string;
  type?: string;
  arguments?: any;
}

export interface LLMTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ILLMProvider {
  streamChat(messages: Message[], options: ModelOptions): AsyncGenerator<Chunk>;
  complete(messages: Message[], options: ModelOptions): Promise<CompletionResult>;
  listModels?(): Promise<string[]>;
}

const toRequestOptions = (options: ModelOptions): ProviderRequestOptions => ({
  model: options.model,
  temperature: options.temperature,
  signal: options.signal,
  reasoning: options.reasoning,
  tools: options.tools,
  toolChoice: options.toolChoice,
  extraParams: options.extraParams,
});

/**
 * Presents a core ChatProvider through the legacy provider interface that the
 * terminal UI and the headless runner still read. Ollama, OpenRouter, OpenAI,
 * and Anthropic are all configurations of the core clients now; no per-provider
 * class lives here anymore.
 */
class ChatToLegacyProvider implements ILLMProvider {
  constructor(private readonly provider: ChatProvider) {}

  async *streamChat(messages: Message[], options: ModelOptions): AsyncGenerator<Chunk> {
    for await (const chunk of this.provider.streamChat(messages, toRequestOptions(options))) {
      yield {
        content: chunk.content,
        done: Boolean(chunk.done),
        ...(chunk.usage ? { usage: chunk.usage } : {}),
        ...(chunk.reasoning ? { reasoning: chunk.reasoning } : {}),
      };
    }
  }

  async complete(messages: Message[], options: ModelOptions): Promise<CompletionResult> {
    const result: CoreCompletionResult = await this.provider.complete(messages, toRequestOptions(options));
    const toolCalls = result.toolCalls?.map((call) => ({
      id: call.id,
      name: call.function.name,
      type: call.type || 'function',
      arguments: call.function.arguments,
    }));
    return {
      content: result.content,
      ...(result.usage ? { usage: result.usage } : {}),
      ...(toolCalls ? { toolCalls } : {}),
    };
  }

  async listModels(): Promise<string[]> {
    const listable = this.provider as ChatProvider & { listModels?: () => Promise<{ id: string }[]> };
    if (typeof listable.listModels !== 'function') return [];
    const models = await listable.listModels();
    return models.map((model) => model.id);
  }
}

export class LLMFactory {
  static createProvider(type: SupportedProvider, config: any): ILLMProvider {
    if (!isSupportedProvider(type)) {
      throw new Error(`Provider ${String(type)} is not supported.`);
    }
    const registry: ApiRegistry = {};
    if (type === 'ollama') registry.ollama = config ?? {};
    else if (type === 'openrouter') registry.openrouter = config ?? {};
    else if (type === 'openai') registry.openai = config ?? {};
    else if (type === 'anthropic') registry.anthropic = config ?? {};
    return new ChatToLegacyProvider(createChatProvider(type, registry));
  }
}
