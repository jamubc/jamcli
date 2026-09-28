import { expect, test } from 'bun:test';
import { adjudicate } from '../decide.js';
import { evaluate, formatEval, trainCertified } from '../evaluate.js';
import type { Example } from '../types.js';
import { make } from './model.test.js';

const safe = ['ls', 'git status', 'bun test', 'cat notes.txt', 'npm run build', 'grep -rn foo src'];
const risky = ['python3 tools/deploy_prod.py', 'node scripts/purge_cache.js', 'make deploy'];

/** A seeded generator, so a "random" fixture is the same on every run. */
const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);

const build = (sessions: number, perSession: number, labelDeny: (i: number, random: () => number) => boolean, options: { leaky?: boolean; seed?: number } = {}): Example[] => {
  const random = rng(options.seed ?? 7);
  const out: Example[] = [];
  let i = 0;
  for (let s = 0; s < sessions; s += 1) {
    for (let c = 0; c < perSession; c += 1) {
      const deny = labelDeny(i, random);
      // Unless leaky, the command says nothing about the answer.
      const command = deny && options.leaky !== false ? risky[i % risky.length] : safe[i % safe.length];
      out.push(make(i, `s${s}`, command, deny ? 'deny_call' : 'allow'));
      i += 1;
    }
  }
  return out;
};

test('with a real signal and enough decisions, the gate passes and certifies a threshold that saves most prompts', () => {
  const data = build(70, 10, (i) => i % 10 === 3);
  const report = evaluate(data);
  expect(report.n).toBe(700);
  expect(report.denies).toBe(70);
  expect(report.model.macroAuc).toBeGreaterThan(0.95);
  expect(report.model.gate.passed).toBe(true);
  expect(report.model.gate.best!.coverage).toBeGreaterThan(0.8);
  expect(report.model.gate.best!.farUpper).toBeLessThanOrEqual(0.02);
  expect(report.model.logLoss).toBeLessThan(report.model.priorLogLoss);
  expect(report.temporal?.policy?.falseAllows).toBe(0);
  const { model } = trainCertified(data);
  expect(model.authority).toBe('assist');
  expect(model.threshold).toBeGreaterThan(0);
  expect(formatEval(report)).toContain('PASSED');
});

test('the same signal in too few decisions cannot pass: the data does not bound the false-allow rate', () => {
  const data = build(8, 10, (i) => i % 10 === 3);
  const report = evaluate(data);
  expect(report.model.gate.passed).toBe(false);
  expect(report.model.gate.reason).toContain('needs about 149');
  expect(trainCertified(data).model.authority).toBe('none');
});

test('labels that carry no signal earn no authority, however much data there is', () => {
  const data = build(70, 10, (_, random) => random() < 0.1, { leaky: false });
  const report = evaluate(data);
  expect(report.model.macroAuc).toBeLessThan(0.7);
  const { model } = trainCertified(data);
  expect(model.authority).toBe('none');
  expect(model.threshold).toBeUndefined();
});

test('the report says which baselines the model has to beat, and what it left out', () => {
  const data = [...build(30, 10, (i) => i % 10 === 3), make(9000, 'floor', 'rm -rf dist', 'deny_call', { floor: 'rm destroys or stops something' }), make(9001, 'sys', 'ls', 'system')];
  const report = evaluate(data);
  expect(report.excluded).toMatchObject({ floor: 1, system: 1 });
  expect(report.baselines.map((row) => row.name)).toEqual(['allow everything', 'read-only commands (M2)', 'same call allowed before']);
  expect(report.baselines[0]).toMatchObject({ k: 300, falseAllows: 30 });
  expect(evaluate(build(1, 5, () => false)).baselines).toEqual([]);
});

test('a model may only save a prompt it was certified for, and never one beyond the floor', () => {
  const data = build(70, 10, (i) => i % 10 === 3);
  const { model } = trainCertified(data);
  const query = (command: string) => ({ tool: 'run_command', args: { command }, projectRoot: '/work/app', mode: 'default', surface: 'tui', child: false, history: { priorHuman: 50, priorAllows: 45, seenAllowed: false, seenDenied: false } });
  expect(adjudicate(model, query('git status')).verdict).toBe('allow');
  expect(adjudicate(model, query('make deploy')).verdict).toBe('abstain');
  expect(adjudicate(model, query('rm -rf dist'))).toMatchObject({ verdict: 'abstain', reason: expect.stringContaining('beyond any model') });
  expect(adjudicate(model, query('git push origin main')).verdict).toBe('abstain');
  // The base rate is high, so a program the model has never seen would score as allowed. It must abstain instead.
  const novel = adjudicate(model, query('wipe-everything --now'));
  expect(novel.p).toBeGreaterThan(model.threshold!);
  expect(novel).toMatchObject({ verdict: 'abstain', reason: expect.stringContaining('unfamiliar') });
  const shadow = { ...model, authority: 'none' as const, threshold: undefined };
  expect(adjudicate(shadow, query('git status'))).toMatchObject({ verdict: 'abstain', reason: expect.stringContaining('shadow only') });
});
