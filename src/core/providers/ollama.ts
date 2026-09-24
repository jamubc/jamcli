import type { ChatMessage, ProviderToolCall, TokenUsage } from '../types.js';
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
import { extractReasoningDelta, parseToolCalls, readLines } from './openai-compat.js';

export interface OllamaProviderOptions {
  endpoint: string;
  /** Context window to request. Without it, the model's own limit is used, capped. */
  numCtx?: number;
  /** How failed requests are retried. Defaults to one quick retry. */
  retryPolicy?: RetryPolicy;
}

const DEFAULT_ENDPOINT = 'http://localhost:11434';
/**
 * Ollama allocates the whole context window up front, so asking for a model's full
 * limit can exhaust memory. Without configuration, the request asks for the model's
 * limit capped here, which fits a coding session on common hardware.
 */
export const DEFAULT_OLLAMA_CONTEXT_CAP = 16_384;
const FALLBACK_CONTEXT = 8_192;

/** A local server that refuses connections is rarely transient, so retry once, quickly. */
const LOCAL_RETRY_POLICY: RetryPolicy = { maxAttempts: 2, baseDelayMs: 300, maxDelayMs: 2_000 };

/**
 * The local-first path. Ollama exposes a native NDJSON chat route that works
 * without a network account; this client keeps that path intact. A base URL
 * that ends in `/v1` is served by the OpenAI-compatible client instead.
 *
 * Every request carries `num_ctx`: Ollama otherwise uses a small default and
 * truncates the front of a longer conversation without saying so.
 */
export class OllamaProvider implements ChatProvider, ListableProvider {
  readonly family: ProviderFamily = 'ollama';
  private readonly endpoint: string;
  private readonly numCtx?: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly contextCache = new Map<string, number>();

  constructor(options: OllamaProviderOptions | string = DEFAULT_ENDPOINT) {
    const endpoint = typeof options === 'string' ? options : options.endpoint;
    this.endpoint = (endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.numCtx = typeof options === 'string' ? undefined : options.numCtx;
    this.retryPolicy = (typeof options === 'string' ? undefined : options.retryPolicy) ?? LOCAL_RETRY_POLICY;
  }

  private url(path: string): string {
    return `${this.endpoint}${path}`;
  }

  private send(path: string, init: RequestInit, options: ProviderRequestOptions): Promise<Response> {
    return fetchWithRetry(this.url(path), init, {
      provider: 'ollama',
      signal: options.signal,
      onRetry: options.onRetry,
      policy: this.retryPolicy,
    });
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const response = await this.send('/api/tags', {}, {});
    const data: any = await response.json();
    const models: any[] = Array.isArray(data?.models) ? data.models : [];
    return models
      .map((model: any): ProviderModelInfo | null => {
        const name = model?.name ?? model?.model;
        return typeof name === 'string' && name ? { id: name, name } : null;
      })
      .filter((model): model is ProviderModelInfo => model !== null);
  }

  /** What `/api/show` reports: the model's own context length and, where the server lists them, its capabilities. */
  async describeModel(model: string, signal?: AbortSignal): Promise<ModelFacts | undefined> {
    let response: Response;
    try {
      response = await fetchWithRetry(
        this.url('/api/show'),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) },
        { provider: 'ollama', signal, policy: NO_RETRY }
      );
    } catch (error) {
      // Ollama answers 404 for a model it does not have, which is not listing it.
      if (error instanceof ProviderError && error.status === 404) return undefined;
      throw error;
    }
    return ollamaFacts(await response.json());
  }

  /** The model's reported context length from `/api/show`, or undefined when unknown. */
  async modelContextLength(model: string): Promise<number | undefined> {
    try {
      return (await this.describeModel(model))?.contextWindow;
    } catch {
      // Unknown; the caller falls back.
      return undefined;
    }
  }

  /** The `num_ctx` to send: the request's, the configured one, or the model's limit capped. */
  async contextFor(model: string, options: ProviderRequestOptions): Promise<number> {
    if (options.contextLength) return options.contextLength;
    if (this.numCtx) return this.numCtx;
    const cached = this.contextCache.get(model);
    if (cached) return cached;
    const reported = await this.modelContextLength(model);
    const chosen = reported ? Math.min(reported, DEFAULT_OLLAMA_CONTEXT_CAP) : FALLBACK_CONTEXT;
    this.contextCache.set(model, chosen);
    return chosen;
  }

  private async body(messages: ChatMessage[], options: ProviderRequestOptions, stream: boolean) {
    const model = requireModel('ollama', options.model);
    const wantReasoning = options.reasoning === 'on' || options.reasoning === 'auto';
    const nativeOptions: Record<string, unknown> = { num_ctx: await this.contextFor(model, options) };
    if (options.temperature !== undefined) nativeOptions.temperature = options.temperature;
    if (options.maxOutputTokens) nativeOptions.num_predict = options.maxOutputTokens;
    return JSON.stringify({
      model,
      messages: messages.map(toOllamaMessage),
      stream,
      ...(wantReasoning ? { think: true } : {}),
      ...(options.tools?.length ? { tools: options.tools } : {}),
      options: nativeOptions,
      ...(options.extraParams || {}),
    });
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const response = await this.send(
      '/api/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await this.body(messages, options, true) },
      options
    );
    if (!response.body) {
      throw new ProviderError({ provider: 'ollama', detail: 'the response had no body' });
    }

    let usage: TokenUsage | undefined;
    let stopReason: string | undefined;
    let sawDone = false;
    const toolCalls: ProviderToolCall[] = [];

    for await (const line of readLines(response.body)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let json: any;
      try {
        json = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (json?.error) {
        throw new ProviderError({ provider: 'ollama', detail: String(json.error), message: `ollama reported an error: ${json.error}` });
      }
      const message = json?.message || {};
      const content = typeof message.content === 'string' ? message.content : '';
      const reasoning = extractReasoningDelta(message);
      if (content || reasoning) {
        yield { content, reasoning, done: false };
      }
      // Since Ollama 0.8, tool calls arrive in whichever chunk parses them, not only the last.
      const calls = parseToolCalls(message);
      if (calls) toolCalls.push(...calls);
      const chunkUsage = ollamaUsage(json);
      if (chunkUsage) usage = chunkUsage;
      if (json?.done) {
        sawDone = true;
        stopReason = json?.done_reason;
        yield { content: '', done: true, usage, toolCalls: toolCalls.length ? toolCalls : undefined, stopReason };
      }
    }

    if (!sawDone) {
      yield { content: '', done: true, usage, toolCalls: toolCalls.length ? toolCalls : undefined, stopReason };
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): Promise<CompletionResult> {
    const response = await this.send(
      '/api/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await this.body(messages, options, false) },
      options
    );

    const json: any = await response.json();
    const message = json?.message || {};
    const reasoning = extractReasoningDelta(message);
    return {
      content: typeof message.content === 'string' ? message.content : '',
      usage: ollamaUsage(json),
      toolCalls: parseToolCalls(message),
      ...(reasoning ? { reasoning } : {}),
      ...(json?.done_reason ? { stopReason: json.done_reason } : {}),
    };
  }
}

/**
 * The facts in an `/api/show` response. The context length is under the model's
 * architecture, such as `qwen3.context_length`; capabilities name `tools`, `thinking`, and
 * `vision` when the model has them.
 */
export function ollamaFacts(json: any): ModelFacts {
  const facts: ModelFacts = {};
  const info = json?.model_info ?? {};
  const architecture = info['general.architecture'];
  const lengths = [
    ...(typeof architecture === 'string' ? [info[`${architecture}.context_length`]] : []),
    ...Object.entries(info).flatMap(([key, value]) => (key.endsWith('.context_length') ? [value] : [])),
  ];
  const length = lengths.find((value) => typeof value === 'number' && Number.isInteger(value) && value > 0);
  if (length) facts.contextWindow = length as number;
  if (Array.isArray(json?.capabilities)) {
    const capabilities = json.capabilities.map(String);
    facts.tools = capabilities.includes('tools');
    facts.reasoning = capabilities.includes('thinking');
    facts.images = capabilities.includes('vision');
  }
  return facts;
}

function ollamaUsage(json: any): TokenUsage | undefined {
  if (!json?.prompt_eval_count && !json?.eval_count) return undefined;
  const prompt = json.prompt_eval_count || 0;
  const completion = json.eval_count || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
}

function toOllamaMessage(message: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: message.role, content: message.content ?? '' };
  if (message.tool_calls?.length) {
    out.tool_calls = message.tool_calls.map((call) => ({
      ...(call.id ? { id: call.id } : {}),
      function: {
        name: call.function?.name,
        arguments: normalizeArguments(call.function?.arguments),
      },
    }));
  }
  if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
  return out;
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
      return { value: parsed };
    } catch {
      return { value };
    }
  }
  return { value };
}
