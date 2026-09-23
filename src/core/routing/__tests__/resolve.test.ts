import { test, expect } from 'bun:test';
import { resolveRoute } from '../resolve.js';
import { downgradeReasoning, providerConfigured } from '../capabilities.js';
import { getChain } from '../categories.js';
import type { CategoryChain } from '../../../types/config.js';

const chains: Record<string, CategoryChain> = {
  quick: [{ model: 'openrouter:fast-model' }, { model: 'ollama:llama3' }],
  deep: [{ model: 'anthropic:claude-sonnet' }],
  mix: [{ model: 'ollama:qwen3:4b', reasoning: 'on' }],
};

test('a configured first entry is used without walking the chain', async () => {
  const resolution = await resolveRoute({
    registry: { openrouter: { api_key: 'k' }, ollama: { endpoint: 'http://localhost:11434' } },
    categories: chains,
    category: 'quick',
  });
  expect(resolution?.model).toBe('openrouter:fast-model');
  expect(resolution?.skipped).toEqual([]);
});

test('an unconfigured provider is skipped for the next entry', async () => {
  const resolution = await resolveRoute({
    registry: { ollama: { endpoint: 'http://localhost:11434' } },
    categories: chains,
    category: 'quick',
  });
  expect(resolution?.model).toBe('ollama:llama3');
  expect(resolution?.skipped).toEqual([
    { model: 'openrouter:fast-model', reason: 'provider openrouter is not configured' },
  ]);
});

test('an unreachable model advances the chain and records why', async () => {
  const resolution = await resolveRoute({
    registry: { openrouter: { api_key: 'k' }, ollama: { endpoint: 'http://localhost:11434' } },
    categories: chains,
    category: 'quick',
    isReachable: async (model) => model !== 'openrouter:fast-model',
  });
  expect(resolution?.model).toBe('ollama:llama3');
  expect(resolution?.skipped).toEqual([{ model: 'openrouter:fast-model', reason: 'model could not be reached' }]);
});

test('an unknown category resolves to nothing', async () => {
  const resolution = await resolveRoute({
    registry: { ollama: { endpoint: 'http://localhost:11434' } },
    categories: chains,
    category: 'nope',
  });
  expect(resolution).toBeNull();
});

test('a chain with no servable entry reports that instead of failing', async () => {
  const resolution = await resolveRoute({
    registry: { ollama: { endpoint: 'http://localhost:11434' } },
    categories: chains,
    category: 'deep',
  });
  expect(resolution?.model).toBeNull();
  expect(resolution?.notes).toEqual(['no entry in "deep" is currently servable']);
});

test('a reasoning level the model cannot accept is dropped and recorded', async () => {
  const resolution = await resolveRoute({
    registry: { ollama: { endpoint: 'http://localhost:11434' } },
    categories: chains,
    category: 'mix',
  });
  expect(resolution?.model).toBe('ollama:qwen3:4b');
  expect(resolution?.reasoning).toBeUndefined();
  expect(resolution?.notes[0]).toContain('was dropped');
});

test('a reasoning model keeps its requested level', () => {
  const kept = downgradeReasoning('on', 'openrouter:deepseek-r1');
  expect(kept.level).toBe('on');
  expect(kept.changed).toBe(false);
});

test('provider configuration is read from the environment when a key variable is named', () => {
  process.env.JAMCLI_TEST_KEY = 'secret';
  expect(providerConfigured({ openrouter: { key_env_var: 'JAMCLI_TEST_KEY' } }, 'openrouter')).toBe(true);
  expect(providerConfigured({ openrouter: { key_env_var: 'JAMCLI_MISSING_KEY' } }, 'openrouter')).toBe(false);
  delete process.env.JAMCLI_TEST_KEY;
});

test('a category chain is read in order and an empty chain is not a chain', () => {
  expect(getChain(chains, 'quick')?.[0].model).toBe('openrouter:fast-model');
  expect(getChain({ empty: [] }, 'empty')).toBeNull();
});
