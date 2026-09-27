import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DIRECTORY_TTL_MS, ModelCatalog, ModelDirectory, directoryFacts, type MetadataSource } from '../index.js';
import { effortFor } from '../../routing/capabilities.js';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-directory-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** The shape of models.dev's api.json, trimmed to what the tests read. */
const FEED = {
  'opencode-go': {
    api: 'https://opencode.ai/zen/go/v1',
    models: {
      'deepseek-v4.1-flash': {
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
        tool_call: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1_000_000, output: 384_000 },
        cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
      },
    },
  },
  anthropic: {
    models: {
      'claude-x': { reasoning: true, reasoning_options: [{ type: 'budget_tokens', min: 1024 }], limit: { context: 200_000, output: 64_000 }, cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 } },
    },
  },
};

/** A fetch that serves the feed, or fails, and counts how often it was called. */
const serving = (feed: unknown = FEED, ok = true) => {
  const fake = Object.assign(
    async () => {
      fake.calls += 1;
      if (!ok) throw new Error('offline');
      return new Response(JSON.stringify(feed), { status: 200 });
    },
    { calls: 0 }
  );
  return fake;
};

const directory = (options: Partial<ConstructorParameters<typeof ModelDirectory>[0]> = {}) =>
  new ModelDirectory({ dir, url: 'https://models.test/api.json', fetch: serving() as any, ...options });

test('a models.dev entry becomes limits, capabilities, effort levels, and all four prices', () => {
  expect(directoryFacts(FEED['opencode-go'].models['deepseek-v4.1-flash'])).toEqual({
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    tools: true,
    reasoning: true,
    images: true,
    alwaysThinks: true,
    effort: true,
    efforts: ['low', 'high', 'max'],
    price: { input: 0.15, output: 0.6, cacheRead: 0.003 },
  });
  // A budget can be zero, so the model can stop thinking; it takes no level.
  const claude = directoryFacts(FEED.anthropic.models['claude-x']);
  expect(claude).toMatchObject({ alwaysThinks: false, effort: false, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } });
  // Nothing stated, nothing kept: no price is guessed.
  expect(directoryFacts({ id: 'bare' })).toEqual({});
});

test('a model is found by its provider id, or by the endpoint URL a custom id points at', async () => {
  const found = directory();
  await found.refresh();
  expect(found.facts('opencode-go', undefined, 'deepseek-v4.1-flash')?.contextWindow).toBe(1_000_000);
  expect(found.facts('my-go', 'https://opencode.ai/zen/go/v1/', 'deepseek-v4.1-flash')?.contextWindow).toBe(1_000_000);
  expect(found.facts('my-go', 'https://elsewhere.test/v1', 'deepseek-v4.1-flash')).toBeUndefined();
});

test('the copy is kept for an hour, read again after, and a failed refresh keeps the old copy', async () => {
  let now = 1_000;
  const fetch = serving();
  const first = directory({ now: () => now, fetch: fetch as any });
  expect(first.stale()).toBe(true);
  await first.refresh();
  expect(first.stale()).toBe(false);

  // Another session reads the file without the network.
  const second = directory({ now: () => now, fetch: serving(FEED, false) as any });
  expect(second.stale()).toBe(false);
  expect(second.facts('opencode-go', undefined, 'deepseek-v4.1-flash')?.price?.input).toBe(0.15);

  now += DIRECTORY_TTL_MS;
  expect(second.stale()).toBe(true);
  await second.refresh();
  // Offline: the old copy still answers, and this session does not try again.
  expect(second.facts('opencode-go', undefined, 'deepseek-v4.1-flash')?.price?.input).toBe(0.15);
  expect(second.stale()).toBe(false);
  expect(fetch.calls).toBe(1);
});

test('off turns the directory off, and it is never fetched', async () => {
  const fetch = serving();
  const off = directory({ url: 'off', fetch: fetch as any });
  await off.refresh();
  expect(off.stale()).toBe(false);
  expect(off.facts('opencode-go', undefined, 'deepseek-v4.1-flash')).toBeUndefined();
  expect(fetch.calls).toBe(0);
});

test('the provider outranks the directory, which outranks the bundled table; Ollama never asks it', async () => {
  const fetch = serving();
  const catalog = new ModelCatalog({ cache: false, directory: directory({ fetch: fetch as any }) });
  const source: MetadataSource = { family: 'anthropic', describeModel: async () => ({ contextWindow: 150_000 }) };
  const info = await catalog.resolve('anthropic', 'claude-x', source);
  expect(info.contextWindow).toBe(150_000);
  expect(info.sources.contextWindow).toBe('provider');
  expect(info.price?.cacheWrite).toBe(1.25);
  expect(info.sources.price).toBe('directory');

  const configured = new ModelCatalog({ cache: false, directory: directory(), models: { 'opencode-go:deepseek-v4.1-flash': { context_window: 64_000 } } });
  const mixed = await configured.resolve('opencode-go', 'deepseek-v4.1-flash');
  expect(mixed.contextWindow).toBe(64_000);
  expect(mixed.efforts).toEqual(['low', 'high', 'max']);

  const local = await new ModelCatalog({ cache: false, directory: directory({ fetch: serving({ ollama: { models: { m: { cost: { input: 9, output: 9 } } } } }) as any }) }).resolve('ollama', 'm');
  expect(local.sources.price).toBe('local');
});

test('an effort level the model does not take goes as the nearest it does, the higher on a tie', () => {
  const takes = ['low', 'high', 'max'] as const;
  expect(effortFor('medium', takes)).toBe('high');
  expect(effortFor('xhigh', takes)).toBe('max');
  expect(effortFor('low', takes)).toBe('low');
  expect(effortFor('xhigh', ['low', 'medium', 'high'])).toBe('high');
  expect(effortFor('medium', undefined)).toBe('medium');
});
