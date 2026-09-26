import type { TranscriptEvent } from '../transcript/events.js';

/**
 * What went wrong in a session, read from its log. Nothing here calls a model or records
 * anything new: every signal is a fact the log already holds. A signal's `id` is the index
 * of the event it came from in `SessionLog.events()`, so any citation of it can be checked
 * against the log.
 */

export type SignalKind = 'tool_error' | 'denied' | 'cancelled' | 'retry' | 'correction' | 'waste';

export interface Signal {
  id: number;
  kind: SignalKind;
  /** One line a person or a model can read, such as `edit_file failed: no match`. */
  detail: string;
  /** Low when the signal is a guess, as a correction read from a user's words is. */
  confidence: 'high' | 'low';
  tool?: string;
}

/** A usage this many times the session's median counts as a spike. */
const SPIKE_FACTOR = 3;
/** Spikes are not judged on fewer requests than this; the median means nothing yet. */
const SPIKE_MIN_REQUESTS = 4;
const DETAIL_MAX = 160;

const clip = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 3)}...` : line;
};

const argsKey = (args: unknown) => (typeof args === 'string' ? args : JSON.stringify(args ?? {}));

const readPath = (args: unknown): string | undefined => {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    return typeof parsed?.path === 'string' ? parsed.path : undefined;
  } catch {
    return undefined;
  }
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function signalsOf(events: TranscriptEvent[]): Signal[] {
  const signals: Signal[] = [];
  const seenCalls = new Set<string>();
  const reads: { id: number; path: string }[] = [];
  const usages: { id: number; tokens: number }[] = [];
  let failedSince = false;

  events.forEach((event, id) => {
    if (event.type === 'approval' && !event.allow) {
      const why = event.feedback ?? event.reason;
      signals.push({ id, kind: 'denied', tool: event.tool, confidence: 'high', detail: clip(`${event.tool} denied${why ? `: ${why}` : ''}`) });
      failedSince = true;
      return;
    }
    if (event.type === 'end' && event.status === 'cancelled') {
      signals.push({ id, kind: 'cancelled', confidence: 'high', detail: 'turn cancelled' });
      failedSince = true;
      return;
    }
    if (event.type === 'usage' && !event.delegated) {
      usages.push({ id, tokens: event.usage.total_tokens });
      return;
    }
    if (event.type !== 'message') return;
    const message = event.message;

    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) {
        const key = `${call.function.name}\u0000${argsKey(call.function.arguments)}`;
        if (seenCalls.has(key)) {
          signals.push({ id, kind: 'retry', tool: call.function.name, confidence: 'high', detail: clip(`${call.function.name} repeated with the same arguments`) });
        }
        seenCalls.add(key);
        const file = call.function.name === 'read_file' ? readPath(call.function.arguments) : undefined;
        if (file) reads.push({ id, path: file });
      }
      return;
    }
    if (message.role === 'tool') {
      const tool = message.toolName ?? 'tool';
      if (message.toolStatus === 'error' || message.toolStatus === 'timeout') {
        signals.push({ id, kind: 'tool_error', tool, confidence: 'high', detail: clip(`${tool} ${message.toolStatus}: ${message.content}`) });
        failedSince = true;
      } else if (message.toolStatus === 'cancelled') {
        signals.push({ id, kind: 'cancelled', tool, confidence: 'high', detail: `${tool} cancelled` });
        failedSince = true;
      }
      return;
    }
    if (message.role === 'user') {
      if (failedSince) signals.push({ id, kind: 'correction', confidence: 'low', detail: clip(message.content) });
      failedSince = false;
    }
  });

  if (usages.length >= SPIKE_MIN_REQUESTS) {
    const typical = median(usages.map((usage) => usage.tokens));
    for (const usage of usages) {
      if (typical > 0 && usage.tokens > typical * SPIKE_FACTOR) {
        signals.push({ id: usage.id, kind: 'waste', confidence: 'high', detail: `request used ${usage.tokens} tokens, ${Math.round(usage.tokens / typical)}x the session's median` });
      }
    }
  }

  for (const read of reads) {
    const mentioned = events.slice(read.id + 1).some((event) => {
      if (event.type !== 'message' || event.message.role !== 'assistant') return false;
      const calls = (event.message.tool_calls ?? []).map((call) => argsKey(call.function.arguments)).join('\n');
      return event.message.content.includes(read.path) || calls.includes(read.path);
    });
    if (!mentioned) signals.push({ id: read.id, kind: 'waste', tool: 'read_file', confidence: 'low', detail: clip(`read ${read.path} and never used it`) });
  }

  return signals.sort((a, b) => a.id - b.id);
}
