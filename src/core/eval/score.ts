import type { TranscriptEvent } from '../transcript/events.js';
import { signalsOf, type Signal } from '../reflection/signals.js';
import { analyzeCommand } from '../permissions/command.js';
import { readOnlyReason } from '../tools/readonly.js';

export interface CheckResult {
  check: string;
  pass: boolean;
}

/** One run, scored from its log alone, plus the checks the task declared. */
export interface Metrics {
  /** Every check passed. Absent when the run had no checks. */
  success?: boolean;
  tokensIn: number;
  tokensOut: number;
  cachedShare: number;
  cacheBreaks: number;
  costUsd: number;
  unpricedRequests: number;
  requests: number;
  steps: number;
  calls: number;
  /** Approvals a person made, by tool. */
  approvals: Record<string, number>;
  /** Tool errors by signature. */
  toolErrors: Record<string, number>;
  gateRuns: { tier: string; name: string; status: string; durationMs: number; byModel: boolean }[];
  falseDone: number;
  compactions: Record<string, number>;
  elisions: { count: number; tokensRemoved: number };
  steers: Record<string, number>;
  wallSeconds: number;
  /** Deterministic component scores. */
  components: {
    readsBeforeFirstEdit: number;
    editsPerFilePerTurn: number;
    readViaCommand: number;
    /** Share of T1 runs that passed on the first tree they saw. Absent when none ran. */
    gateFirstTry?: number;
    /** Steps between a failing gate and the next passing run of it, median. Absent when no gate failed. */
    repairSteps?: number;
    /** Every path edited before a compaction is named in its summary. Absent when nothing was compacted. */
    summaryFidelity?: boolean;
    /** After a reset handoff, steps until the first write-class call. Absent without a handoff. */
    handoffPickup?: number;
  };
  signals: Signal[];
}

const WRITERS = new Set(['edit', 'write_file', 'apply_patch']);

const parseArgs = (args: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const medianOf = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** A pure function from a session's events, and its checks, to the metrics a trial reports. */
export function score(events: TranscriptEvent[], checks: CheckResult[] = []): Metrics {
  const header = events.find((event): event is Extract<TranscriptEvent, { type: 'session' }> => event.type === 'session');
  const projectRoot = header?.projectRoot ?? '/';
  const signals = signalsOf(events);
  let tokensIn = 0;
  let tokensOut = 0;
  let cached = 0;
  let cost = 0;
  let unpriced = 0;
  let requests = 0;
  let contexts = 0;
  let steps = 0;
  let calls = 0;
  const approvals: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};
  const gateRuns: Metrics['gateRuns'] = [];
  const compactions: Record<string, number> = {};
  const steers: Record<string, number> = {};
  let elisionCount = 0;
  let elisionTokens = 0;
  let falseDone = 0;
  let firstEdit = false;
  let readsBeforeFirstEdit = 0;
  let readViaCommand = 0;
  /** Files edited per turn, for the mean. */
  const editsByTurn: Map<string, number>[] = [];
  const editedBeforeCompaction = new Set<string>();
  let summaryFidelity: boolean | undefined;
  let handoffAt: number | undefined;
  let handoffPickup: number | undefined;
  let stepsSinceHandoff = 0;
  const firstTreeSeen = new Map<string, string>();
  let firstTryPassed = 0;
  let firstTryTotal = 0;
  const openFailures = new Map<string, number>();
  const repairs: number[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'usage':
        if (event.delegated) break;
        requests += 1;
        tokensIn += event.usage.prompt_tokens ?? 0;
        tokensOut += event.usage.completion_tokens ?? 0;
        cached += event.usage.cached_tokens ?? 0;
        if (event.cost === undefined) unpriced += 1;
        else cost += event.cost;
        break;
      case 'context':
        contexts += 1;
        break;
      case 'approval':
        if (event.allow && event.by === 'user') approvals[event.tool] = (approvals[event.tool] ?? 0) + 1;
        break;
      case 'gate': {
        gateRuns.push({ tier: event.tier, name: event.name, status: event.status, durationMs: event.durationMs, byModel: Boolean(event.byModel) });
        if (event.tier === 'T1' && event.status !== 'skipped' && event.tree && !firstTreeSeen.has(event.tree)) {
          firstTreeSeen.set(event.tree, event.status);
          firstTryTotal += 1;
          if (event.status === 'passed') firstTryPassed += 1;
        }
        if (event.status === 'failed') openFailures.set(event.name, steps);
        else if (event.status === 'passed' && openFailures.has(event.name)) {
          repairs.push(steps - openFailures.get(event.name)!);
          openFailures.delete(event.name);
        }
        break;
      }
      case 'steer':
        steers[event.handler] = (steers[event.handler] ?? 0) + 1;
        if (event.handler === 'M5') falseDone += 1;
        break;
      case 'compaction': {
        compactions[event.strategy ?? 'summary'] = (compactions[event.strategy ?? 'summary'] ?? 0) + 1;
        const named = [...editedBeforeCompaction].every((file) => event.summary.includes(file));
        summaryFidelity = summaryFidelity === undefined ? named : summaryFidelity && named;
        editedBeforeCompaction.clear();
        break;
      }
      case 'elision':
        elisionCount += 1;
        elisionTokens += event.tokensRemoved;
        break;
      case 'handoff':
        break;
      case 'message': {
        const message = event.message;
        if (message.role === 'user') {
          if (!message.content.startsWith('[')) editsByTurn.push(new Map());
          if (message.content.includes('[Handoff from the previous session')) {
            handoffAt = steps;
            stepsSinceHandoff = 0;
          }
          break;
        }
        if (message.role === 'tool') {
          if (message.toolStatus === 'error' || message.toolStatus === 'timeout') {
            const signal = signals.find((entry) => entry.kind === 'tool_error' && entry.id === events.indexOf(event));
            const key = signal?.signature ?? `tool_error/-/${message.toolName ?? 'tool'}/-`;
            toolErrors[key] = (toolErrors[key] ?? 0) + 1;
          }
          break;
        }
        if (message.role !== 'assistant') break;
        steps += 1;
        if (handoffAt !== undefined && handoffPickup === undefined) stepsSinceHandoff += 1;
        for (const call of message.tool_calls ?? []) {
          calls += 1;
          const name = call.function.name;
          const args = parseArgs(call.function.arguments);
          if (WRITERS.has(name)) {
            firstEdit = true;
            if (handoffAt !== undefined && handoffPickup === undefined) handoffPickup = stepsSinceHandoff;
            const path = typeof args.path === 'string' ? args.path : undefined;
            if (path) {
              editedBeforeCompaction.add(path);
              const turn = editsByTurn.at(-1);
              if (turn) turn.set(path, (turn.get(path) ?? 0) + 1);
            }
          } else if (name === 'read_file' || name === 'grep' || name === 'glob') {
            if (!firstEdit) readsBeforeFirstEdit += 1;
          } else if (name === 'run_command' && typeof args.command === 'string') {
            if (readOnlyReason(analyzeCommand(args.command), projectRoot) === undefined) readViaCommand += 1;
            if (!firstEdit) readsBeforeFirstEdit += 0;
          }
        }
        break;
      }
      default:
        break;
    }
  }
  const editCounts = editsByTurn.flatMap((turn) => [...turn.values()]);
  const started = header?.ts ?? events[0]?.ts ?? 0;
  const ended = events.at(-1)?.ts ?? started;
  return {
    ...(checks.length ? { success: checks.every((check) => check.pass) } : {}),
    tokensIn,
    tokensOut,
    cachedShare: tokensIn ? cached / tokensIn : 0,
    cacheBreaks: Math.max(0, contexts - 1),
    costUsd: cost,
    unpricedRequests: unpriced,
    requests,
    steps,
    calls,
    approvals,
    toolErrors,
    gateRuns,
    falseDone,
    compactions,
    elisions: { count: elisionCount, tokensRemoved: elisionTokens },
    steers,
    wallSeconds: Math.max(0, (ended - started) / 1000),
    components: {
      readsBeforeFirstEdit,
      editsPerFilePerTurn: editCounts.length ? editCounts.reduce((sum, value) => sum + value, 0) / editCounts.length : 0,
      readViaCommand,
      ...(firstTryTotal ? { gateFirstTry: firstTryPassed / firstTryTotal } : {}),
      ...(repairs.length ? { repairSteps: medianOf(repairs)! } : {}),
      ...(summaryFidelity !== undefined ? { summaryFidelity } : {}),
      ...(handoffPickup !== undefined ? { handoffPickup } : {}),
    },
    signals,
  };
}

/** The metrics as a short table, for a person. */
export function describeMetrics(metrics: Metrics): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const lines = [
    ...(metrics.success !== undefined ? [`success: ${metrics.success ? 'yes' : 'no'}`] : []),
    `tokens: ${metrics.tokensIn} in, ${metrics.tokensOut} out, cached ${pct(metrics.cachedShare)}, prefix breaks ${metrics.cacheBreaks}`,
    `cost: $${metrics.costUsd.toFixed(4)}${metrics.unpricedRequests ? ` plus ${metrics.unpricedRequests} unpriced` : ''} over ${metrics.requests} requests`,
    `steps: ${metrics.steps}, calls: ${metrics.calls}, wall: ${metrics.wallSeconds.toFixed(1)} s`,
    `approvals by a person: ${Object.entries(metrics.approvals).map(([tool, count]) => `${tool} ${count}`).join(', ') || 'none'}`,
    `tool errors: ${Object.entries(metrics.toolErrors).map(([key, count]) => `${key} ${count}`).join(', ') || 'none'}`,
    `gates: ${metrics.gateRuns.map((gate) => `${gate.name} ${gate.status}${gate.byModel ? ' (model)' : ''}`).join(', ') || 'none'}; stops denied: ${metrics.falseDone}`,
    `compactions: ${Object.entries(metrics.compactions).map(([key, count]) => `${key} ${count}`).join(', ') || 'none'}; elisions: ${metrics.elisions.count} (${metrics.elisions.tokensRemoved} tokens)`,
    `steers: ${Object.entries(metrics.steers).map(([key, count]) => `${key} ${count}`).join(', ') || 'none'}`,
    `components: reads before first edit ${metrics.components.readsBeforeFirstEdit}, edits per file per turn ${metrics.components.editsPerFilePerTurn.toFixed(2)}, reads via command ${metrics.components.readViaCommand}` +
      `${metrics.components.gateFirstTry !== undefined ? `, gate first try ${pct(metrics.components.gateFirstTry)}` : ''}` +
      `${metrics.components.repairSteps !== undefined ? `, repair steps ${metrics.components.repairSteps}` : ''}` +
      `${metrics.components.summaryFidelity !== undefined ? `, summary fidelity ${metrics.components.summaryFidelity ? 'held' : 'lost'}` : ''}` +
      `${metrics.components.handoffPickup !== undefined ? `, handoff pickup ${metrics.components.handoffPickup}` : ''}`,
    `signals: ${metrics.signals.length}${metrics.signals.length ? ` (${[...new Set(metrics.signals.map((signal) => signal.signature))].slice(0, 5).join('; ')})` : ''}`,
  ];
  return lines.join('\n');
}
