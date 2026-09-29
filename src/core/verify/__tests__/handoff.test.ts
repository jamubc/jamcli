import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readResetHandoff, renderHandoff, writeHandoff } from '../handoff.js';
import type { TranscriptEvent } from '../../transcript/events.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-handoff-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const events: TranscriptEvent[] = [
  { v: 2, type: 'session', ts: 0, id: 's1', projectRoot: '/p', cwd: '/p', surface: 'headless', jamcli: '0' },
  { v: 2, type: 'message', ts: 1, message: { role: 'user', content: 'add a retry to the fetch helper', timestamp: 1 } },
  { v: 2, type: 'checkpoint', ts: 2, ref: 'abc', after: 'tree0001', label: 'edit src/fetch.ts' },
  { v: 2, type: 'gate', ts: 3, tier: 'T1', name: 'typecheck', command: 'tsc', tree: 'tree0001', status: 'failed', durationMs: 900, step: 2, shaped: 'typecheck failed in 0.9 s on tree tree000\nsrc/fetch.ts(3,1): error TS1' },
  { v: 2, type: 'checkpoint', ts: 4, ref: 'abd', after: 'tree0002', label: 'edit src/fetch.ts' },
  { v: 2, type: 'checkpoint', ts: 5, ref: 'abe', after: 'tree0003', label: 'write_file src/retry.ts' },
  { v: 2, type: 'message', ts: 6, message: { role: 'user', content: '[A stop hook asks you to continue: fix it]', timestamp: 6 } },
];

test('the handoff is rendered from the log: request, steps, gates, changed files, and the open failure', () => {
  const text = renderHandoff(events, [{ content: 'add retry', status: 'completed', check: 'bun test', verified: { gate: 'test', tree: 'tree0003' } }], { sessionId: 's1', reason: 'session_end', now: Date.UTC(2026, 8, 28) });
  expect(text.split('\n')[0]).toBe('# Handoff s1 2026-09-28T00:00:00.000Z');
  expect(text).toContain('Request: add a retry to the fetch helper');
  expect(text).toContain('1. [x] add retry [verified: test, tree tree000]\n   check: bun test');
  expect(text).toContain('Gates:\ntypecheck failed on tree tree000 at step 2');
  expect(text).toContain('Changed:\nsrc/fetch.ts\nsrc/retry.ts');
  expect(text).toContain('Open:\ntypecheck failed in 0.9 s on tree tree000\nsrc/fetch.ts(3,1): error TS1');
  // A rendering, not a source: the same log renders the same bytes.
  expect(renderHandoff(events, [], { sessionId: 's1', reason: 'session_end', now: 1 })).toBe(renderHandoff(events, [], { sessionId: 's1', reason: 'session_end', now: 1 }));
});

test('a last request that is not the work does not stand in for it: the request the session began with is named too', () => {
  const later: TranscriptEvent[] = [...events, { v: 2, type: 'message', ts: 7, message: { role: 'user', content: 'what colour would you pick?', timestamp: 7 } }];
  const text = renderHandoff(later, [], { sessionId: 's1', reason: 'session_end' });
  expect(text).toContain('Request: what colour would you pick?\nBegan with: add a retry to the fetch helper');
  // With one request there is nothing to add, and a long first one is cut.
  expect(renderHandoff(events, [], { sessionId: 's1', reason: 'session_end' })).not.toContain('Began with');
  const long: TranscriptEvent[] = [{ v: 2, type: 'message', ts: 1, message: { role: 'user', content: 'x'.repeat(500), timestamp: 1 } }, later.at(-1)!];
  expect(renderHandoff(long, [], { sessionId: 's1', reason: 'session_end' })).toContain(`Began with: ${'x'.repeat(300)}...`);
});

test('only a handoff written as a reset is read by the next session', () => {
  writeHandoff(root, renderHandoff(events, [], { sessionId: 's1', reason: 'session_end' }));
  expect(readResetHandoff(root)).toBeUndefined();
  const written = writeHandoff(root, renderHandoff(events, [], { sessionId: 's1', reason: 'reset' }));
  expect(written.path).toBe(path.join('.jamcli', 'handoff.md'));
  expect(readResetHandoff(root)?.session).toBe('s1');
  expect(fs.existsSync(path.join(root, '.jamcli', '.gitignore'))).toBe(true);
});
