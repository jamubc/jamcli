/**
 * The performance budgets of D24 and how a set of runs is judged against them. A budget
 * that cannot be met before the interface moves to OpenTUI in stage 6 is recorded here
 * but not enforced.
 */

export interface Budget {
  id: string;
  measure: string;
  /** Milliseconds, or megabytes for memory. */
  limit: number;
  unit: 'ms' | 'MB';
  /** A miss fails the performance job. */
  enforced: boolean;
  /** Why it is not measured or not enforced yet. */
  note?: string;
}

export const BUDGETS: Budget[] = [
  { id: 'version', measure: 'jamcli --version', limit: 60, unit: 'ms', enforced: true },
  {
    id: 'headless',
    measure: 'headless overhead before the first chat request, fake provider, no MCP',
    limit: 150,
    unit: 'ms',
    enforced: false,
    note: 'about 240 ms at 5.6, most of it loading modules; enforced after the build change in stage 6',
  },
  { id: 'grep', measure: 'grep across 20,000 files with ripgrep present', limit: 500, unit: 'ms', enforced: true },
  { id: 'first-frame', measure: 'interface first frame', limit: 250, unit: 'ms', enforced: false, note: 'measured once the interface moves to OpenTUI in stage 6' },
  { id: 'keystroke', measure: 'keystroke to frame, p95, 1,000-message transcript', limit: 16, unit: 'ms', enforced: false, note: 'measured once the interface moves to OpenTUI in stage 6' },
  { id: 'idle-memory', measure: 'idle interface resident memory', limit: 150, unit: 'MB', enforced: false, note: 'measured once the interface moves to OpenTUI in stage 6' },
];

export const median = (values: number[]): number => {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface Result {
  budget: Budget;
  /** Each run, when the measure ran. */
  runs?: number[];
  value?: number;
  verdict: 'within' | 'over' | 'recorded' | 'not measured';
  note?: string;
}

/** Judge each budget: a measured median within or over it, or why there is none. */
export function judge(runs: Record<string, number[] | { skipped: string }>): Result[] {
  return BUDGETS.map((budget) => {
    const measured = runs[budget.id];
    if (!measured) return { budget, verdict: 'not measured', note: budget.note };
    if (!Array.isArray(measured)) return { budget, verdict: 'not measured', note: measured.skipped };
    const value = Math.round(median(measured) * 10) / 10;
    const over = value > budget.limit;
    return { budget, runs: measured, value, verdict: over ? (budget.enforced ? 'over' : 'recorded') : 'within', note: budget.note };
  });
}

export function report(results: Result[]): string {
  const rows = results.map((result) => {
    const value = result.value === undefined ? '-' : `${result.value} ${result.budget.unit}`;
    const note = result.note ? `  (${result.note})` : '';
    return `${result.verdict.padEnd(12)}  ${value.padStart(10)}  budget ${String(result.budget.limit).padStart(4)} ${result.budget.unit}  ${result.budget.measure}${note}`;
  });
  return rows.join('\n');
}

/** Whether the job fails: an enforced budget was missed. */
export const failed = (results: Result[]): boolean => results.some((result) => result.verdict === 'over');
