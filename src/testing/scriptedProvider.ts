import type { ChatMessage, ReasoningBlock } from '../core/types.js';
import type { ChatProvider, CompletionResult, ProviderFamily, ProviderRequestOptions, StreamChunk } from '../core/providers/types.js';
import type { ScriptedTurn } from './fakeProvider.js';

export interface ScriptedCall {
  messages: ChatMessage[];
  options: ProviderRequestOptions;
}

export interface ScriptedProvider extends ChatProvider {
  readonly calls: ScriptedCall[];
  enqueue(...turns: ScriptedTurn[]): void;
}

const pieces = (text: string, size: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
};

const abortError = () => Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });

/**
 * An in-memory provider that plays scripted turns, for fast engine tests. It uses the
 * fake server's turn format. A turn with a `status` throws, `delayMs` waits between
 * chunks (so a test can cancel mid-stream), and every request is recorded.
 */
export function createScriptedProvider(turns: ScriptedTurn[] = [], family: ProviderFamily = 'openai'): ScriptedProvider {
  const queue = [...turns];
  const calls: ScriptedCall[] = [];

  const next = (messages: ChatMessage[], options: ProviderRequestOptions): ScriptedTurn => {
    calls.push({ messages: messages.map((message) => ({ ...message })), options });
    const turn = queue.shift();
    if (!turn) throw new Error('scripted provider: no turn left');
    if (turn.status && turn.status !== 200) {
      throw Object.assign(new Error(`scripted provider returned ${turn.status}`), { status: turn.status });
    }
    return turn;
  };

  const reasoningBlocks = (turn: ScriptedTurn): ReasoningBlock[] | undefined =>
    turn.reasoning ? [{ type: 'thinking', text: turn.reasoning, ...(turn.reasoningSignature ? { signature: turn.reasoningSignature } : {}) }] : undefined;

  const toolCalls = (turn: ScriptedTurn) =>
    turn.toolCalls?.map((call, index) => ({
      id: call.id ?? `call_${calls.length}_${index}`,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));

  const usage = (turn: ScriptedTurn) =>
    turn.usage
      ? { prompt_tokens: turn.usage.prompt, completion_tokens: turn.usage.completion, total_tokens: turn.usage.prompt + turn.usage.completion }
      : undefined;

  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });

  return {
    family,
    calls,
    enqueue: (...more: ScriptedTurn[]) => {
      queue.push(...more);
    },
    async *streamChat(messages: ChatMessage[], options: ProviderRequestOptions): AsyncGenerator<StreamChunk> {
      const turn = next(messages, options);
      const size = turn.chunkSize ?? 4;
      for (const part of pieces(turn.reasoning ?? '', size)) {
        if (turn.delayMs) await wait(turn.delayMs, options.signal);
        yield { content: '', reasoning: part, done: false };
      }
      for (const part of pieces(turn.text ?? '', size)) {
        if (turn.delayMs) await wait(turn.delayMs, options.signal);
        yield { content: part, done: false };
      }
      if (options.signal?.aborted) throw abortError();
      yield {
        content: '',
        done: true,
        usage: usage(turn),
        toolCalls: toolCalls(turn),
        reasoningBlocks: reasoningBlocks(turn),
        stopReason: turn.toolCalls?.length ? 'tool_calls' : 'stop',
      };
    },
    async complete(messages: ChatMessage[], options: ProviderRequestOptions): Promise<CompletionResult> {
      const turn = next(messages, options);
      return {
        content: turn.text ?? '',
        usage: usage(turn),
        toolCalls: toolCalls(turn),
        ...(turn.reasoning ? { reasoning: turn.reasoning, reasoningBlocks: reasoningBlocks(turn) } : {}),
      };
    },
  };
}
