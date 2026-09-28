import { isAllow, type Example } from './types.js';

interface Group {
  session: string;
  first: number;
  size: number;
  denies: number;
}

const groups = (examples: Example[]): Group[] => {
  const by = new Map<string, Group>();
  for (const example of examples) {
    const group = by.get(example.session) ?? { session: example.session, first: example.ts, size: 0, denies: 0 };
    group.first = Math.min(group.first, example.ts);
    group.size += 1;
    if (!isAllow(example)) group.denies += 1;
    by.set(example.session, group);
  }
  return [...by.values()];
};

/**
 * Whole sessions to folds, so no session is on both sides. Sessions with denials go first,
 * each to the fold with the fewest denials so far, so the rare class is spread. Sessions
 * with none then go to the smallest fold, so sizes stay level: folds of very different
 * sizes train models with different priors, and pooling their scores inverts a ranking.
 * The result is the same on every run.
 */
export function groupKFold(examples: Example[], k: number): Example[][] {
  const folds = Array.from({ length: k }, () => ({ denies: 0, size: 0, members: new Set<string>() }));
  const place = (group: Group, better: (candidate: (typeof folds)[number], best: (typeof folds)[number]) => boolean) => {
    const fold = folds.reduce((best, candidate) => (better(candidate, best) ? candidate : best));
    fold.denies += group.denies;
    fold.size += group.size;
    fold.members.add(group.session);
  };
  const order = groups(examples).sort((a, b) => b.denies - a.denies || b.size - a.size || a.session.localeCompare(b.session));
  for (const group of order.filter((entry) => entry.denies > 0)) place(group, (c, b) => c.denies < b.denies || (c.denies === b.denies && c.size < b.size));
  for (const group of order.filter((entry) => entry.denies === 0)) place(group, (c, b) => c.size < b.size);
  return folds.map((fold) => examples.filter((example) => fold.members.has(example.session)));
}

/** The latest sessions, whole, holding at least `testShare` of the examples: train on the past, test on what came after. */
export function temporalSplit(examples: Example[], testShare = 0.3): { train: Example[]; test: Example[] } {
  const latest = groups(examples).sort((a, b) => b.first - a.first);
  const test = new Set<string>();
  let taken = 0;
  for (const group of latest) {
    if (taken >= examples.length * testShare) break;
    test.add(group.session);
    taken += group.size;
  }
  return { train: examples.filter((example) => !test.has(example.session)), test: examples.filter((example) => test.has(example.session)) };
}
