import { expect, test } from 'bun:test';
import { groupKFold, temporalSplit } from '../split.js';
import type { Example, LabelKind } from '../types.js';

const make = (session: string, ts: number, label: LabelKind = 'allow'): Example => ({
  id: `${session}#${ts}`,
  session,
  projectRoot: '/p',
  project: 'p',
  ts,
  surface: 'tui',
  child: false,
  mode: 'default',
  tool: 'run_command',
  args: {},
  request: '',
  decidedBy: 'user',
  scope: 'once',
  label,
  turnCall: 0,
  history: { priorHuman: 0, priorAllows: 0, seenAllowed: false, seenDenied: false },
});

/** Six sessions hold every denial and forty hold none: the shape of real logs. */
const skewed = (): Example[] => [
  ...Array.from({ length: 6 }, (_, s) => [make(`d${s}`, s, 'deny_call'), make(`d${s}`, s + 100), make(`d${s}`, s + 200)]).flat(),
  ...Array.from({ length: 40 }, (_, s) => [make(`a${s}`, 1000 + s), make(`a${s}`, 2000 + s), make(`a${s}`, 3000 + s)]).flat(),
];

test('folds hold whole sessions, spread the denials, and stay level in size', () => {
  const data = skewed();
  const folds = groupKFold(data, 5);
  expect(folds.flat()).toHaveLength(data.length);
  const owner = new Map<string, number>();
  folds.forEach((fold, i) =>
    fold.forEach((example) => {
      expect(owner.get(example.session) ?? i).toBe(i);
      owner.set(example.session, i);
    })
  );
  const sizes = folds.map((fold) => fold.length);
  const denies = folds.map((fold) => fold.filter((example) => example.label === 'deny_call').length);
  // The bug this pins: every denial-free session used to land in one fold, leaving sizes like 147 and 5.
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(6);
  expect(Math.max(...denies) - Math.min(...denies)).toBeLessThanOrEqual(1);
  expect(groupKFold(data, 5).map((fold) => fold.map((example) => example.id))).toEqual(folds.map((fold) => fold.map((example) => example.id)));
});

test('the temporal split holds out the latest whole sessions', () => {
  const data = [make('a', 1), make('a', 2), make('b', 10), make('b', 11), make('c', 20), make('c', 21), make('d', 30), make('d', 31)];
  const { train, test } = temporalSplit(data, 0.3);
  expect(new Set(test.map((example) => example.session))).toEqual(new Set(['d', 'c']));
  expect(train.every((example) => example.ts < Math.min(...test.map((held) => held.ts)))).toBe(true);
});
