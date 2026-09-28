import type { TranscriptEvent } from '../transcript/events.js';
import { signalsOf, type Signal } from '../reflection/signals.js';

/** One session's log with what its checks said, as the clustering reads it. */
export interface ScoredSession {
  id: string;
  events: TranscriptEvent[];
  /** Whether the task's checks all passed. Absent when the run had no checks. */
  success?: boolean;
}

export interface Cluster {
  signature: string;
  kind: Signal['kind'];
  subtype?: string;
  tool?: string;
  count: number;
  sessions: number;
  /** Sessions the signature appears in that failed their checks. */
  failedSessions: number;
  /** Tokens spent in the step the signal fell in and the step after it, summed. */
  tokens: number;
  weight: number;
  examples: string[];
}

/** How many occurrences' worth of tokens a failed task adds to a cluster's weight. */
const FAILED_TASK_WEIGHT = 5;
const EXAMPLES = 3;

/** The prompt tokens of the request that made the step a signal falls in, and of the step after: the cost of the failure and its repair. */
function tokensAround(events: TranscriptEvent[], id: number): number {
  let total = 0;
  let seen = 0;
  for (let index = id; index < events.length && seen < 2; index += 1) {
    const event = events[index];
    if (event.type === 'usage' && !event.delegated) {
      total += event.usage.total_tokens;
      seen += 1;
    }
  }
  return total;
}

/**
 * Group every signal across sessions by its signature, weight each group by what it
 * cost and by the tasks it appears in that failed, and rank. Deterministic: no
 * embedding, no model call.
 */
export function cluster(sessions: ScoredSession[]): Cluster[] {
  const groups = new Map<string, Cluster & { seen: Set<string>; failed: Set<string> }>();
  for (const session of sessions) {
    const signals = signalsOf(session.events);
    for (const signal of signals) {
      const group = groups.get(signal.signature) ?? {
        signature: signal.signature,
        kind: signal.kind,
        ...(signal.subtype ? { subtype: signal.subtype } : {}),
        ...(signal.tool ? { tool: signal.tool } : {}),
        count: 0,
        sessions: 0,
        failedSessions: 0,
        tokens: 0,
        weight: 0,
        examples: [],
        seen: new Set<string>(),
        failed: new Set<string>(),
      };
      group.count += 1;
      group.tokens += tokensAround(session.events, signal.id);
      group.seen.add(session.id);
      if (session.success === false) group.failed.add(session.id);
      if (group.examples.length < EXAMPLES) group.examples.push(`${session.id}[${signal.id}] ${signal.detail}`);
      groups.set(signal.signature, group);
    }
  }
  return [...groups.values()]
    .map(({ seen, failed, ...group }) => ({ ...group, sessions: seen.size, failedSessions: failed.size, weight: group.tokens + FAILED_TASK_WEIGHT * failed.size * Math.max(1, group.tokens / Math.max(1, group.count)) }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.signature.localeCompare(b.signature));
}

/** Which surface owns a cluster's cause, from the routing table. The proposer changes only that surface. */
export type Surface = 'tool_schema' | 'tool_error' | 'prompt_reads' | 'prompt_dedupe' | 'backpressure' | 'after_edit' | 'elision' | 'notes' | 'dedupe' | 'delegation' | 'none';

export function route(entry: Pick<Cluster, 'kind' | 'subtype'>): Surface {
  switch (entry.kind) {
    case 'tool_error':
      return entry.subtype === 'schema_invalid' ? 'tool_schema' : 'tool_error';
    case 'waste':
      return entry.subtype === 'read_via_command' ? 'prompt_reads' : entry.subtype === 'unused_read' || entry.subtype === 'redundant_read' ? 'prompt_dedupe' : 'none';
    case 'denied':
      return entry.subtype === 'by_mode' ? 'prompt_reads' : 'none';
    case 'false_done':
      return 'backpressure';
    case 'gate_fail':
      return entry.subtype === 'after_fix' ? 'backpressure' : 'after_edit';
    case 'context':
      return 'elision';
    case 'confabulation':
      return 'notes';
    case 'retry':
      return 'dedupe';
    case 'limit':
      return entry.subtype === 'steps' ? 'delegation' : 'none';
    default:
      return 'none';
  }
}
