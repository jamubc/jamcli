import { expect, test } from 'bun:test';
import type { TranscriptEvent } from '../../../src/core/transcript/events.js';
import { examplesFromEvents, labelOf, withHistory } from '../extract.js';
import { isAllow, isHuman } from '../types.js';

test('an answer is labelled by who gave it and what came with it', () => {
  const l = (allow: boolean, by: string, scope: string, feedback?: string) => labelOf({ allow, by, scope, feedback });
  expect(l(true, 'user', 'once')).toBe('allow');
  expect(l(true, 'user', 'session')).toBe('allow_grant');
  expect(l(true, 'user', 'project')).toBe('allow_grant');
  expect(l(false, 'user', 'once')).toBe('deny_call');
  expect(l(false, 'user', 'once', 'the person stopped the turn')).toBe('deny_stop');
  expect(l(false, 'user', 'once', 'Use bun, not npm.')).toBe('deny_steer');
  // Answers no person gave, though the log says "user".
  expect(l(false, 'user', 'once', 'The editor did not answer.')).toBe('system');
  expect(l(false, 'user', 'once', 'the person was asked and did not answer (cancel)')).toBe('system');
  for (const by of ['mode', 'policy', 'hook', 'flag']) expect(l(true, by, 'once')).toBe('system');
});

const header = (over: Record<string, unknown> = {}): TranscriptEvent => ({ v: 2, type: 'session', ts: 1, id: 's1', projectRoot: '/work/app', cwd: '/work/app', surface: 'tui', jamcli: '0', permissionMode: 'default', ...over }) as TranscriptEvent;
const user = (ts: number, content: string): TranscriptEvent => ({ v: 2, type: 'message', ts, message: { role: 'user', content, timestamp: ts } });
const calls = (ts: number, ...list: [string, string, Record<string, unknown>][]): TranscriptEvent => ({
  v: 2,
  type: 'message',
  ts,
  message: { role: 'assistant', content: '', timestamp: ts, tool_calls: list.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) },
});
const approval = (ts: number, callId: string, tool: string, allow: boolean, extra: Record<string, unknown> = {}): TranscriptEvent =>
  ({ v: 2, type: 'approval', ts, callId, tool, allow, scope: 'once', by: 'user', surface: 'tui', ...extra }) as TranscriptEvent;

test('each approval is joined to its call, with the mode, the request, and the floor', () => {
  const secret = 'sk-live-abcdef0123456789';
  const events: TranscriptEvent[] = [
    header(),
    user(2, 'clean up the build'),
    calls(3, ['c1', 'run_command', { command: `API_KEY=${secret} make clean` }], ['c2', 'run_command', { command: 'rm -rf dist' }]),
    approval(4, 'c1', 'run_command', true),
    { v: 2, type: 'permission_mode', ts: 5, from: 'default', to: 'auto' },
    approval(6, 'c2', 'run_command', false, { feedback: 'the person stopped the turn' }),
    approval(7, 'p1/c9', 'run_command', true),
    approval(8, 'gone', 'run_command', true),
  ];
  const { examples, skipped } = examplesFromEvents(events, { redact: (text) => text.replaceAll(secret, '[redacted]') });
  expect(skipped).toEqual({ nested: 1, unjoined: 1, surface: 0 });
  expect(examples.map((example) => [example.id, example.label, example.mode, example.turnCall])).toEqual([
    ['s1#c1', 'allow', 'default', 0],
    ['s1#c2', 'deny_stop', 'auto', 1],
  ]);
  expect(examples[0].command).toBe('API_KEY=[redacted] make clean');
  expect(examples[0].request).toBe('clean up the build');
  expect(examples[0].floor).toBeUndefined();
  expect(examples[1].floor).toContain('rm');
  expect(JSON.stringify(examples)).not.toContain(secret);
});

test('a surface filter leaves other sessions out, and a child session counts as its own surface', () => {
  const events = [header(), user(2, 'go'), calls(3, ['c1', 'edit', { path: 'a.ts' }]), approval(4, 'c1', 'edit', true)];
  expect(examplesFromEvents(events, { surfaces: ['acp'] })).toEqual({ examples: [], skipped: { nested: 0, unjoined: 0, surface: 1 } });
  const child = examplesFromEvents([header({ delegatedBy: 'parent' }), ...events.slice(1)], { surfaces: ['child'] });
  expect(child.examples[0]).toMatchObject({ surface: 'child', child: true });
});

test('history counts only human decisions before a call, in time order, and never the call itself', () => {
  const make = (session: string, ts: number, command: string, allow: boolean, by = 'user') =>
    examplesFromEvents([header({ id: session, ts }), user(ts, 'go'), calls(ts, ['c', 'run_command', { command }]), approval(ts + 1, 'c', 'run_command', allow, { by })]).examples;
  const late = make('s2', 200, 'bun test src/a.ts', true);
  const early = make('s1', 100, 'bun test src/b.ts', true);
  const denied = make('s3', 300, 'node scripts/x.js 42', false);
  const again = make('s4', 400, 'node scripts/x.js 7', true);
  const system = make('s5', 250, 'bun test src/c.ts', true, 'mode');
  const out = withHistory([...late, ...again, ...denied, ...early, ...system]);
  const by = (id: string) => out.find((example) => example.session === id)!;
  expect(by('s1').history).toEqual({ priorHuman: 0, priorAllows: 0, seenAllowed: false, seenDenied: false });
  // Paths differ, but the normalized call is the same act: seen.
  expect(by('s2').history).toMatchObject({ priorHuman: 1, seenAllowed: true });
  // A system decision neither counts nor teaches.
  expect(by('s5').history).toMatchObject({ priorHuman: 2 });
  expect(by('s3').history).toMatchObject({ priorHuman: 2, seenAllowed: false, seenDenied: false });
  expect(by('s4').history).toMatchObject({ priorHuman: 3, seenDenied: true });
  expect(out.filter(isHuman).filter(isAllow)).toHaveLength(3);
});

test('a dataset cut at a date is the earlier part of the full one, with the same history', async () => {
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const { extract } = await import('../extract.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-until-'));
  try {
    const write = (id: string, ts: number, command: string) =>
      fs.writeFileSync(path.join(dir, `${id}.jsonl`), [header({ id, ts }), user(ts, 'go'), calls(ts, ['c', 'run_command', { command }]), approval(ts + 1, 'c', 'run_command', true)].map((event) => JSON.stringify(event)).join('\n') + '\n');
    write('a', 100, 'bun test src/a.ts');
    write('b', 200, 'bun test src/b.ts');
    write('c', 300, 'ls');
    const full = extract([dir]);
    const cut = extract([dir], { until: 250 });
    expect(full.examples).toHaveLength(3);
    expect(cut.examples.map((example) => example.session)).toEqual(['a', 'b']);
    expect(cut.examples).toEqual(full.examples.filter((example) => example.ts <= 250));
    expect(cut.examples[1].history).toMatchObject({ priorHuman: 1, seenAllowed: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
