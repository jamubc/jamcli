import type { ChatMessage, ProviderToolCall, TokenUsage } from '../types.js';
import type {
  ChatProvider,
  CompletionResult,
  ListableProvider,
  ProviderModelInfo,
  ProviderRequestOptions,
  StreamChunk,
} from './types.js';
import { readLines } from './openai-compat.js';

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  version?: string;
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * The Anthropic Messages translation seam. This is the only module that sets
 * the `x-api-key` and `anthropic-version` headers. Requests and streaming
 * responses are translated at this boundary; tool calls and reasoning
 * (thinking) blocks survive in both directions.
 */
export class AnthropicProvider implements ChatProvider, ListableProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly maxTokens: number;
  private readonly version: string;

  constructor(options: AnthropicProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.extraHeaders = { ...(options.headers || {}) };
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.version = options.version || DEFAULT_VERSION;
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
        const blocks: AnthropicContentBlock[] = [];
        if (message.reasoning) {
          blocks.push({ type: 'thinking', thinking: message.reasoning });
        }
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
      model: options.model || DEFAULT_MODEL,
      max_tokens: this.maxTokens,
      messages: translated,
      stream,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.extraParams || {}),
    };
    if (system.length) body.system = system.join('\n\n');
    if (options.tools?.length) {
      body.tools = options.tools.map((tool) => ({
        name: tool.function.name,
        ...(tool.function.description ? { description: tool.function.description } : {}),
        input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
      }));
      body.tool_choice = mapToolChoice(options.toolChoice);
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

  async *streamChat(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): AsyncGenerator<StreamChunk> {
    const response = await globalThis.fetch(this.url('/messages'), {
      method: 'POST',
      headers: this.buildHeaders({ Accept: 'text/event-stream' }),
      signal: options.signal,
      body: JSON.stringify(this.buildBody(messages, options, true)),
    });

    if (!response.ok) {
      throw new Error(`anthropic messages responded with status ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Response body is not readable');
    }

    let usage: TokenUsage | undefined;
    let inputTokens = 0;
    let sawStop = false;
    const blocks = new Map<number, { type: string; id?: string; name?: string; json: string }>();

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
          inputTokens = event?.message?.usage?.input_tokens || 0;
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
          });
          break;
        }
        case 'content_block_delta': {
          const index = typeof event.index === 'number' ? event.index : 0;
          const delta = event?.delta || {};
          if (delta.type === 'text_delta' && delta.text) {
            yield { content: delta.text, done: false };
          } else if (delta.type === 'thinking_delta' && delta.thinking) {
            yield { content: '', reasoning: delta.thinking, done: false };
          } else if (delta.type === 'input_json_delta') {
            const entry = blocks.get(index);
            if (entry && typeof delta.partial_json === 'string') {
              entry.json += delta.partial_json;
            }
          }
          break;
        }
        case 'message_delta': {
          const output = event?.usage?.output_tokens || 0;
          if (inputTokens || output) {
            usage = {
              prompt_tokens: inputTokens,
              completion_tokens: output,
              total_tokens: inputTokens + output,
            };
          }
          break;
        }
        case 'message_stop': {
          sawStop = true;
          yield { content: '', done: true, usage, toolCalls: finalizeBlocks(blocks) };
          break;
        }
        case 'error': {
          throw new Error(event?.error?.message || 'anthropic stream returned an error');
        }
        default:
          break;
      }
    }

    if (!sawStop) {
      yield { content: '', done: true, usage, toolCalls: finalizeBlocks(blocks) };
    }
  }

  async complete(
    messages: ChatMessage[],
    options: ProviderRequestOptions
  ): Promise<CompletionResult> {
    const response = await globalThis.fetch(this.url('/messages'), {
      method: 'POST',
      headers: this.buildHeaders(),
      signal: options.signal,
      body: JSON.stringify(this.buildBody(messages, options, false)),
    });

    if (!response.ok) {
      throw new Error(`anthropic messages responded with status ${response.status}`);
    }

    const json: any = await response.json();
    let content = '';
    let reasoning = '';
    const toolCalls: ProviderToolCall[] = [];
    for (const block of json?.content || []) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        content += block.text;
      } else if ((block?.type === 'thinking' || block?.type === 'redacted_thinking') && block.thinking) {
        reasoning += block.thinking;
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
      usage: mapUsage(json?.usage),
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }
}

function mapUsage(usage: any): TokenUsage | undefined {
  if (!usage) return undefined;
  const prompt = usage.input_tokens || 0;
  const completion = usage.output_tokens || 0;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
  };
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

function finalizeBlocks(
  blocks: Map<number, { type: string; id?: string; name?: string; json: string }>
): ProviderToolCall[] | undefined {
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
