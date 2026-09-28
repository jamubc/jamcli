import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { lift, lint, worthHolding, type RunScore } from '../loop.ts';

const runs = (successes: boolean[], tokens = 1_000, cached = 0.5): RunScore[] => successes.map((success, index) => ({ task: `t${index % 3}`, repeat: Math.floor(index / 3) + 1, success, tokens, cachedShare: cached }));

test('a lift is paired by task and repeat, with a bootstrap interval, and is the same number on every read', () => {
  const baseline = runs([true, false, false, true, false, false, true, false, false]);
  const candidate = runs([true, true, true, true, true, false, true, true, true], 900, 0.6);
  const first = lift(baseline, candidate);
  expect(first.success.baseline).toBeCloseTo(1 / 3, 5);
  expect(first.success.candidate).toBeCloseTo(8 / 9, 5);
  expect(first.success.relLift).toBeCloseTo((8 / 9 - 1 / 3) / (1 / 3), 5);
  expect(first.success.ciLower).toBeGreaterThan(0);
  expect(first.tokensPerCompleted.relLift).toBeCloseTo(-0.1, 5);
  expect(first.cachedShare.delta).toBeCloseTo(0.1, 5);
  expect(lift(baseline, candidate)).toEqual(first);
  // A candidate with no run for a pair is not compared on it.
  expect(lift(baseline, candidate.slice(0, 3)).success.candidate).toBe(1);
});

test('a candidate is worth a held-out run only for a lift the interval supports, never at the cache\'s or the token budget\'s expense', () => {
  const base = runs([true, false, true, false, true, false]);
  expect(worthHolding(lift(base, runs([true, true, true, true, true, true]))).ok).toBe(true);
  const flat = worthHolding(lift(base, runs([true, false, true, false, true, false], 800)));
  expect(flat).toEqual({ ok: true, reason: 'success unchanged within the interval and tokens down 15% or more' });
  expect(worthHolding(lift(base, runs([true, false, true, false, true, false], 950))).ok).toBe(false);
  expect(worthHolding(lift(base, runs([true, true, true, true, true, true], 1_200))).reason).toBe('tokens per completed task rose more than 10%');
  expect(worthHolding(lift(base, runs([true, true, true, true, true, true], 1_000, 0.4))).reason).toBe('cached share fell more than 5 points');
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-search-lint-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a candidate that names a dev task, or is too long, is refused before it runs', () => {
  const spec = path.join(dir, 'task.json');
  fs.writeFileSync(spec, JSON.stringify({ project: '/home/me/secret-project', turns: ['rename fetchUser to loadUser'], checks: [{ fileContains: { path: 'src/x.ts', text: 'loadUser(' } }] }));
  expect(lint({ name: 'ok', surface: 'prompt_reads', harness: { guidance: 'Read files with read_file.' } }, [spec])).toBeUndefined();
  expect(lint({ name: 'leak', surface: 'prompt_reads', harness: { guidance: 'When asked to rename fetchUser to loadUser, edit src/x.ts.' } }, [spec])).toMatch(/names a dev task/);
  expect(lint({ name: 'path', surface: 'prompt_reads', harness: { guidance: 'Work in /home/me/secret-project.' } }, [spec])).toMatch(/names a dev task/);
  expect(lint({ name: 'long', surface: 'prompt_reads', harness: { guidance: 'x'.repeat(6_001) } }, [spec])).toMatch(/over 6,000/);
});
