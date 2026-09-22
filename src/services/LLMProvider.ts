import { Message, TokenUsage } from '../store/index.js';

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

interface OpenRouterProviderOptions {
  apiKey: string;
  baseUrl?: string;
  referer?: string;
  title?: string;
}

export interface ILLMProvider {
  streamChat(messages: Message[], options: ModelOptions): AsyncGenerator<Chunk>;
  complete(messages: Message[], options: ModelOptions): Promise<CompletionResult>;
  listModels?(): Promise<string[]>;
}

function extractReasoningDelta(delta: any): string | undefined {
  return (
    delta?.reasoning ??
    delta?.reasoning_content ??
    delta?.thinking ??
    undefined
  );
}

function parseToolCalls(message: any): ToolCall[] | undefined {
  const rawCalls = message?.tool_calls;
  if (!Array.isArray(rawCalls)) return undefined;

  const normalizeArgs = (value: any) => {
    if (value === undefined || value === null) return {};
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return { value };
      }
    }
    return value;
  };

  const calls = rawCalls
    .map((call: any): ToolCall | null => {
      const fn = call.function || call;
      if (!fn?.name) return null;
      return {
        id: call.id || fn.id,
        name: fn.name,
        type: call.type || 'function',
        arguments: normalizeArgs(fn.arguments),
      };
    })
    .filter(Boolean) as ToolCall[];

  return calls.length ? calls : undefined;
}

export class OllamaProvider implements ILLMProvider {
  private endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      const data = await response.json();
      return data.models?.map((m: any) => m.name) || [];
    } catch (e) {
      return [];
    }
  }

  async *streamChat(messages: Message[], options: ModelOptions): AsyncGenerator<Chunk> {
    const wantReasoning = options.reasoning === 'on' || options.reasoning === 'auto';
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        model: options.model || 'llama3',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        think: wantReasoning || undefined,
        options: { temperature: options.temperature },
        ...options.extraParams,
      }),
    });

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let usage: TokenUsage | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          const msg = json.message || {};
          const content = msg.content || '';
          const reasoning = extractReasoningDelta(msg);

          if (content || reasoning) {
            yield {
              content,
              reasoning,
              done: false
            };
          }
          // Capture usage if available (Ollama provides this in final chunk)
          if (json.prompt_eval_count || json.eval_count) {
            usage = {
              prompt_tokens: json.prompt_eval_count || 0,
              completion_tokens: json.eval_count || 0,
              total_tokens: (json.prompt_eval_count || 0) + (json.eval_count || 0),
            };
          }
          if (json.done) {
            yield { content: '', done: true, usage };
          }
        } catch (e) {
          console.error('Error parsing JSON chunk', e);
        }
      }
    }
  }

  async complete(messages: Message[], options: ModelOptions): Promise<CompletionResult> {
    const wantReasoning = options.reasoning === 'on' || options.reasoning === 'auto';
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model || 'llama3',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        think: wantReasoning || undefined,
        options: { temperature: options.temperature },
        ...options.extraParams,
      }),
    });

    const json = await response.json();
    const usage: TokenUsage | undefined = (json.prompt_eval_count || json.eval_count) ? {
      prompt_tokens: json.prompt_eval_count || 0,
      completion_tokens: json.eval_count || 0,
      total_tokens: (json.prompt_eval_count || 0) + (json.eval_count || 0),
    } : undefined;

    return {
      content: json.message.content,
      usage,
    };
  }
}

export class OpenRouterProvider implements ILLMProvider {
  private readonly options: OpenRouterProviderOptions;

  constructor(options: OpenRouterProviderOptions) {
    this.options = options;
  }

  private endpoint(path: string = '/chat/completions') {
    const base = this.options.baseUrl?.replace(/\/$/, '') || 'https://openrouter.ai/api/v1';
    return `${base}${path}`;
  }

  private buildHeaders(extra?: Record<string, string>) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.options.apiKey}`,
      'HTTP-Referer': this.options.referer || 'https://github.com/jamcli',
      'X-Title': this.options.title || 'jamcli',
      ...extra,
    };
  }

  async *streamChat(messages: Message[], options: ModelOptions): AsyncGenerator<Chunk> {
    const wantReasoning = options.reasoning === 'on' || options.reasoning === 'auto';
    
    const body: any = {
        model: options.model || 'openai/gpt-4o',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        temperature: options.temperature,
        ...options.extraParams
    };

    if (wantReasoning && body.include_reasoning === undefined) {
        body.include_reasoning = true;
    }
    if (options.tools) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice || 'auto';
    }

    const response = await fetch(this.endpoint('/chat/completions'), {
      method: 'POST',
      headers: this.buildHeaders({ Accept: 'text/event-stream' }),
      signal: options.signal,
      body: JSON.stringify(body),
    });

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let usage: TokenUsage | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(line => line.trim() !== '');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true, usage };
            continue;
          }
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            const content = delta?.content;
            const reasoning = extractReasoningDelta(delta);
            
            if (content || reasoning) {
              yield { content: content || '', reasoning, done: false };
            }
            if (json.usage) {
              usage = {
                prompt_tokens: json.usage.prompt_tokens || 0,
                completion_tokens: json.usage.completion_tokens || 0,
                total_tokens: json.usage.total_tokens || 0,
              };
            }
          } catch (e) {
            console.error('Error parsing SSE chunk', e);
          }
        }
      }
    }
  }

  async complete(messages: Message[], options: ModelOptions): Promise<CompletionResult> {
    const body: any = {
        model: options.model || 'openai/gpt-4o',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        temperature: options.temperature,
        ...options.extraParams
    };

    if (options.tools) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice || 'auto';
    }

    const response = await fetch(this.endpoint('/chat/completions'), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    const json = await response.json();
    const choice = json.choices?.[0];
    const message = choice?.message || {};
    const toolCalls = parseToolCalls(message);
    return {
      content: message?.content || '',
      usage: json.usage ? {
        prompt_tokens: json.usage.prompt_tokens || 0,
        completion_tokens: json.usage.completion_tokens || 0,
        total_tokens: json.usage.total_tokens || 0,
      } : undefined,
      toolCalls,
      finishReason: choice?.finish_reason,
      rawMessage: message,
    };
  }
}

export class LLMFactory {
  static createProvider(type: 'ollama' | 'openai' | 'anthropic' | 'openrouter', config: any): ILLMProvider {
    switch (type) {
      case 'ollama':
        return new OllamaProvider(config?.endpoint || 'http://localhost:11434');
      case 'openrouter': {
        const cfg = config || {};
        const apiKey = cfg.api_key || process.env[cfg.key_env_var || 'OPENROUTER_API_KEY'];
        if (!apiKey) throw new Error('OpenRouter API key not found');
        return new OpenRouterProvider({
          apiKey,
          baseUrl: cfg.base_url,
          referer: cfg.referer,
          title: cfg.title,
        });
      }
      default:
        throw new Error(`Provider ${type} not implemented`);
    }
  }
}
