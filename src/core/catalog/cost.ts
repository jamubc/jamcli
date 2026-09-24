import type { TokenUsage } from '../types.js';
import type { TranscriptEvent } from '../transcript/events.js';
import type { ModelPrice } from './types.js';

/**
 * What one request cost in US dollars, or undefined when the model has no known price.
 * Anthropic and OpenAI both count cached reads, and Anthropic cache writes, inside the
 * prompt total, so the rest of the prompt is priced as fresh input. A cache price no
 * source gives is charged at the input price.
 */
export function requestCost(usage: TokenUsage, price: ModelPrice | undefined): number | undefined {
  if (!price) return undefined;
  const cached = usage.cached_tokens ?? 0;
  const written = usage.cache_write_tokens ?? 0;
  const fresh = Math.max(0, (usage.prompt_tokens ?? 0) - cached - written);
  const dollars =
    fresh * price.input +
    cached * (price.cacheRead ?? price.input) +
    written * (price.cacheWrite ?? price.input) +
    (usage.completion_tokens ?? 0) * price.output;
  return dollars / 1_000_000;
}

/** What one model cost a session. */
export interface ModelSpend {
  /** `provider:model`. */
  model: string;
  requests: number;
  /** Requests made while the model had no known price. Their cost is not in `cost`. */
  unpriced: number;
  /** US dollars, over the priced requests. */
  cost: number;
  usage: TokenUsage;
}

export interface SpendSummary {
  /** US dollars, over every priced request, delegated ones included. */
  cost: number;
  requests: number;
  /** Requests with no known price. While any exist, `cost` is a lower bound. */
  unpriced: number;
  /** Per model, in the order each was first used. */
  models: ModelSpend[];
  /** What the sessions this one delegated to spent. It is already counted above. */
  delegated: { cost: number; requests: number; unpriced: number };
}

export interface SpendRecord {
  /** `provider:model`. */
  model?: string;
  usage: TokenUsage;
  /** Absent when the price was unknown. */
  cost?: number;
  /** Made by a session this one delegated to. */
  delegated?: boolean;
}

const empty = (): TokenUsage => ({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0, cache_write_tokens: 0 });

const plus = (total: TokenUsage, usage: TokenUsage): TokenUsage => ({
  prompt_tokens: total.prompt_tokens + (usage.prompt_tokens ?? 0),
  completion_tokens: total.completion_tokens + (usage.completion_tokens ?? 0),
  total_tokens: total.total_tokens + (usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)),
  cached_tokens: (total.cached_tokens ?? 0) + (usage.cached_tokens ?? 0),
  cache_write_tokens: (total.cache_write_tokens ?? 0) + (usage.cache_write_tokens ?? 0),
});

/**
 * A session's spend, request by request, by model. Each request is priced when it is
 * made, so a later price change does not rewrite what a session cost.
 */
export class CostLedger {
  private readonly byModel = new Map<string, ModelSpend>();
  private readonly delegated = { cost: 0, requests: 0, unpriced: 0 };

  record(entry: SpendRecord): void {
    const key = entry.model ?? 'unknown';
    const spend = this.byModel.get(key) ?? { model: key, requests: 0, unpriced: 0, cost: 0, usage: empty() };
    spend.requests += 1;
    spend.usage = plus(spend.usage, entry.usage);
    if (entry.cost === undefined) spend.unpriced += 1;
    else spend.cost += entry.cost;
    this.byModel.set(key, spend);
    if (!entry.delegated) return;
    this.delegated.requests += 1;
    if (entry.cost === undefined) this.delegated.unpriced += 1;
    else this.delegated.cost += entry.cost;
  }

  summary(): SpendSummary {
    const models = [...this.byModel.values()].map((spend) => ({ ...spend, usage: { ...spend.usage } }));
    return {
      cost: models.reduce((sum, spend) => sum + spend.cost, 0),
      requests: models.reduce((sum, spend) => sum + spend.requests, 0),
      unpriced: models.reduce((sum, spend) => sum + spend.unpriced, 0),
      models,
      delegated: { ...this.delegated },
    };
  }

  /** The ledger a session log records, with each request priced as it was when made. */
  static fromEvents(events: TranscriptEvent[]): CostLedger {
    const ledger = new CostLedger();
    for (const event of events) {
      if (event.type !== 'usage') continue;
      ledger.record({ model: event.model, usage: event.usage, cost: event.cost, delegated: Boolean(event.delegated) });
    }
    return ledger;
  }
}

/** Dollars for people: cents from a dollar up, four places below it so small sessions do not read as free. */
export function formatUsd(amount: number): string {
  if (amount === 0) return '$0.00';
  return amount >= 1 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(4)}`;
}

/** A one-line account of a session's spend, saying when part of it has no price. */
export function describeSpend(summary: SpendSummary): string {
  const unpriced = summary.unpriced ? `, and ${summary.unpriced} unpriced request${summary.unpriced === 1 ? '' : 's'}` : '';
  const delegated = summary.delegated.requests ? `, ${formatUsd(summary.delegated.cost)} of it by delegated tasks` : '';
  return `${formatUsd(summary.cost)} over ${summary.requests} request${summary.requests === 1 ? '' : 's'}${delegated}${unpriced}`;
}
