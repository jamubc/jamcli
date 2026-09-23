import type { ChatMessage, ProviderToolCall, TokenUsage } from '../types.js';
import type {
  ChatProvider,
  CompletionResult,
  ListableProvider,
  ProviderModelInfo,
  ProviderRequestOptions,
  StreamChunk,
} from './types.js';

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
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * One client for the OpenAI chat-completions wire format. Handles streaming and
 * non-streaming requests and parses content, reasoning deltas, tool calls, and
 * usage. Ollama and OpenRouter are expressed as configurations of this client.
 */
export class OpenAICompatProvider implements ChatProvider, ListableProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly dialect: ProviderDialect;
  private readonly reasoningParam?: string;

  constructor(options: OpenAICompatOptions = {}) {
    if (options.dialect === 'anthropic') {
      throw new Error('The OpenAI-compatible client cannot speak the anthropic dialect; use AnthropicProvider.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.extraHeaders = { ...(options.headers || {}) };
    this.dialect = options.dialect || 'openai';
    this.reasoningParam = options.reasoningParam;
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
      model: options.model || DEFAULT_MODEL,
      messages: messages.map(toProviderMessage),
      stream,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
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
    const response = await globalThis.fetch(this.url('/models'), {
      headers: this.buildHeaders({ Accept: 'application/json' }),
    });
    if (!response.ok) {
      throw new Error(`models route responded with status ${response.status}`);
    }
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

  async *streamChat(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const response = await globalThis.fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.buildHeaders({ Accept: 'text/event-stream' }),
      signal: options.signal,
      body: JSON.stringify(this.buildBody(messages, options, true)),
    });

    if (!response.ok) {
      throw new Error(`chat completions responded with status ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Response body is not readable');
    }

    let usage: TokenUsage | undefined;
    let sawDone = false;
    const toolCalls = new Map<number, { id?: string; name?: string; args: string }>();

    for await (const line of readLines(response.body)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        sawDone = true;
        yield { content: '', done: true, usage, toolCalls: finalizeToolCalls(toolCalls) };
        continue;
      }
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = json?.choices?.[0]?.delta;
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
      yield { content: '', done: true, usage, toolCalls: finalizeToolCalls(toolCalls) };
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): Promise<CompletionResult> {
    const response = await globalThis.fetch(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.buildHeaders(),
      signal: options.signal,
      body: JSON.stringify(this.buildBody(messages, options, false)),
    });

    if (!response.ok) {
      throw new Error(`chat completions responded with status ${response.status}`);
    }

    const json: any = await response.json();
    const choice = json?.choices?.[0];
    const message = choice?.message || {};
    const reasoning = extractReasoningDelta(message);
    return {
      content: typeof message.content === 'string' ? message.content : '',
      usage: json?.usage ? mapUsage(json.usage) : undefined,
      toolCalls: parseToolCalls(message),
      ...(reasoning ? { reasoning } : {}),
    };
  }
}

export function extractReasoningDelta(delta: any): string | undefined {
  return delta?.reasoning ?? delta?.reasoning_content ?? delta?.thinking ?? undefined;
}

function mapUsage(usage: any): TokenUsage {
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage.total_tokens || prompt + completion,
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
