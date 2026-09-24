import { expect, test } from 'bun:test';
import { BUDGETS, failed, judge, median, report } from './budgets.js';

test('a median is the middle run, or the mean of the middle two', () => {
  expect(median([30, 10, 20])).toBe(20);
  expect(median([40, 10, 30, 20])).toBe(25);
  expect(median([])).toBeNaN();
});

test('an enforced budget missed fails the job; an unenforced one is only recorded', () => {
  const results = judge({ version: [70, 65, 90, 62, 61], headless: [200, 210, 190, 205, 199], 'first-frame': [400], grep: { skipped: 'ripgrep is not installed' } });
  const verdict = Object.fromEntries(results.map((result) => [result.budget.id, [result.verdict, result.value]]));
  expect(verdict.version).toEqual(['over', 65]);
  expect(verdict.headless).toEqual(['over', 200]);
  expect(verdict['first-frame']).toEqual(['over', 400]);
  // A budget not enforced is only recorded when missed.
  const loose = { id: 'loose', measure: 'a measure', limit: 10, unit: 'ms' as const, enforced: false, note: 'why' };
  const [recorded] = judge({ loose: [20] }, [loose]);
  expect([recorded.verdict, recorded.note]).toEqual(['recorded', 'why']);
  expect(failed([recorded])).toBe(false);
  expect(verdict.grep).toEqual(['not measured', undefined]);
  expect(verdict['idle-memory']).toEqual(['not measured', undefined]);
  expect(failed(results)).toBe(true);
  expect(failed(judge({ version: [10], headless: [100], grep: [10], 'first-frame': [200], keystroke: [8], 'idle-memory': [140] }))).toBe(false);
  expect(report(results)).toContain('over               65 ms  budget   60 ms  jamcli --version');
  // The budgets are D24's.
  expect(BUDGETS.map((budget) => [budget.id, budget.limit])).toEqual([
    ['version', 60],
    ['headless', 150],
    ['grep', 500],
    ['first-frame', 250],
    ['keystroke', 16],
    ['idle-memory', 150],
  ]);
});
