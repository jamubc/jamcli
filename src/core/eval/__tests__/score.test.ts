import { expect, test } from 'bun:test';
import type { ChatMessage } from '../../types.js';
import type { TranscriptEvent } from '../../transcript/events.js';
import { cluster, route, score } from '../index.js';
import { signalsOf, signature } from '../../reflection/signals.js';

const header = (id = 's'): TranscriptEvent => ({ v: 2, type: 'session', ts: 1_000, id, projectRoot: '/p', cwd: '/p', surface: 'headless', jamcli: '0' });
const message = (m: Partial<ChatMessage> & Pick<ChatMessage, 'role'>, ts = 1_000): TranscriptEvent => ({ v: 2, type: 'message', ts, message: { content: '', timestamp: 0, ...m } });
const call = (id: string, name: string, args: object, ts = 1_000) => message({ role: 'assistant', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, ts);
const result = (id: string, toolName: string, toolStatus: ChatMessage['toolStatus'], content = '') => message({ role: 'tool', tool_call_id: id, toolName, toolStatus, content });
const usage = (prompt: number, completion = 10, cached = 0, cost?: number): TranscriptEvent => ({ v: 2, type: 'usage', ts: 1_000, usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cached_tokens: cached }, ...(cost !== undefined ? { cost } : {}) });
const context = (): TranscriptEvent => ({ v: 2, type: 'context', ts: 1_000, system: 's' });

/** A run that read twice through a command, edited once, failed its gate, fixed it, and was denied a stop once. */
const session: TranscriptEvent[] = [
  header(),
  message({ role: 'user', content: 'fix the parser' }),
  context(),
  call('c1', 'run_command', { command: 'cat src/parse.ts' }),
  usage(1_000, 20, 0, 0.001),
  result('c1', 'run_command', 'ok', 'Exit code 0 after 0.1s.\n\nconst x = 1;'),
  call('r1', 'read_file', { path: 'src/parse.ts' }),
  usage(1_200, 20, 900, 0.001),
  result('r1', 'read_file', 'ok', '1|abc|const x = 1;'),
  call('e1', 'edit', { path: 'src/parse.ts', find_string: 'const x = 1;', replace_string: 'const x = 2;' }),
  usage(1_400, 20, 1_100, 0.001),
  result('e1', 'edit', 'ok', 'Replaced 1 occurrence in src/parse.ts.'),
  { v: 2, type: 'gate', ts: 1_000, tier: 'T1', name: 'typecheck', command: 'tsc', tree: 'tree1', status: 'failed', durationMs: 900, step: 3, shaped: 'typecheck failed in 0.9 s on tree tree1\nsrc/parse.ts(1,7): error TS2322: no' },
  message({ role: 'assistant', content: 'Done.' }),
  usage(1_600, 5, 1_300, 0.001),
  { v: 2, type: 'steer', ts: 1_000, handler: 'M5', detail: 'stop denied: typecheck failed on tree tree1' },
  message({ role: 'user', content: '[A stop hook asks you to continue: typecheck failed]' }),
  call('e2', 'edit', { path: 'src/parse.ts', find_string: 'const x = 2;', replace_string: 'const x: number = 2;' }),
  usage(1_800, 20, 1_500),
  result('e2', 'edit', 'ok', 'Replaced 1 occurrence in src/parse.ts.'),
  { v: 2, type: 'gate', ts: 1_000, tier: 'T1', name: 'typecheck', command: 'tsc', tree: 'tree2', status: 'passed', durationMs: 800, step: 5 },
  { v: 2, type: 'gate', ts: 1_000, tier: 'T2', name: 'test', command: 'bun test', tree: 'tree2', status: 'passed', durationMs: 3_000, step: 5 },
  message({ role: 'assistant', content: 'Fixed and verified.' }),
  usage(2_000, 5, 1_700, 0.001),
  { v: 2, type: 'end', ts: 4_000, status: 'ok' },
];

test('a run is scored from its log alone, with the checks it declared', () => {
  const metrics = score(session, [{ check: 'a', pass: true }, { check: 'b', pass: true }]);
  expect(metrics).toMatchObject({
    success: true,
    tokensIn: 9_000,
    tokensOut: 90,
    cacheBreaks: 0,
    unpricedRequests: 1,
    requests: 6,
    steps: 6,
    calls: 4,
    approvals: {},
    toolErrors: {},
    falseDone: 1,
    compactions: {},
    elisions: { count: 0, tokensRemoved: 0 },
    steers: { M5: 1 },
    wallSeconds: 3,
  });
  expect(metrics.cachedShare).toBeCloseTo(6_500 / 9_000, 5);
  expect(metrics.costUsd).toBeCloseTo(0.005, 9);
  expect(metrics.gateRuns.map((gate) => [gate.name, gate.status])).toEqual([
    ['typecheck', 'failed'],
    ['typecheck', 'passed'],
    ['test', 'passed'],
  ]);
  // The stop denial continues the same turn, so its second edit of the file counts against the turn.
  expect(metrics.components).toEqual({ readsBeforeFirstEdit: 1, editsPerFilePerTurn: 2, readViaCommand: 1, gateFirstTry: 0.5, repairSteps: 2 });
  expect(score(session).success).toBeUndefined();
  expect(score(session, [{ check: 'a', pass: false }]).success).toBe(false);
});

test('signals carry a subtype and a signature that abstracts paths and numbers', () => {
  const signals = signalsOf(session);
  expect(signals.map((signal) => [signal.kind, signal.subtype])).toEqual([
    ['waste', 'read_via_command'],
    ['gate_fail', 'first_try'],
    ['false_done', 'stop_denied'],
  ]);
  expect(signals[0].signature).toBe('waste/read_via_command/run_command/read through a command');
  expect(signature('tool_error', 'not_found', 'edit', 'edit error: find_string was not found in src/a.ts, so nothing was changed.')).toBe('tool_error/not_found/edit/edit error');
  expect(signature('tool_error', 'ambiguous_match', 'edit', 'edit error: find_string matches 3 locations in "src/b.ts"; this edit is ambiguous.')).toBe('tool_error/ambiguous_match/edit/edit error');
  const subtypes = [
    ['Invalid arguments for edit: missing required argument "path"', 'schema_invalid'],
    ['Anchors for a.ts are stale: 1 of the anchors read no longer match', 'stale_anchor'],
    ['find_string matches 2 locations in a.ts; this edit is ambiguous.', 'ambiguous_match'],
    ['find_string was not found in a.ts, so nothing was changed.', 'not_found'],
    ['Tool edit failed: boom', 'other'],
  ] as const;
  for (const [content, expected] of subtypes) {
    const found = signalsOf([header(), message({ role: 'user', content: 'go' }), call('x', 'edit', {}), result('x', 'edit', 'error', content)]);
    expect([content, found[0]?.subtype]).toEqual([content, expected]);
  }
});

test('clusters group signatures across sessions, weighted by tokens and by the tasks that failed, and route to a surface', () => {
  const failing = [header('f'), message({ role: 'user', content: 'go' }), call('x', 'edit', { path: 'a.ts', find_string: 'q' }), usage(5_000), result('x', 'edit', 'error', 'find_string was not found in a.ts, so nothing was changed.'), call('y', 'edit', { path: 'a.ts', find_string: 'q2' }), usage(5_100), result('y', 'edit', 'error', 'find_string was not found in a.ts, so nothing was changed.'), message({ role: 'assistant', content: 'gave up' }), usage(100)];
  const passing = [header('p'), message({ role: 'user', content: 'go' }), call('x', 'edit', { path: 'b.ts', find_string: 'z' }), usage(500), result('x', 'edit', 'error', 'find_string was not found in b.ts, so nothing was changed.'), call('w', 'read_file', { path: 'unused.ts' }), usage(500), result('w', 'read_file', 'ok'), message({ role: 'assistant', content: 'done' }), usage(100)];
  const clusters = cluster([
    { id: 'f', events: failing as TranscriptEvent[], success: false },
    { id: 'p', events: passing as TranscriptEvent[], success: true },
  ]);
  expect(clusters[0]).toMatchObject({ signature: 'tool_error/not_found/edit/edit error', kind: 'tool_error', subtype: 'not_found', tool: 'edit', count: 3, sessions: 2, failedSessions: 1 });
  expect(clusters[0].weight).toBeGreaterThan(clusters[1].weight);
  expect(clusters.map((entry) => entry.kind)).toEqual(['tool_error', 'waste']);
  expect(clusters[0].examples[0]).toStartWith('f[4] edit error: find_string was not found in a.ts');
  expect(route(clusters[0])).toBe('tool_error');
  expect(route({ kind: 'tool_error', subtype: 'schema_invalid' })).toBe('tool_schema');
  expect(route({ kind: 'waste', subtype: 'read_via_command' })).toBe('prompt_reads');
  expect(route({ kind: 'false_done', subtype: 'stop_denied' })).toBe('backpressure');
  expect(route({ kind: 'gate_fail', subtype: 'first_try' })).toBe('after_edit');
  expect(route({ kind: 'denied', subtype: 'by_user' })).toBe('none');
});
