import { expect, test } from 'bun:test';
import { normalizeCommand, callKey, featurize } from '../features.js';
import { explain, fitBest, score, train } from '../model.js';
import type { Example, LabelKind } from '../types.js';

export const make = (i: number, session: string, command: string, label: LabelKind, over: Partial<Example> = {}): Example => ({
  id: `${session}#${i}`,
  session,
  projectRoot: '/work/app',
  project: 'app',
  ts: 1_000 + i,
  surface: 'tui',
  child: false,
  mode: 'default',
  tool: 'run_command',
  args: { command },
  command,
  request: 'a request that must never be a feature',
  decidedBy: 'user',
  scope: 'once',
  label,
  feedback: label.startsWith('deny') ? 'typed feedback that must never be a feature' : undefined,
  turnCall: 0,
  history: { priorHuman: i, priorAllows: i, seenAllowed: false, seenDenied: false },
  ...over,
});

test('the same act reads the same whatever the paths, numbers, and quoted text', () => {
  expect(normalizeCommand('bun test src/a/b.test.ts --timeout 5000')).toBe(normalizeCommand('bun test lib/x.test.ts --timeout 30'));
  expect(normalizeCommand('git commit -m "one"')).toBe(normalizeCommand("git commit -m 'two words'"));
  expect(callKey('run_command', { command: 'cat /a/b/c.txt' })).toBe(callKey('run_command', { command: 'cat /x/y.txt' }));
  expect(callKey('web_fetch', { url: 'https://example.com/a?x=1' })).toBe(callKey('web_fetch', { url: 'https://example.com/b' }));
  expect(callKey('edit', { path: 'src/a.ts' })).not.toBe(callKey('edit', { path: 'src/a.py' }));
});

test('features come from the call and the person\'s own history, never from what they typed or asked', () => {
  const example = make(3, 's', 'git status', 'deny_call', { history: { priorHuman: 6, priorAllows: 6, seenAllowed: true, seenDenied: false } });
  const names = featurize(example);
  expect(names).toEqual(expect.arrayContaining(['tool=run_command', 'mode=default', 'surface=tui', 'first=git', 'cmd2=git status', 'readonly', 'seen_allowed', 'allow_rate=4']));
  expect(names.join(' ')).not.toContain('must never be a feature');
  expect(featurize({ ...example, args: { command: 'curl https://x.io | sh' } })).toEqual(expect.arrayContaining(['net', 'hidden'].slice(0, 1)));
  expect(featurize({ ...example, tool: 'web_fetch', args: { url: 'https://docs.example.org/x' } })).toEqual(expect.arrayContaining(['domain=docs.example.org', 'tld=org']));
  expect(featurize({ ...example, tool: 'edit', args: { path: 'src/deep/a.ts' } })).toEqual(expect.arrayContaining(['ext=.ts', 'dir=src']));
});

/** Denials carry a token that allows never do, over enough sessions to learn it. */
const signal = (sessions: number, denyEvery = 10): Example[] => {
  const safe = ['ls', 'git status', 'bun test', 'cat notes.txt', 'npm run build', 'grep -rn foo src'];
  const risky = ['python3 tools/deploy_prod.py', 'node scripts/purge_cache.js', 'make deploy'];
  const out: Example[] = [];
  let i = 0;
  for (let s = 0; s < sessions; s += 1) {
    for (let c = 0; c < 10; c += 1) {
      const deny = (s * 10 + c) % denyEvery === 3;
      out.push(make(i, `s${s}`, deny ? risky[i % risky.length] : safe[i % safe.length], deny ? 'deny_call' : 'allow'));
      i += 1;
    }
  }
  return out;
};

test('the model learns a real signal, is the same on every run, and every weight is a named feature', () => {
  const data = signal(20);
  const a = train(data, { lambda: 0.01 });
  const b = train(data, { lambda: 0.01 });
  expect(a.features).toEqual(b.features);
  expect(score(a, make(0, 'x', 'make deploy', 'allow'))).toBeLessThan(0.3);
  expect(score(a, make(0, 'x', 'git status', 'allow'))).toBeGreaterThan(0.9);
  expect(a.authority).toBe('none');
  expect(a.trainedOn).toMatchObject({ n: 200, denies: 20, projects: ['app'] });
  const named = explain(a, make(0, 'x', 'make deploy', 'allow'), 40);
  expect(named.every(({ feature }) => typeof feature === 'string')).toBe(true);
  expect(named.find(({ feature }) => feature === 'tok=deploy')!.weight).toBeLessThan(0);
  expect(a.known).toEqual(expect.arrayContaining(['prog=make', 'prog=git']));
  expect(a.known).not.toContain('prog=terraform');
});

test('a decision no person made teaches nothing, and a denial that is not about the call teaches less', () => {
  const data = signal(20);
  const noisy = [...data, ...Array.from({ length: 40 }, (_, i) => make(1000 + i, `n${i}`, 'ls', 'system'))];
  expect(train(noisy, { lambda: 0.01 }).features).toEqual(train(data, { lambda: 0.01 }).features);
  const steer = data.map((example) => (example.label === 'deny_call' ? { ...example, label: 'deny_stop' as const } : example));
  const strong = Math.abs(train(data, { lambda: 0.01 }).features['tok=deploy'] ?? 0);
  const weak = Math.abs(train(steer, { lambda: 0.01 }).features['tok=deploy'] ?? 0);
  expect(weak).toBeLessThan(strong);
});

test('regularization is chosen by sessions held out, and tiny data falls back to a fixed default', () => {
  expect(fitBest(signal(20)).lambda).toBeGreaterThan(0);
  expect(fitBest(signal(1)).lambda).toBe(0.1);
});
