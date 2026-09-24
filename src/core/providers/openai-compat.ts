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

export type ProviderDialect = 'openai' | 'anthropic';

export interface OpenAICompatOptions {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  dialect?: ProviderDialect;
  /**
   * Body field to set to true when reasoning is requested. OpenRouter uses
   * `include_reasoning`; most OpenAI-compatible servers ignore the field and
   * stream reasoning deltas unconditionally, so this is opt-in configuration.
   */
  reasoningParam?: string;
  /** Provider id used in errors, such as `openrouter` or a custom endpoint id. */
  name?: string;
  /** The environment variable the key comes from, named in authentication errors. */
  keyVariable?: string;
  /** How failed requests are retried. */
  retryPolicy?: RetryPolicy;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * One client for the OpenAI chat-completions wire format. Handles streaming and
 * non-streaming requests and parses content, reasoning deltas, tool calls, and
 * usage. Ollama and OpenRouter are expressed as configurations of this client.
 */
export class OpenAICompatProvider implements ChatProvider, ListableProvider {
  readonly family: ProviderFamily = 'openai';
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly dialect: ProviderDialect;
  private readonly reasoningParam?: string;
  private readonly name: string;
  private readonly keyVariable?: string;
  private readonly retryPolicy?: RetryPolicy;
  /** Cleared when an endpoint rejects `stream_options`, so usage is not requested again. */
  private streamUsage = true;

  constructor(options: OpenAICompatOptions = {}) {
    if (options.dialect === 'anthropic') {
      throw new Error('The OpenAI-compatible client cannot speak the anthropic dialect; use AnthropicProvider.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.extraHeaders = { ...(options.headers || {}) };
    this.dialect = options.dialect || 'openai';
    this.reasoningParam = options.reasoningParam;
    this.name = options.name || 'openai';
    this.keyVariable = options.keyVariable;
    this.retryPolicy = options.retryPolicy;
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

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...(extra || {}),
    };
    if (this.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private buildBody(
    messages: ChatMessage[],
    options: ProviderRequestOptions,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: requireModel(this.name, options.model),
      messages: messages.map(toProviderMessage),
      stream,
      ...(stream && this.streamUsage ? { stream_options: { include_usage: true } } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
      ...(options.extraParams || {}),
    };

    const wantReasoning = options.reasoning === 'on' || options.reasoning === 'auto';
    if (wantReasoning && this.reasoningParam && body[this.reasoningParam] === undefined) {
      body[this.reasoningParam] = true;
    }

    if (options.tools?.length) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? 'auto';
    }

    return body;
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const response = await this.send('/models', { headers: this.buildHeaders({ Accept: 'application/json' }) }, {});
    const json: any = await response.json();
    const data: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : [];
    return data
      .map((model: any): ProviderModelInfo | null => {
        if (typeof model === 'string') return { id: model };
        const id = model?.id ?? model?.name;
        if (typeof id !== 'string' || !id) return null;
        const supportedParams = Array.isArray(model?.supported_parameters)
          ? model.supported_parameters.map((param: unknown) => String(param).toLowerCase())
          : [];
        const supportsTools = supportedParams.includes('tools') || supportedParams.includes('tool_choice');
        return {
          id,
          name: model?.name || id,
          description: model?.description || undefined,
          ...(supportedParams.length ? { supports_tool_calling: supportsTools } : {}),
        };
      })
      .filter((model): model is ProviderModelInfo => model !== null);
  }

  /**
   * What the models route reports about one model. OpenRouter reports limits, prices, and
   * capabilities; OpenAI itself reports none of them, so its models rely on configuration.
   */
  async describeModel(model: string, signal?: AbortSignal): Promise<ModelFacts | undefined> {
    const response = await fetchWithRetry(
      this.url('/models'),
      { headers: this.buildHeaders({ Accept: 'application/json' }) },
      { provider: this.name, signal, secrets: [this.apiKey], keyVariable: this.keyVariable, policy: NO_RETRY }
    );
    const json: any = await response.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
    const entry = data.find((item) => item && typeof item === 'object' && (item.id ?? item.name) === model);
    return entry ? openAICompatFacts(entry) : undefined;
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const response = await this.startStream(messages, options);
    if (!response.body) {
      throw new ProviderError({ provider: this.name, detail: 'the response had no body' });
    }

    let usage: TokenUsage | undefined;
    let stopReason: string | undefined;
    let sawDone = false;
    const toolCalls = new Map<number, { id?: string; name?: string; args: string }>();

    for await (const line of readLines(response.body)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        sawDone = true;
        yield { content: '', done: true, usage, toolCalls: finalizeToolCalls(toolCalls), stopReason };
        continue;
      }
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json?.error) {
        throw new ProviderError({
          provider: this.name,
          detail: String(json.error?.message ?? json.error),
          message: `${this.name} reported an error mid-stream: ${String(json.error?.message ?? json.error)}`,
        });
      }
      const delta = json?.choices?.[0]?.delta;
      if (json?.choices?.[0]?.finish_reason) stopReason = json.choices[0].finish_reason;
      const content = typeof delta?.content === 'string' ? delta.content : undefined;
      const reasoning = extractReasoningDelta(delta);
      if (content || reasoning) {
        yield { content: content || '', reasoning, done: false };
      }
      accumulateToolCalls(delta?.tool_calls, toolCalls);
      if (json?.usage) {
        usage = mapUsage(json.usage);
      }
    }

    if (!sawDone) {
      yield { content: '', done: true, usage, toolCalls: finalizeToolCalls(toolCalls), stopReason };
    }
  }

  /** Open the stream, dropping `stream_options` once if the endpoint rejects it. */
  private async startStream(messages: ChatMessage[], options: ProviderRequestOptions): Promise<Response> {
    const request = () =>
      this.send(
        '/chat/completions',
        {
          method: 'POST',
          headers: this.buildHeaders({ Accept: 'text/event-stream' }),
          body: JSON.stringify(this.buildBody(messages, options, true)),
        },
        options
      );
    try {
      return await request();
    } catch (error) {
      if (this.streamUsage && error instanceof ProviderError && error.status === 400 && /stream_options|include_usage/i.test(error.detail ?? '')) {
        this.streamUsage = false;
        return request();
      }
      throw error;
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): Promise<CompletionResult> {
    const response = await this.send(
      '/chat/completions',
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(messages, options, false)),
      },
      options
    );

    const json: any = await response.json();
    const choice = json?.choices?.[0];
    const message = choice?.message || {};
    const reasoning = extractReasoningDelta(message);
    return {
      content: typeof message.content === 'string' ? message.content : '',
      usage: json?.usage ? mapUsage(json.usage) : undefined,
      toolCalls: parseToolCalls(message),
      ...(reasoning ? { reasoning } : {}),
      ...(choice?.finish_reason ? { stopReason: choice.finish_reason } : {}),
    };
  }
}


const positiveCount = (...values: unknown[]): number | undefined =>
  values.find((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0);

/** A per-token price, as OpenRouter reports it, in dollars per million tokens. Negative means it varies. */
const perMillion = (value: unknown): number | undefined => {
  const amount = typeof value === 'string' && value.trim() ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Number((amount * 1_000_000).toPrecision(12));
};

/**
 * The facts in one entry of a models route. Servers name the context window differently:
 * OpenRouter and Together `context_length`, Groq `context_window`, Mistral
 * `max_context_length`, and vLLM `max_model_len`.
 */
export function openAICompatFacts(entry: any): ModelFacts {
  const facts: ModelFacts = {};
  const contextWindow = positiveCount(
    entry.context_length,
    entry.top_provider?.context_length,
    entry.context_window,
    entry.max_context_length,
    entry.max_model_len
  );
  if (contextWindow) facts.contextWindow = contextWindow;
  const maxOutput = positiveCount(entry.top_provider?.max_completion_tokens, entry.max_completion_tokens, entry.max_output_tokens);
  if (maxOutput) facts.maxOutput = maxOutput;
  if (Array.isArray(entry.supported_parameters)) {
    const parameters = entry.supported_parameters.map((parameter: unknown) => String(parameter).toLowerCase());
    facts.tools = parameters.includes('tools') || parameters.includes('tool_choice');
    facts.reasoning = parameters.includes('reasoning') || parameters.includes('include_reasoning');
  }
  const modalities = entry.architecture?.input_modalities;
  if (Array.isArray(modalities)) facts.images = modalities.map(String).includes('image');
  const pricing = entry.pricing;
  if (pricing && typeof pricing === 'object') {
    const input = perMillion(pricing.prompt);
    const output = perMillion(pricing.completion);
    if (input !== undefined && output !== undefined) {
      facts.price = { input, output };
      const cacheRead = perMillion(pricing.input_cache_read);
      const cacheWrite = perMillion(pricing.input_cache_write);
      if (cacheRead !== undefined) facts.price.cacheRead = cacheRead;
      if (cacheWrite !== undefined) facts.price.cacheWrite = cacheWrite;
    }
  }
  return facts;
}

export function extractReasoningDelta(delta: any): string | undefined {
  return delta?.reasoning ?? delta?.reasoning_content ?? delta?.thinking ?? undefined;
}

function mapUsage(usage: any): TokenUsage {
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage.total_tokens || prompt + completion,
    ...(typeof cached === 'number' && cached > 0 ? { cached_tokens: cached } : {}),
  };
}

function normalizeArgs(value: unknown): any {
  if (value === undefined || value === null) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return { value };
    }
  }
  return value;
}

export function parseToolCalls(message: any): ProviderToolCall[] | undefined {
  const rawCalls = message?.tool_calls;
  if (!Array.isArray(rawCalls)) return undefined;

  const calls = rawCalls
    .map((call: any): ProviderToolCall | null => {
      const fn = call?.function || call;
      if (!fn?.name) return null;
      return {
        id: call?.id ?? fn?.id,
        type: call?.type || 'function',
        function: {
          name: fn.name,
          arguments: normalizeArgs(fn.arguments),
        },
      };
    })
    .filter((call): call is ProviderToolCall => call !== null);

  return calls.length ? calls : undefined;
}

function accumulateToolCalls(
  rawToolCalls: any,
  toolCalls: Map<number, { id?: string; name?: string; args: string }>
): void {
  if (!Array.isArray(rawToolCalls)) return;
  for (const raw of rawToolCalls) {
    const index = typeof raw?.index === 'number' ? raw.index : 0;
    const entry = toolCalls.get(index) || { args: '' };
    if (raw?.id) entry.id = raw.id;
    if (raw?.function?.name) entry.name = raw.function.name;
    if (typeof raw?.function?.arguments === 'string') entry.args += raw.function.arguments;
    toolCalls.set(index, entry);
  }
}

function finalizeToolCalls(
  toolCalls: Map<number, { id?: string; name?: string; args: string }>
): ProviderToolCall[] | undefined {
  if (toolCalls.size === 0) return undefined;
  const calls: ProviderToolCall[] = [];
  for (const [, entry] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
    if (!entry.name) continue;
    calls.push({
      id: entry.id,
      type: 'function',
      function: {
        name: entry.name,
        arguments: entry.args ? normalizeArgs(entry.args) : {},
      },
    });
  }
  return calls.length ? calls : undefined;
}

export function toProviderMessage(message: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: message.role, content: message.content ?? '' };
  if (message.tool_calls) out.tool_calls = message.tool_calls;
  if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
  return out;
}

/** Reads a byte stream as newline-delimited lines, tolerating arbitrary chunk boundaries. */
export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
    }
  }
  buffer += decoder.decode();
  if (buffer.length) {
    yield buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
  }
}
