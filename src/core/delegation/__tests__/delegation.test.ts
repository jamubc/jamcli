import { test, expect } from 'bun:test';
import path from 'path';
import { runChild } from '../spawn.js';
import { canDelegate, childTurns, delegationTranscriptLine } from '../bounds.js';
import { DEFAULT_DELEGATION_CONFIG } from '../../../types/config.js';
import { resolveRoute } from '../../routing/resolve.js';
import type { CategoryChain } from '../../../types/config.js';

const FAKE_CHILD = path.join(import.meta.dir, 'fake-child.js');

const fakeChild = (options: { prompt: string; exitCode?: number }) =>
  runChild({
    command: process.execPath,
    args: [FAKE_CHILD, String(options.exitCode ?? 0)],
    prompt: options.prompt,
  });

test('a child reports its streamed events and final summary', async () => {
  const result = await fakeChild({ prompt: 'hello child' });
  expect(result.status).toBe('ok');
  expect(result.response).toBe('child said: hello child');
  expect(result.sessionId).toBe('child-session-1');
  expect(result.events.map((event) => event.type)).toEqual(['text', 'text']);
});

test('a child that exits non-zero is reported as an error, not a success', async () => {
  const result = await fakeChild({ prompt: 'fail child', exitCode: 3 });
  expect(result.status).toBe('error');
  expect(result.response).toBe('');
  expect(result.exitCode).toBe(3);
});

test('an aborted child is cancelled', async () => {
  const controller = new AbortController();
  const pending = runChild({
    command: process.execPath,
    args: [FAKE_CHILD, '0', 'slow'],
    prompt: 'slow child',
    signal: controller.signal,
  });
  controller.abort();
  const result = await pending;
  expect(result.status).toBe('cancelled');
});

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
