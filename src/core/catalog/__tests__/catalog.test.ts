import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  BUNDLED_VERIFIED,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_OUTPUT_REQUEST,
  METADATA_TTL_MS,
  MetadataCache,
  ModelCatalog,
  bundledFacts,
  bundledModels,
  bundledProblems,
  requestedOutputTokens,
  type MetadataSource,
  type ModelFacts,
} from '../index.js';
import { DEFAULT_OLLAMA_CONTEXT_CAP } from '../../providers/ollama.js';
import table from '../catalog.json' with { type: 'json' };

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-catalog-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A provider that reports these facts, and counts how often it was asked. */
const reporting = (facts: ModelFacts | undefined, family: MetadataSource['family'] = 'openai') => {
  const source = {
    family,
    asked: 0,
    async describeModel() {
      source.asked += 1;
      return facts;
    },
  };
  return source;
};

const failing = (family: MetadataSource['family'] = 'openai') => {
  const source = {
    family,
    asked: 0,
    async describeModel(): Promise<ModelFacts | undefined> {
      source.asked += 1;
      throw new Error('unreachable');
    },
  };
  return source;
};

const catalog = (options: ConstructorParameters<typeof ModelCatalog>[0] = {}) =>
  new ModelCatalog({ cache: new MetadataCache({ dir }), ...options });

test('each fact comes from the first source that knows it, and says which', async () => {
  const models = { 'anthropic:claude-sonnet-5': { max_output: 4000, price: { input: 1, output: 2 } } };
  const info = await catalog({ models }).resolve(
    'anthropic',
    'claude-sonnet-5',
    reporting({ contextWindow: 900_000, maxOutput: 100_000, images: false }, 'anthropic')
  );
  expect(info).toMatchObject({
    contextWindow: 900_000,
    maxOutput: 4000,
    images: false,
    tools: true,
    thinking: 'adaptive',
    price: { input: 1, output: 2 },
  });
  expect(info.sources).toMatchObject({ contextWindow: 'provider', maxOutput: 'config', images: 'provider', tools: 'bundled', price: 'config' });
});

test('with no provider metadata, the bundled row applies whole, prices included', async () => {
  const info = await catalog().resolve('anthropic', 'claude-opus-5-5', failing('anthropic'));
  expect(info).toMatchObject({
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    thinking: 'adaptive',
    alwaysThinks: true,
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  });
  expect(new Set(Object.values(info.sources))).toEqual(new Set(['bundled']));
  // A convenience alias reaches the dated row it points to.
  expect(catalog().lookup('anthropic', 'claude-haiku-4-5')).toMatchObject({ contextWindow: 200_000, maxOutput: 64_000, thinking: 'budget' });
});

test('an Anthropic-speaking gateway gets the model limits but not Anthropic prices', () => {
  const gateway = catalog().lookup('corp-gateway', 'claude-sonnet-5', 'anthropic');
  expect(gateway).toMatchObject({ contextWindow: 1_000_000, maxOutput: 128_000 });
  expect(gateway.price).toBeUndefined();
  // The same model id on an OpenAI-speaking endpoint is not assumed to be the same model.
  expect(catalog().lookup('corp-openai', 'claude-sonnet-5', 'openai').sources.contextWindow).toBe('default');
});

test('a model no source knows gets a conservative window and stays unpriced', async () => {
  const info = await catalog().resolve('openai', 'mystery-model', reporting({}));
  expect(info.contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  expect(info.sources.contextWindow).toBe('default');
  expect(info.maxOutput).toBeUndefined();
  expect(info.price).toBeUndefined();
});

test('Ollama models cost nothing, and their window is the one JamCLI asks for', async () => {
  const reported = { contextWindow: 131_072, tools: true };
  const capped = await catalog().resolve('ollama', 'coder', reporting(reported, 'ollama'));
  expect(capped.contextWindow).toBe(DEFAULT_OLLAMA_CONTEXT_CAP);
  expect(capped.price).toEqual({ input: 0, output: 0 });
  expect(capped.sources.price).toBe('local');
  // A small model keeps its own window.
  expect((await catalog({ cache: false }).resolve('ollama', 'tiny', reporting({ contextWindow: 4096 }, 'ollama'))).contextWindow).toBe(4096);

  const registry = { ollama: { num_ctx: 24_576 } };
  const sized = await catalog({ registry, cache: false }).resolve('ollama', 'coder', reporting(reported, 'ollama'));
  expect(sized.contextWindow).toBe(24_576);
  expect(sized.sources.contextWindow).toBe('config');
  // A setting for the one model beats the provider-wide one.
  const models = { 'ollama:coder': { context_window: 65_536 } };
  expect((await catalog({ registry, models, cache: false }).resolve('ollama', 'coder', reporting(reported, 'ollama'))).contextWindow).toBe(65_536);
  // Behind Ollama's OpenAI-compatible route the window cannot be requested, so it is not capped.
  expect((await catalog({ cache: false }).resolve('ollama', 'coder', reporting(reported, 'openai'))).contextWindow).toBe(131_072);
  // A configured price for a local model is used as given.
  const priced = { 'ollama:coder': { price: { input: 0.5, output: 0.5 } } };
  expect((await catalog({ models: priced, cache: false }).resolve('ollama', 'coder', reporting(reported, 'ollama'))).sources.price).toBe('config');
});

test('provider metadata is kept for a day, per endpoint, and failures are not kept', async () => {
  let now = 1_000_000;
  const cache = () => new MetadataCache({ dir, now: () => now });
  const source = reporting({ contextWindow: 50_000 });

  expect((await new ModelCatalog({ cache: cache() }).resolve('openrouter', 'm', source)).contextWindow).toBe(50_000);
  // Another session, a new catalog, the same cache directory: no second request.
  expect((await new ModelCatalog({ cache: cache() }).resolve('openrouter', 'm', source)).contextWindow).toBe(50_000);
  expect(source.asked).toBe(1);
  // The cached answer is also what a lookup without the provider sees.
  expect(new ModelCatalog({ cache: cache() }).lookup('openrouter', 'm').sources.contextWindow).toBe('provider');

  now += METADATA_TTL_MS;
  await new ModelCatalog({ cache: cache() }).resolve('openrouter', 'm', source);
  expect(source.asked).toBe(2);

  // A different endpoint for the same provider id is asked separately.
  const elsewhere = { openrouter: { base_url: 'http://proxy.example/v1' } };
  await new ModelCatalog({ cache: cache(), registry: elsewhere }).resolve('openrouter', 'm', source);
  expect(source.asked).toBe(3);

  const down = failing();
  await new ModelCatalog({ cache: cache() }).resolve('openrouter', 'other', down);
  await new ModelCatalog({ cache: cache() }).resolve('openrouter', 'other', down);
  expect(down.asked).toBe(2);
});

test('an unreadable cache is ignored and rewritten', async () => {
  fs.mkdirSync(dir, { recursive: true });
  const file = new MetadataCache({ dir }).file;
  fs.writeFileSync(file, '{ not json');
  const source = reporting({ contextWindow: 70_000 });
  expect((await catalog().resolve('openrouter', 'm', source)).contextWindow).toBe(70_000);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(1);
});

test('a provider that does not answer in time is left out', async () => {
  const slow: MetadataSource = {
    family: 'anthropic',
    describeModel: (_model, signal) =>
      new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))),
  };
  const started = Date.now();
  const info = await catalog({ timeoutMs: 50 }).resolve('anthropic', 'claude-sonnet-5', slow);
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(info.sources.contextWindow).toBe('bundled');
});

test('mistakes in the models block are reported, and the rest of the entry still applies', () => {
  const models = {
    'openai:gpt-x': { context_window: 400_000, max_output: 'lots', context_length: 5, price: { input: 1 } },
    'no-provider': { context_window: 1000 },
    'openai:gpt-y': { tools: 'yes', thinking: 'deep', price: { input: 1, output: 2, cache_hit: 1 } },
    'openai:gpt-z': 'big',
  };
  const configured = catalog({ models, modelsSource: '.jamcli/config.json models' });
  expect(configured.lookup('openai', 'gpt-x')).toMatchObject({ contextWindow: 400_000 });
  expect(configured.lookup('openai', 'gpt-x').maxOutput).toBeUndefined();
  expect(configured.lookup('openai', 'gpt-y').price).toEqual({ input: 1, output: 2 });
  expect(configured.problems).toEqual([
    '.jamcli/config.json models["openai:gpt-x"].max_output must be a whole number of tokens above zero; it is ignored.',
    '.jamcli/config.json models["openai:gpt-x"].context_length is not a model setting, so it has no effect. The settings are context_window, max_output, tools, reasoning, images, thinking, always_thinks, effort, price.',
    '.jamcli/config.json models["openai:gpt-x"].price needs both input and output; the price is ignored.',
    '.jamcli/config.json models["no-provider"] must be named provider:model, such as "openai:gpt-5"; it is ignored.',
    '.jamcli/config.json models["openai:gpt-y"].tools must be true or false; it is ignored.',
    '.jamcli/config.json models["openai:gpt-y"].thinking must be "adaptive" or "budget"; it is ignored.',
    '.jamcli/config.json models["openai:gpt-y"].price.cache_hit is not a price, so it has no effect. The prices are input, output, cache_read, cache_write.',
    '.jamcli/config.json models["openai:gpt-z"] must be an object; it is ignored.',
  ]);
  expect(catalog({ models: ['a'] }).problems).toEqual(['models must be an object keyed by provider:model; it is ignored.']);
});

test('the bundled table is well formed and follows the published price multipliers', () => {
  expect(bundledProblems()).toEqual([]);
  expect(BUNDLED_VERIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  for (const [alias, target] of Object.entries(table.aliases)) {
    expect(bundledModels()).toContain(target);
    expect(alias.split(':')[0]).toBe(target.split(':')[0]);
  }
  // Cache reads cost a tenth of input, except where the pricing page names another multiplier.
  const readMultiplier: Record<string, number> = { 'anthropic:claude-fable-5-1': 0.025, 'anthropic:claude-opus-5-5': 0.05 };
  for (const key of bundledModels()) {
    const [provider, ...rest] = key.split(':');
    const facts = bundledFacts(provider, rest.join(':'))!;
    expect(facts.contextWindow! > facts.maxOutput!).toBe(true);
    expect(facts.price!.cacheWrite).toBeCloseTo(facts.price!.input * 1.25, 10);
    expect(facts.price!.cacheRead).toBeCloseTo(facts.price!.input * (readMultiplier[key] ?? 0.1), 10);
  }
});

test('output requests are capped, and left to the server when nothing is known', () => {
  const info = (maxOutput?: number) => ({ provider: 'p', model: 'm', contextWindow: 200_000, maxOutput, sources: {} });
  expect(requestedOutputTokens(info(128_000))).toBe(DEFAULT_OUTPUT_REQUEST);
  expect(requestedOutputTokens(info(8_000))).toBe(8_000);
  expect(requestedOutputTokens(info(128_000), 64_000)).toBe(64_000);
  expect(requestedOutputTokens(info(16_000), 64_000)).toBe(16_000);
  expect(requestedOutputTokens(info())).toBeUndefined();
  expect(requestedOutputTokens(info(), 12_000)).toBe(12_000);
  expect(requestedOutputTokens(info(128_000), -5)).toBe(DEFAULT_OUTPUT_REQUEST);
});
