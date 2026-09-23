import type { ChatMessage, TokenUsage } from '../types.js';
import type {
  ChatProvider,
  CompletionResult,
  ListableProvider,
  ProviderModelInfo,
  ProviderRequestOptions,
  StreamChunk,
} from './types.js';
import { extractReasoningDelta, parseToolCalls, readLines } from './openai-compat.js';

export interface OllamaProviderOptions {
  endpoint: string;
}

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';

/**
 * The local-first path. Ollama exposes a native ndjson chat route that works
 * without a network account; this client keeps that path intact. A base URL
 * that ends in `/v1` is served by the OpenAI-compatible client instead.
 */
export class OllamaProvider implements ChatProvider, ListableProvider {
  private readonly endpoint: string;

  constructor(options: OllamaProviderOptions | string = DEFAULT_ENDPOINT) {
    const endpoint = typeof options === 'string' ? options : options.endpoint;
    this.endpoint = (endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  }

  private url(path: string): string {
    return `${this.endpoint}${path}`;
  }

  async listModels(): Promise<ProviderModelInfo[]> {
    const response = await globalThis.fetch(this.url('/api/tags'));
    if (!response.ok) {
      throw new Error(`ollama tags responded with status ${response.status}`);
    }
    const data: any = await response.json();
    const models: any[] = Array.isArray(data?.models) ? data.models : [];
    return models
      .map((model: any): ProviderModelInfo | null => {
        const name = model?.name ?? model?.model;
        return typeof name === 'string' && name ? { id: name, name } : null;
      })
      .filter((model): model is ProviderModelInfo => model !== null);
  }

  async *streamChat(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const wantReasoning = options.reasoning === 'on' || options.reasoning === 'auto';
    const response = await globalThis.fetch(this.url('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages: messages.map(toOllamaMessage),
        stream: true,
        think: wantReasoning || undefined,
        options: buildNativeOptions(options),
        ...(options.extraParams || {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`ollama chat responded with status ${response.status}: ${await readErrorBody(response)}`);
    }
    if (!response.body) {
      throw new Error('Response body is not readable');
    }

    let usage: TokenUsage | undefined;
    let sawDone = false;

    for await (const line of readLines(response.body)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let json: any;
      try {
        json = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const message = json?.message || {};
      const content = typeof message.content === 'string' ? message.content : '';
      const reasoning = extractReasoningDelta(message);
      if (content || reasoning) {
        yield { content, reasoning, done: false };
      }
      const chunkUsage = ollamaUsage(json);
      if (chunkUsage) usage = chunkUsage;
      if (json?.done) {
        sawDone = true;
        yield { content: '', done: true, usage, toolCalls: parseToolCalls(message) };
      }
    }

    if (!sawDone) {
      yield { content: '', done: true, usage };
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): Promise<CompletionResult> {
    const wantReasoning = options.reasoning === 'on' || options.reasoning === 'auto';
    const response = await globalThis.fetch(this.url('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages: messages.map(toOllamaMessage),
        stream: false,
        think: wantReasoning || undefined,
        options: buildNativeOptions(options),
        ...(options.extraParams || {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`ollama chat responded with status ${response.status}: ${await readErrorBody(response)}`);
    }

    const json: any = await response.json();
    const message = json?.message || {};
    const reasoning = extractReasoningDelta(message);
    return {
      content: typeof message.content === 'string' ? message.content : '',
      usage: ollamaUsage(json),
      toolCalls: parseToolCalls(message),
      ...(reasoning ? { reasoning } : {}),
    };
  }
}

function buildNativeOptions(options: ProviderRequestOptions): Record<string, unknown> {
  if (options.temperature === undefined) return {};
  return { temperature: options.temperature };
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
    // Ollama's native shape carries neither the wire id nor the call type.
    out.tool_calls = message.tool_calls.map((call) => ({
      function: {
        name: call.function?.name,
        arguments: normalizeArguments(call.function?.arguments),
      },
    }));
  }
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

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 400) || 'no response body';
  } catch {
    return 'unreadable response body';
  }
}
