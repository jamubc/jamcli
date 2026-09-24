import type { ChatProvider, ProviderRequestOptions, StreamChunk } from '../providers/types.js';
import type { ChatMessage, TokenUsage } from '../types.js';
import type { Observer, Span } from './observer.js';

export interface InstrumentOptions {
  observer: Observer;
  /** The provider's name, as `gen_ai.provider.name` reports it. */
  providerName: string;
  /** The span requests are made under: the turn, or the session between turns. */
  parent: () => Span | undefined;
  /** Why the request is made, when it is not the conversation's own: `trust` for the classifier. */
  purpose?: string;
  /** Put what was sent and what came back on the span, as `otel.include_content` asks. */
  includeContent?: boolean;
}

/** Characters of content one span attribute keeps. */
export const CONTENT_LIMIT = 16_000;
const boundedContent = (text: string) => (text.length > CONTENT_LIMIT ? `${text.slice(0, CONTENT_LIMIT)}... (${text.length - CONTENT_LIMIT} more characters)` : text);

/** Messages as the GenAI conventions record them: a role and its text parts, as one JSON string. */
export const contentAttribute = (messages: { role: string; content?: string }[]) =>
  boundedContent(JSON.stringify(messages.map((message) => ({ role: message.role, parts: [{ type: 'text', content: message.content ?? '' }] }))));

const usageAttributes = (usage: TokenUsage | undefined) =>
  usage
    ? {
        'gen_ai.usage.input_tokens': usage.prompt_tokens,
        'gen_ai.usage.output_tokens': usage.completion_tokens,
        ...(usage.cached_tokens ? { 'gen_ai.usage.cache_read.input_tokens': usage.cached_tokens } : {}),
        ...(usage.cache_write_tokens ? { 'gen_ai.usage.cache_creation.input_tokens': usage.cache_write_tokens } : {}),
      }
    : {};

/**
 * A provider that times each request as a `chat {model}` span, with the OpenTelemetry
 * GenAI attributes for what was asked and what it used, and logs it. Everything else
 * passes through unchanged.
 */
export function instrumentProvider(provider: ChatProvider, options: InstrumentOptions): ChatProvider {
  const { observer } = options;
  const begin = (messages: ChatMessage[], request: ProviderRequestOptions) => {
    const model = request.model ?? '';
    const span = observer.startSpan(`chat ${model}`.trim(), {
      parent: options.parent(),
      kind: 'client',
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': options.providerName,
        'gen_ai.request.model': model,
        'gen_ai.request.max_tokens': request.maxOutputTokens,
        'gen_ai.request.temperature': request.temperature,
        'jamcli.request.messages': messages.length,
        'jamcli.request.tools': request.tools?.length,
        ...(options.purpose ? { 'jamcli.purpose': options.purpose } : {}),
        ...(options.includeContent ? { 'gen_ai.input.messages': contentAttribute(messages) } : {}),
      },
    });
    const started = Date.now();
    return {
      finish(usage: TokenUsage | undefined, stopReason: string | undefined, output: string) {
        span.end({
          attributes: {
            ...usageAttributes(usage),
            ...(stopReason ? { 'gen_ai.response.finish_reasons': stopReason } : {}),
            ...(options.includeContent ? { 'gen_ai.output.messages': contentAttribute([{ role: 'assistant', content: output }]) } : {}),
          },
        });
        observer.log('debug', 'model request', {
          provider: options.providerName,
          model,
          ...(options.purpose ? { purpose: options.purpose } : {}),
          duration_ms: Date.now() - started,
          stop: stopReason,
          input_tokens: usage?.prompt_tokens,
          output_tokens: usage?.completion_tokens,
        });
      },
      fail(error: unknown) {
        const message = (error as Error)?.message ?? String(error);
        const aborted = request.signal?.aborted;
        span.end({ error: aborted ? 'cancelled' : message });
        observer.log(aborted ? 'info' : 'error', aborted ? 'model request cancelled' : 'model request failed', {
          provider: options.providerName,
          model,
          duration_ms: Date.now() - started,
          ...(aborted ? {} : { error: message }),
        });
      },
    };
  };

  const wrapped: ChatProvider = {
    get family() {
      return provider.family;
    },
    async *streamChat(messages, request) {
      const call = begin(messages, request);
      let usage: TokenUsage | undefined;
      let stopReason: string | undefined;
      let output = '';
      let failed = false;
      try {
        for await (const chunk of provider.streamChat(messages, request) as AsyncGenerator<StreamChunk>) {
          if (chunk.usage) usage = chunk.usage;
          if (chunk.stopReason) stopReason = chunk.stopReason;
          if (options.includeContent && chunk.content) output += chunk.content;
          yield chunk;
        }
      } catch (error) {
        failed = true;
        call.fail(error);
        throw error;
      } finally {
        // Also when the reader stops early.
        if (!failed) call.finish(usage, stopReason, output);
      }
    },
    async complete(messages, request) {
      const call = begin(messages, request);
      try {
        const result = await provider.complete(messages, request);
        call.finish(result.usage, result.stopReason, result.content ?? '');
        return result;
      } catch (error) {
        call.fail(error);
        throw error;
      }
    },
  };
  if (provider.describeModel) wrapped.describeModel = provider.describeModel.bind(provider);
  // Anything else a provider offers, such as listing its models, stays reachable.
  return new Proxy(wrapped, {
    get(target, key, receiver) {
      if (key in target) return Reflect.get(target, key, receiver);
      const value = (provider as any)[key];
      return typeof value === 'function' ? value.bind(provider) : value;
    },
  });
}
