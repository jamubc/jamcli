import { expect, test } from 'bun:test';
import { CostLedger, describeSpend, formatUsd, requestCost } from '../cost.js';
import type { TranscriptEvent } from '../../transcript/events.js';

const usage = (prompt: number, completion: number, extra: { cached_tokens?: number; cache_write_tokens?: number } = {}) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
  ...extra,
});

test('a request is priced by its fresh input, cache reads, cache writes, and output', () => {
  const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  // Anthropic: 1,000 fresh, 200 read from the cache, 300 written to it; the prompt total holds all three.
  expect(requestCost(usage(1_500, 100, { cached_tokens: 200, cache_write_tokens: 300 }), price)).toBeCloseTo(
    (1_000 * 3 + 200 * 0.3 + 300 * 3.75 + 100 * 15) / 1e6,
    12
  );
  // OpenAI: 400 of the 1,000 prompt tokens were cached.
  expect(requestCost(usage(1_000, 50, { cached_tokens: 400 }), { input: 2, output: 8, cacheRead: 0.5 })).toBeCloseTo(
    (600 * 2 + 400 * 0.5 + 50 * 8) / 1e6,
    12
  );
  // A cache price nobody gives is charged as input.
  expect(requestCost(usage(1_000, 50, { cached_tokens: 400 }), { input: 2, output: 8 })).toBeCloseTo((1_000 * 2 + 50 * 8) / 1e6, 12);
  expect(requestCost(usage(1_000, 50), undefined)).toBeUndefined();
  expect(requestCost(usage(1_000, 50), { input: 0, output: 0 })).toBe(0);
});

test('the ledger keeps each model apart, counts unpriced requests, and keeps delegated spend visible', () => {
  const ledger = new CostLedger();
  ledger.record({ model: 'anthropic:claude-x', usage: usage(1_000, 100), cost: 0.01 });
  ledger.record({ model: 'ollama:coder', usage: usage(500, 50), cost: 0 });
  ledger.record({ model: 'anthropic:claude-x', usage: usage(2_000, 200, { cached_tokens: 1_500 }), cost: 0.02 });
  ledger.record({ model: 'openai:mystery', usage: usage(300, 30) });
  ledger.record({ model: 'anthropic:claude-x', usage: usage(100, 10), cost: 0.005, delegated: true });
  ledger.record({ model: 'openai:mystery', usage: usage(100, 10), delegated: true });

  const summary = ledger.summary();
  expect(summary.cost).toBeCloseTo(0.035, 12);
  expect(summary.requests).toBe(6);
  expect(summary.unpriced).toBe(2);
  expect(summary.models.map((spend) => spend.model)).toEqual(['anthropic:claude-x', 'ollama:coder', 'openai:mystery']);
  expect(summary.models[0]).toMatchObject({ requests: 3, unpriced: 0, usage: { prompt_tokens: 3_100, completion_tokens: 310, cached_tokens: 1_500 } });
  expect(summary.models[0].cost).toBeCloseTo(0.035, 12);
  expect(summary.models[2]).toMatchObject({ requests: 2, unpriced: 2, cost: 0 });
  expect(summary.delegated.requests).toBe(2);
  expect(summary.delegated.unpriced).toBe(1);
  expect(summary.delegated.cost).toBeCloseTo(0.005, 12);

  // A summary is a copy.
  summary.models[0].usage.prompt_tokens = 0;
  expect(ledger.summary().models[0].usage.prompt_tokens).toBe(3_100);
});

test('a session log gives back the ledger it recorded, as priced then', () => {
  const event = (fields: Partial<Extract<TranscriptEvent, { type: 'usage' }>>): TranscriptEvent => ({
    v: 2,
    type: 'usage',
    ts: 1,
    usage: usage(100, 10),
    ...fields,
  });
  const events: TranscriptEvent[] = [
    { v: 2, type: 'notice', ts: 1, level: 'info', message: 'not usage' },
    event({ model: 'anthropic:claude-x', cost: 0.25 }),
    event({ model: 'openai:mystery' }),
    event({ model: 'anthropic:claude-x', cost: 0.5, delegated: 'child-1' }),
    // A log from before models were recorded.
    event({}),
  ];
  const summary = CostLedger.fromEvents(events).summary();
  expect(summary.cost).toBe(0.75);
  expect(summary.unpriced).toBe(2);
  expect(summary.models.map((spend) => spend.model)).toEqual(['anthropic:claude-x', 'openai:mystery', 'unknown']);
  expect(summary.delegated).toEqual({ cost: 0.5, requests: 1, unpriced: 0 });
});

test('costs read as dollars, and a partly unpriced session says so', () => {
  expect(formatUsd(0)).toBe('$0.00');
  expect(formatUsd(0.000123)).toBe('$0.0001');
  expect(formatUsd(0.5)).toBe('$0.5000');
  expect(formatUsd(12.5)).toBe('$12.50');

  const ledger = new CostLedger();
  ledger.record({ model: 'a:b', usage: usage(1, 1), cost: 0.0123 });
  expect(describeSpend(ledger.summary())).toBe('$0.0123 over 1 request');
  ledger.record({ model: 'a:c', usage: usage(1, 1), cost: 1, delegated: true });
  ledger.record({ model: 'a:d', usage: usage(1, 1) });
  expect(describeSpend(ledger.summary())).toBe('$1.01 over 3 requests, $1.00 of it by delegated tasks, and 1 unpriced request');
});
