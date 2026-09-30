import type { TranscriptEvent } from '../transcript/events.js';
import { analyzeCommand } from '../permissions/command.js';
import { readOnlyReason } from '../tools/readonly.js';

/** `note` is a tester's note a reflection reads because the person framed it; the log's failures never produce one. */
export type SignalKind = 'tool_error' | 'denied' | 'cancelled' | 'retry' | 'correction' | 'waste' | 'gate_fail' | 'false_done' | 'limit' | 'context' | 'confabulation' | 'note';

export interface Signal {
  id: number;
  kind: SignalKind;
  /** The kind narrowed: which tool error, who denied, what was wasted. */
  subtype?: string;
  detail: string;
  confidence: 'high' | 'low';
  tool?: string;
  /**
   * `kind/subtype/tool/clause`, with paths, numbers, and quoted text replaced by
   * placeholders, so two sessions that failed the same way share it.
   */
  signature: string;
}

const SPIKE_FACTOR = 3;
const SPIKE_MIN_REQUESTS = 4;
const DETAIL_MAX = 160;
const WRITERS = new Set(['edit', 'write_file', 'apply_patch', 'run_command']);
const CLAIMS_CHANGE = /\bI(?:'ve| have)? (?:changed|updated|edited|fixed|added|removed|wrote|created|renamed|deleted|implemented|applied)\b/i;

const clip = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 3)}...` : line;
};

const argsKey = (args: unknown) => (typeof args === 'string' ? args : JSON.stringify(args ?? {}));

const parseArgs = (args: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Which tool error, from what the tool said. */
const errorSubtype = (status: string | undefined, content: string): string => {
  if (status === 'timeout') return 'timeout';
  if (/^Invalid arguments for|must be one of|missing required argument|unexpected argument|requires a "/.test(content)) return 'schema_invalid';
  if (/are stale|is not an anchor/.test(content)) return 'stale_anchor';
  if (/matches \d+ locations|ambiguous/.test(content)) return 'ambiguous_match';
  if (/was not found|not found|No such file|ENOENT|does not exist/i.test(content)) return 'not_found';
  return 'other';
};

/** A detail with what varies between sessions replaced, so like failures share a signature. */
export function signature(kind: SignalKind, subtype: string | undefined, tool: string | undefined, detail: string): string {
  const clause = detail
    .replace(/(?:[A-Za-z]:)?(?:\/[\w.-]+)+|\b[\w-]+(?:\/[\w.-]+)*\.[A-Za-z0-9]{1,6}\b/g, '<path>')
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '<q>')
    .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[:;]\s/)[0]
    .slice(0, 80)
    .toLowerCase();
  return `${kind}/${subtype ?? '-'}/${tool ?? '-'}/${clause}`;
}

const make = (partial: Omit<Signal, 'signature'>): Signal => ({ ...partial, signature: signature(partial.kind, partial.subtype, partial.tool, partial.detail) });

/**
 * What went wrong in a session, read from its log. One function feeds both `/reflect`
 * and the evaluator, so a failure has one name wherever it is counted.
 */
export function signalsOf(events: TranscriptEvent[]): Signal[] {
  const signals: Signal[] = [];
  const header = events.find((event): event is Extract<TranscriptEvent, { type: 'session' }> => event.type === 'session');
  const projectRoot = header?.projectRoot ?? '/';
  const seenCalls = new Set<string>();
  const reads: { id: number; path: string }[] = [];
  const readPaths = new Map<string, number>();
  const usages: { id: number; tokens: number }[] = [];
  const gateHistory = new Map<string, string>();
  let failedSince = false;
  let wroteThisTurn = false;

  events.forEach((event, id) => {
    if (event.type === 'approval' && !event.allow) {
      const why = event.feedback ?? event.reason;
      const subtype = event.by === 'user' ? 'by_user' : event.by === 'mode' ? 'by_mode' : 'by_rule';
      signals.push(make({ id, kind: 'denied', subtype, tool: event.tool, confidence: 'high', detail: clip(`${event.tool} denied${why ? `: ${why}` : ''}`) }));
      if (event.by === 'user') failedSince = true;
      return;
    }
    if (event.type === 'end') {
      if (event.status === 'cancelled') {
        signals.push(make({ id, kind: 'cancelled', confidence: 'high', detail: 'turn cancelled' }));
        failedSince = true;
      } else if (event.status === 'limit') {
        signals.push(make({ id, kind: 'limit', subtype: 'steps', confidence: 'high', detail: 'turn stopped at a step or call limit' }));
      }
      return;
    }
    if (event.type === 'notice') {
      if (event.message.startsWith('The reply stopped at the output limit')) signals.push(make({ id, kind: 'limit', subtype: 'output_tokens', confidence: 'high', detail: 'reply cut at the output limit' }));
      else if (event.message.startsWith('The conversation is above the context budget')) signals.push(make({ id, kind: 'context', subtype: 'over_budget_notice', confidence: 'high', detail: 'conversation above the context budget' }));
      else if (event.message.startsWith('Stopped: the limit of')) signals.push(make({ id, kind: 'limit', subtype: 'calls_per_turn', confidence: 'high', detail: 'tool calls per turn reached' }));
      return;
    }
    if (event.type === 'compaction') {
      if (event.strategy === 'drop') signals.push(make({ id, kind: 'context', subtype: 'compaction_drop', confidence: 'high', detail: `${event.replaced} messages dropped: the summary failed` }));
      return;
    }
    if (event.type === 'gate') {
      if (event.status === 'failed') {
        const subtype = gateHistory.get(event.name) === 'failed' ? 'after_fix' : 'first_try';
        signals.push(make({ id, kind: 'gate_fail', subtype, tool: event.name, confidence: 'high', detail: clip(`${event.name} (${event.tier}) failed${event.shaped ? `: ${event.shaped.split('\n').slice(1, 2).join('')}` : ''}`) }));
      }
      if (event.status !== 'skipped') gateHistory.set(event.name, event.status);
      return;
    }
    if (event.type === 'steer' && event.handler === 'M5') {
      signals.push(make({ id, kind: 'false_done', subtype: 'stop_denied', confidence: 'high', detail: clip(event.detail) }));
      return;
    }
    if (event.type === 'usage' && !event.delegated) {
      usages.push({ id, tokens: event.usage.total_tokens });
      return;
    }
    if (event.type !== 'message') return;
    const message = event.message;

    if (message.role === 'assistant') {
      const calls = message.tool_calls ?? [];
      for (const call of calls) {
        const key = `${call.function.name}\u0000${argsKey(call.function.arguments)}`;
        if (seenCalls.has(key)) {
          signals.push(make({ id, kind: 'retry', tool: call.function.name, confidence: 'high', detail: clip(`${call.function.name} repeated with the same arguments`) }));
        }
        seenCalls.add(key);
        const args = parseArgs(call.function.arguments);
        if (WRITERS.has(call.function.name)) wroteThisTurn = true;
        if (call.function.name === 'read_file' && typeof args.path === 'string') {
          const path = args.path;
          reads.push({ id, path });
          const earlier = readPaths.get(path);
          if (earlier !== undefined && !seenCalls.has(key) === false && !wroteThisTurn) {
            // Same file read again with different arguments, nothing written since: a redundant read.
            const sameArgs = signals.some((signal) => signal.id === id && signal.kind === 'retry' && signal.tool === 'read_file');
            if (!sameArgs) signals.push(make({ id, kind: 'waste', subtype: 'redundant_read', tool: 'read_file', confidence: 'low', detail: clip(`read ${path} again with nothing written since`) }));
          }
          readPaths.set(path, id);
        }
        if (call.function.name === 'run_command' && typeof args.command === 'string' && readOnlyReason(analyzeCommand(args.command), projectRoot) === undefined) {
          signals.push(make({ id, kind: 'waste', subtype: 'read_via_command', tool: 'run_command', confidence: 'high', detail: clip(`read through a command: ${args.command}`) }));
        }
      }
      if (!calls.length && CLAIMS_CHANGE.test(message.content) && !wroteThisTurn) {
        signals.push(make({ id, kind: 'confabulation', subtype: 'claimed_change', confidence: 'low', detail: clip(`claimed a change with nothing written this turn: ${message.content}`) }));
      }
      return;
    }
    if (message.role === 'tool') {
      const tool = message.toolName ?? 'tool';
      if (message.toolStatus === 'error' || message.toolStatus === 'timeout') {
        signals.push(make({ id, kind: 'tool_error', subtype: errorSubtype(message.toolStatus, message.content), tool, confidence: 'high', detail: clip(`${tool} ${message.toolStatus}: ${message.content}`) }));
        failedSince = true;
      } else if (message.toolStatus === 'cancelled') {
        signals.push(make({ id, kind: 'cancelled', tool, confidence: 'high', detail: `${tool} cancelled` }));
        failedSince = true;
      }
      return;
    }
    if (message.role === 'user') {
      if (failedSince && !message.content.startsWith('[')) signals.push(make({ id, kind: 'correction', confidence: 'low', detail: clip(message.content) }));
      if (!message.content.startsWith('[')) {
        failedSince = false;
        wroteThisTurn = false;
        readPaths.clear();
      }
    }
  });

  if (usages.length >= SPIKE_MIN_REQUESTS) {
    const typical = median(usages.map((usage) => usage.tokens));
    for (const usage of usages) {
      if (typical > 0 && usage.tokens > typical * SPIKE_FACTOR) {
        signals.push(make({ id: usage.id, kind: 'waste', subtype: 'spike', confidence: 'high', detail: `request used ${usage.tokens} tokens, ${Math.round(usage.tokens / typical)}x the session's median` }));
      }
    }
  }

  for (const read of reads) {
    const mentioned = events.slice(read.id + 1).some((event) => {
      if (event.type !== 'message' || event.message.role !== 'assistant') return false;
      const calls = (event.message.tool_calls ?? []).map((call) => argsKey(call.function.arguments)).join('\n');
      return event.message.content.includes(read.path) || calls.includes(read.path);
    });
    if (!mentioned) signals.push(make({ id: read.id, kind: 'waste', subtype: 'unused_read', tool: 'read_file', confidence: 'low', detail: clip(`read ${read.path} and never used it`) }));
  }

  return signals.sort((a, b) => a.id - b.id);
}
