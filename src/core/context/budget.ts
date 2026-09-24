/** The output reserved when the model's output limit is unknown, never more than a quarter of the window. */
const DEFAULT_OUTPUT_RESERVE = 8_192;
/** The share of the window held back for what the estimate misses. */
const MARGIN = 0.1;
/** The share of the budget at which compaction starts. */
const TRIGGER = 0.85;

export interface ContextBudget {
  /** The model's context window, in tokens. */
  window: number;
  /** Tokens held for the reply. */
  outputReserve: number;
  /** Tokens held back for what the estimate misses. */
  margin: number;
  /** What a request may use: the window, less the reserve and the margin. */
  budget: number;
  /** Compaction starts once a request would use more than this. */
  trigger: number;
}

/**
 * The context budget for a model: its window, less the output a reply may need, less a
 * tenth of the window, with compaction starting at 85 percent of what is left. A reserve
 * larger than half the window is taken as half, so a misconfigured limit cannot leave
 * no room at all.
 */
export function contextBudget(window: number, outputReserve?: number): ContextBudget {
  const wanted = outputReserve && outputReserve > 0 ? outputReserve : Math.min(DEFAULT_OUTPUT_RESERVE, Math.floor(window / 4));
  const reserve = Math.min(wanted, Math.floor(window / 2));
  const margin = Math.floor(window * MARGIN);
  const budget = Math.max(0, window - reserve - margin);
  return { window, outputReserve: reserve, margin, budget, trigger: Math.floor(budget * TRIGGER) };
}
