import { test, expect } from 'bun:test';
import { canDelegate, childTurns, delegationTranscriptLine } from '../bounds.js';
import { DEFAULT_DELEGATION_CONFIG } from '../../../types/config.js';
import { resolveRoute } from '../../routing/resolve.js';
import type { CategoryChain } from '../../../types/config.js';

test('a child model comes from its category chain and never from the session', async () => {
  const categories: Record<string, CategoryChain> = {
    quick: [{ model: 'ollama:tiny' }],
  };
  const resolution = await resolveRoute({
    registry: { ollama: { endpoint: 'http://localhost:11434' } },
    categories,
    category: 'quick',
  });
  expect(resolution?.model).toBe('ollama:tiny');
  expect(resolution?.model).not.toBe('openai/gpt-oss-20b:free');
});

test('depth beyond the bound is refused rather than spawned', () => {
  const refusal = canDelegate({ depth: DEFAULT_DELEGATION_CONFIG.max_depth, running: 0, config: DEFAULT_DELEGATION_CONFIG });
  expect(refusal.allowed).toBe(false);
  expect(refusal.reason).toContain('depth');
  expect(canDelegate({ depth: 0, running: 0, config: DEFAULT_DELEGATION_CONFIG }).allowed).toBe(true);
});

test('a concurrent child beyond the bound is refused', () => {
  const refusal = canDelegate({
    depth: 1,
    running: DEFAULT_DELEGATION_CONFIG.max_concurrent,
    config: DEFAULT_DELEGATION_CONFIG,
  });
  expect(refusal.allowed).toBe(false);
  expect(refusal.reason).toContain('maximum');
});

test('a child turn count is clamped to the configured bound', () => {
  expect(childTurns(undefined, 50)).toBe(DEFAULT_DELEGATION_CONFIG.max_turns_per_child);
  expect(childTurns(undefined, 2)).toBe(2);
});

test('the transcript line records the category, model, and child session', () => {
  const line = delegationTranscriptLine({
    category: 'deep',
    resolvedModel: 'ollama:llama3',
    childSessionId: 'abc-123',
    status: 'ok',
  });
  expect(line).toContain('deep');
  expect(line).toContain('ollama:llama3');
  expect(line).toContain('abc-123');
});
