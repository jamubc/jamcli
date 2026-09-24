import type { ChatMessage, ProviderToolCall, ReasoningBlock, TokenUsage } from '../types.js';
import type {
  ChatProvider,
  CompletionResult,
  ListableProvider,
  ProviderFamily,
  ProviderModelInfo,
  ProviderRequestOptions,
  StreamChunk,
} from './types.js';
import { requireModel } from './types.js';
import { NO_RETRY, ProviderError, fetchWithRetry, type RetryPolicy } from './http.js';
import type { ModelFacts } from '../catalog/types.js';
import { readLines } from './openai-compat.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  version?: string;
  /** Provider id used in errors, such as `anthropic` or a custom endpoint id. */
  name?: string;
  keyVariable?: string;
  /** How failed requests are retried. */
  retryPolicy?: RetryPolicy;
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
/** Used when neither the request nor the model catalog says how much the model may write. */
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * Reasoning is replayed only when it came from this family and carries what the API
 * needs to accept it: a signature for thinking, or the opaque payload for redacted
 * thinking. Anything else stays in the transcript and is left out of the request.
 */
const replayableReasoning = (message: ChatMessage, since?: number): AnthropicContentBlock[] => {
  if (message.providerFamily !== 'anthropic' || !message.reasoningBlocks?.length) return [];
  if (since !== undefined && message.timestamp < since) return [];
  const blocks: AnthropicContentBlock[] = [];
  for (const block of message.reasoningBlocks) {
    if (block.type === 'thinking' && block.signature) {
      blocks.push({ type: 'thinking', thinking: block.text, signature: block.signature });
    } else if (block.type === 'redacted' && block.data) {
      blocks.push({ type: 'redacted_thinking', data: block.data });
    }
  }
  return blocks;
};

/**
 * The Anthropic Messages translation seam. This is the only module that sets
 * the `x-api-key` and `anthropic-version` headers. Requests and streaming
 * responses are translated at this boundary; tool calls and signed reasoning
 * survive in both directions.
 */
export class AnthropicProvider implements ChatProvider, ListableProvider {
  readonly family: ProviderFamily = 'anthropic';
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxTokens: number;
  private readonly version: string;
  private readonly name: string;
  private readonly keyVariable?: string;
  private readonly retryPolicy?: RetryPolicy;
  /** Cleared when an endpoint rejects `cache_control`, so it is not sent again. */
  private promptCaching = true;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.extraHeaders = { ...(options.headers || {}) };
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.version = options.version || DEFAULT_VERSION;
    this.name = options.name || 'anthropic';
    this.keyVariable = options.keyVariable;
    this.retryPolicy = options.retryPolicy;
  }

  private url(path: string): string {
    const prefix = /\/v1$/.test(this.baseUrl) ? this.baseUrl : `${this.baseUrl}/v1`;
    return `${prefix}${path}`;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': this.version,
      ...this.extraHeaders,
      ...(extra || {}),
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey;
    return headers;
  }

  private send(path: string, init: RequestInit, options: ProviderRequestOptions): Promise<Response> {
    return fetchWithRetry(this.url(path), init, {
      provider: this.name,
      signal: options.signal,
      onRetry: options.onRetry,
      secrets: [this.apiKey],
      keyVariable: this.keyVariable,
      policy: this.retryPolicy,
    });
  }

  /**
   * Send a Messages request. An endpoint that rejects `cache_control`, such as an older
   * gateway, gets one retry without it, and is not sent it again.
   */
  private async post(messages: ChatMessage[], options: ProviderRequestOptions, stream: boolean): Promise<Response> {
    const request = () =>
      this.send(
        '/messages',
        {
          method: 'POST',
          headers: this.buildHeaders(stream ? { Accept: 'text/event-stream' } : undefined),
          body: JSON.stringify(this.buildBody(messages, options, stream)),
        },
        options
      );
    try {
      return await request();
    } catch (error) {
      if (!this.promptCaching || !(error instanceof ProviderError) || error.status !== 400 || !/cache_control/i.test(error.detail ?? '')) throw error;
      this.promptCaching = false;
      return request();
    }
  }

  private buildBody(
    messages: ChatMessage[],
    options: ProviderRequestOptions,
    stream: boolean
  ): Record<string, unknown> {
    const system: string[] = [];
    const translated: { role: 'user' | 'assistant'; content: AnthropicContentBlock[] }[] = [];

    const push = (role: 'user' | 'assistant', content: AnthropicContentBlock[]) => {
      const previous = translated[translated.length - 1];
      if (previous && previous.role === role) {
        previous.content.push(...content);
      } else {
        translated.push({ role, content });
      }
    };

    for (const message of messages) {
      if (message.role === 'system') {
        if (message.content) system.push(message.content);
        continue;
      }
      if (message.role === 'tool') {
        push('user', [
          {
            type: 'tool_result',
            tool_use_id: message.tool_call_id,
            content: message.content ?? '',
          },
        ]);
        continue;
      }
      if (message.role === 'assistant') {
        const blocks: AnthropicContentBlock[] = [...replayableReasoning(message, options.replayReasoningSince)];
        if (message.content) {
          blocks.push({ type: 'text', text: message.content });
        }
        for (const call of message.tool_calls || []) {
          blocks.push({
            type: 'tool_use',
            id: call.id || `toolu_${translated.length}_${blocks.length}`,
            name: call.function?.name,
            input: call.function?.arguments ?? {},
          });
        }
        push('assistant', blocks.length ? blocks : [{ type: 'text', text: '' }]);
        continue;
      }
      push('user', [{ type: 'text', text: message.content ?? '' }]);
    }

    const body: Record<string, unknown> = {
      model: requireModel(this.name, options.model),
      max_tokens: options.maxOutputTokens ?? this.maxTokens,
      messages: translated,
      stream,
      ...(options.temperature !== undefined && acceptsTemperature(options) ? { temperature: options.temperature } : {}),
      ...(options.extraParams || {}),
    };
    const thinking = thinkingFor(options, body.max_tokens as number);
    if (thinking && body.thinking === undefined) body.thinking = thinking;
    // The cache prefix runs tools, then system, then messages: a breakpoint closes each, so
    // an unchanged system prompt and tool list are read from the cache even when the
    // conversation is not, and the conversation up to the latest turn is read next time.
    const cache = this.promptCaching;
    if (system.length) {
      const text = system.join('\n\n');
      body.system = cache ? [{ type: 'text', text, cache_control: EPHEMERAL }] : text;
    }
    if (options.tools?.length) {
      const tools: Record<string, unknown>[] = options.tools.map((tool) => ({
        name: tool.function.name,
        ...(tool.function.description ? { description: tool.function.description } : {}),
        input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
      }));
      if (cache) tools[tools.length - 1].cache_control = EPHEMERAL;
      body.tools = tools;
      body.tool_choice = mapToolChoice(options.toolChoice);
    }
    if (cache) markCacheEnd(translated);
    return body;
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const response = await this.send('/models', { headers: this.buildHeaders({ Accept: 'application/json' }) }, {});
    const json: any = await response.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    return data
      .map((model: any): ProviderModelInfo | null => {
        const id = model?.id ?? model?.name;
        if (typeof id !== 'string' || !id) return null;
        return {
          id,
          name: model?.display_name || id,
          description: model?.description || undefined,
        };
      })
      .filter((model): model is ProviderModelInfo => model !== null);
  }

  /** What the Models API reports about one model: its limits and capabilities, but not its prices. */
  async describeModel(model: string, signal?: AbortSignal): Promise<ModelFacts | undefined> {
    let response: Response;
    try {
      response = await fetchWithRetry(
        this.url(`/models/${encodeURIComponent(model)}`),
        { headers: this.buildHeaders({ Accept: 'application/json' }) },
        { provider: this.name, signal, secrets: [this.apiKey], keyVariable: this.keyVariable, policy: NO_RETRY }
      );
    } catch (error) {
      // A model the API does not have is one it does not list.
      if (error instanceof ProviderError && error.status === 404) return undefined;
      throw error;
    }
    return anthropicFacts(await response.json());
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const response = await this.post(messages, options, true);
    if (!response.body) {
      throw new ProviderError({ provider: this.name, detail: 'the response had no body' });
    }

    let usage: TokenUsage | undefined;
    let startUsage: any = {};
    let stopReason: string | undefined;
    let sawStop = false;
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string; text: string; signature?: string; data?: string }>();

    const finish = (): StreamChunk => ({
      content: '',
      done: true,
      usage,
      toolCalls: finalizeBlocks(blocks),
      reasoningBlocks: reasoningFrom(blocks),
      stopReason,
    });

    for await (const line of readLines(response.body)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let event: any;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }

      switch (event?.type) {
        case 'message_start': {
          startUsage = event?.message?.usage ?? {};
          break;
        }
        case 'content_block_start': {
          const index = typeof event.index === 'number' ? event.index : 0;
          const block = event?.content_block || {};
          blocks.set(index, {
            type: block.type,
            id: block.id,
            name: block.name,
            json: '',
            text: typeof block.thinking === 'string' ? block.thinking : '',
            data: typeof block.data === 'string' ? block.data : undefined,
          });
          break;
        }
        case 'content_block_delta': {
          const index = typeof event.index === 'number' ? event.index : 0;
          const delta = event?.delta || {};
          const entry = blocks.get(index);
          if (delta.type === 'text_delta' && delta.text) {
            yield { content: delta.text, done: false };
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            if (entry) entry.text += delta.thinking;
            yield { content: '', reasoning: delta.thinking, done: false };
          } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
            if (entry) entry.signature = (entry.signature ?? '') + delta.signature;
          } else if (delta.type === 'input_json_delta') {
            if (entry && typeof delta.partial_json === 'string') {
              entry.json += delta.partial_json;
            }
          }
          break;
        }
        case 'message_delta': {
          if (event?.delta?.stop_reason) stopReason = event.delta.stop_reason;
          usage = mapUsage({ ...startUsage, ...(event?.usage ?? {}) });
          break;
        }
        case 'message_stop': {
          sawStop = true;
          yield finish();
          break;
        }
        case 'error': {
          const detail = event?.error?.message || 'the stream reported an error';
          throw new ProviderError({
            provider: this.name,
            detail,
            retryable: event?.error?.type === 'overloaded_error',
            message: `${this.name} reported an error mid-stream: ${detail}`,
          });
        }
        default:
          break;
      }
    }

    if (!sawStop) {
      yield finish();
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): Promise<CompletionResult> {
    const response = await this.post(messages, options, false);

    const json: any = await response.json();
    let content = '';
    let reasoning = '';
    const reasoningBlocks: ReasoningBlock[] = [];
    const toolCalls: ProviderToolCall[] = [];
    for (const block of json?.content || []) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        content += block.text;
      } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
        reasoning += block.thinking;
        reasoningBlocks.push({ type: 'thinking', text: block.thinking, ...(block.signature ? { signature: block.signature } : {}) });
      } else if (block?.type === 'redacted_thinking' && typeof block.data === 'string') {
        reasoningBlocks.push({ type: 'redacted', data: block.data });
      } else if (block?.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.input ?? {} },
        });
      }
    }

    return {
      content,
      ...(reasoning ? { reasoning } : {}),
      ...(reasoningBlocks.length ? { reasoningBlocks } : {}),
      usage: mapUsage(json?.usage),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      ...(json?.stop_reason ? { stopReason: json.stop_reason } : {}),
    };
  }
}

/**
 * Anthropic reports uncached input, cache reads, and cache writes separately. The prompt
 * total is their sum; the cache parts are kept so cost can price them correctly.
 */
function mapUsage(usage: any): TokenUsage | undefined {
  if (!usage) return undefined;
  const input = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const completion = usage.output_tokens || 0;
  if (!input && !cacheRead && !cacheWrite && !completion) return undefined;
  const prompt = input + cacheRead + cacheWrite;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    ...(cacheRead ? { cached_tokens: cacheRead } : {}),
    ...(cacheWrite ? { cache_write_tokens: cacheWrite } : {}),
  };
}


/** The five-minute cache, the price the catalog records for cache writes. */
const EPHEMERAL = { type: 'ephemeral' } as const;

/**
 * Put a cache breakpoint on the last block of the conversation that can carry one:
 * thinking cannot, and an empty text block is refused.
 */
function markCacheEnd(messages: { content: AnthropicContentBlock[] }[]): void {
  const last = messages[messages.length - 1];
  if (!last) return;
  for (let index = last.content.length - 1; index >= 0; index -= 1) {
    const block = last.content[index];
    if (block.type === 'thinking' || block.type === 'redacted_thinking') continue;
    if (block.type === 'text' && !block.text) continue;
    block.cache_control = EPHEMERAL;
    return;
  }
}

/** The smallest thinking budget the API takes. */
const MIN_THINKING_BUDGET = 1_024;

/**
 * The thinking a request asks for, from the model's style and the reasoning level. `auto`
 * lets a model that thinks adaptively decide for itself; `on` also gives a model that
 * takes a budget half of the output limit to think in; `off` turns thinking off where the
 * model allows it, and leaves a model that always thinks at its default. Summaries are
 * asked for, so the interface can show what the model is thinking.
 */
export function thinkingFor(options: ProviderRequestOptions, maxTokens: number): Record<string, unknown> | undefined {
  const reasoning = options.reasoning ?? 'auto';
  if (options.thinkingStyle === 'adaptive') {
    if (reasoning === 'off') return options.alwaysThinks ? undefined : { type: 'disabled' };
    return { type: 'adaptive', display: 'summarized' };
  }
  if (options.thinkingStyle === 'budget' && reasoning === 'on') {
    const budget = Math.floor(maxTokens / 2);
    return budget >= MIN_THINKING_BUDGET ? { type: 'enabled', budget_tokens: budget } : undefined;
  }
  return undefined;
}

/**
 * Whether a request may carry a temperature. Claude models from Opus 4.7 and Sonnet 5 on
 * refuse any temperature but the default on every request, and earlier ones refuse it
 * while thinking. Only a model that takes a thinking budget, with thinking off, is sure
 * to accept one; for any other, leaving it out costs a little control, where sending it
 * would fail every request.
 */
export function acceptsTemperature(options: ProviderRequestOptions): boolean {
  return options.thinkingStyle === 'budget' && options.reasoning !== 'on';
}

/**
 * The facts in a Models API entry. A limit of zero or null means the API does not say.
 * Adaptive thinking is preferred where a model takes both kinds, because budget thinking
 * is deprecated there.
 */
export function anthropicFacts(json: any): ModelFacts {
  const facts: ModelFacts = {};
  const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;
  if (count(json?.max_input_tokens)) facts.contextWindow = json.max_input_tokens;
  if (count(json?.max_tokens)) facts.maxOutput = json.max_tokens;
  const capabilities = json?.capabilities;
  if (capabilities && typeof capabilities === 'object') {
    const supported = (value: any): boolean | undefined => (typeof value?.supported === 'boolean' ? value.supported : undefined);
    const images = supported(capabilities.image_input);
    if (images !== undefined) facts.images = images;
    const thinking = supported(capabilities.thinking);
    if (thinking !== undefined) facts.reasoning = thinking;
    if (supported(capabilities.thinking?.types?.adaptive)) facts.thinking = 'adaptive';
    else if (supported(capabilities.thinking?.types?.enabled)) facts.thinking = 'budget';
    const effort = supported(capabilities.effort);
    if (effort !== undefined) facts.effort = effort;
  }
  return facts;
}

function mapToolChoice(
  choice: ProviderRequestOptions['toolChoice']
): Record<string, unknown> | undefined {
  if (!choice) return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  if (choice === 'auto') return { type: 'auto' };
  if (typeof choice === 'object') return { type: 'tool', name: choice.function.name };
  return { type: 'auto' };
}

type StreamBlock = { type: string; id?: string; name?: string; json: string; text: string; signature?: string; data?: string };

function reasoningFrom(blocks: Map<number, StreamBlock>): ReasoningBlock[] | undefined {
  const out: ReasoningBlock[] = [];
  for (const [, block] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (block.type === 'thinking') out.push({ type: 'thinking', text: block.text, ...(block.signature ? { signature: block.signature } : {}) });
    else if (block.type === 'redacted_thinking' && block.data) out.push({ type: 'redacted', data: block.data });
  }
  return out.length ? out : undefined;
}

function finalizeBlocks(blocks: Map<number, StreamBlock>): ProviderToolCall[] | undefined {
  const calls: ProviderToolCall[] = [];
  for (const [, block] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    if (block.type !== 'tool_use' || !block.name) continue;
    let parsed: unknown = {};
    if (block.json) {
      try {
        parsed = JSON.parse(block.json);
      } catch {
        parsed = { value: block.json };
      }
    }
    calls.push({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: parsed },
    });
  }
  return calls.length ? calls : undefined;
}
