import type { ChatMessage } from '../types.js';
import type { ChatProvider, CompletionResult, ProviderRequestOptions } from './types.js';

/** How each wire format says a reply was cut off at the output limit. */
const OUTPUT_LIMIT_REASONS = new Set(['max_tokens', 'length']);

/**
 * A completion the harness asks for itself, under a cap: a commit draft, a summary, a
 * judgment. Thinking is off, so the cap goes to the answer, and a reply that spent the
 * cap and said nothing is asked for once more with twice the room.
 */
export async function completeWithinCap(provider: ChatProvider, messages: ChatMessage[], options: ProviderRequestOptions & { maxOutputTokens: number }): Promise<CompletionResult> {
  const first = await provider.complete(messages, { reasoning: 'off', ...options });
  const empty = !first.content?.trim();
  if (!empty || !OUTPUT_LIMIT_REASONS.has(first.stopReason ?? '')) return first;
  options.signal?.throwIfAborted();
  const second = await provider.complete(messages, { reasoning: 'off', ...options, maxOutputTokens: options.maxOutputTokens * 2 });
  return first.usage && second.usage
    ? {
        ...second,
        usage: {
          prompt_tokens: first.usage.prompt_tokens + second.usage.prompt_tokens,
          completion_tokens: first.usage.completion_tokens + second.usage.completion_tokens,
          total_tokens: first.usage.total_tokens + second.usage.total_tokens,
          ...(first.usage.cached_tokens !== undefined || second.usage.cached_tokens !== undefined ? { cached_tokens: (first.usage.cached_tokens ?? 0) + (second.usage.cached_tokens ?? 0) } : {}),
        },
      }
    : second;
}
