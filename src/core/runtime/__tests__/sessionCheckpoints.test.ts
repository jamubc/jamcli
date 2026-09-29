import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SessionCheckpoints } from '../checkpoints.js';
import type { TranscriptEvent } from '../../transcript/index.js';

let dir: string;
let events: TranscriptEvent[];
let warnings: string[];
let busy: boolean;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const edit = (file: string) => ({ id: 'e', name: 'edit', arguments: { path: file, find_string: 'x', replace_string: 'y' } });

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-session-checkpoints-')));
  events = [];
  warnings = [];
  busy = false;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const checkpoints = () =>
  new SessionCheckpoints({
    workRoot: dir,
    sessionId: 's1',
    events: () => events,
    record: (checkpoint) => events.push({ v: 2, type: 'checkpoint', ts: events.length + 1, ...checkpoint }),
    warn: (message) => warnings.push(message),
    busy: () => busy,
  });

test('a step that changes the working copy is recorded, moves the last tree, and marks the turn', async () => {
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const store = checkpoints();
  store.startTurn();

  // A step that changed nothing leaves no checkpoint.
  await store.take(edit('a.txt'));
  await store.settle();
  expect(store.list()).toEqual([]);
  expect(store.changedThisTurn).toBe(false);
  expect(store.lastTree).toBeUndefined();

  await store.take(edit('a.txt'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  await store.settle();
  expect(store.list()).toMatchObject([{ n: 1, kind: 'git', label: 'edit a.txt' }]);
  expect(store.changedThisTurn).toBe(true);
  expect(store.lastTree).toBe(store.list()[0]!.after);
  store.startTurn();
  expect(store.changedThisTurn).toBe(false);

  // A restore is itself checkpointed, so it can be undone.
  expect((await store.preview(1)).files).toEqual([{ path: 'a.txt', change: 'restored' }]);
  await store.restore(1);
  expect(read('a.txt')).toBe('one\n');
  expect(store.list().map((entry) => entry.label)).toEqual(['edit a.txt', 'before restoring checkpoint 1']);
  await expect(store.preview(9)).rejects.toThrow('This session has no checkpoint 9.');
});

test('outside a repository the files are backed up, and a person waits for a running turn', async () => {
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  const store = checkpoints();
  await store.take(edit('a.txt'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  await store.settle();
  expect(store.list()).toMatchObject([{ n: 1, kind: 'files', files: ['a.txt'] }]);

  busy = true;
  await expect(store.withCheckpoint('revert a hunk', async () => 'done')).rejects.toThrow('A turn is running; wait for it to end.');
  busy = false;
  expect(await store.withCheckpoint('revert a hunk', async () => 'done', ['a.txt'])).toBe('done');
  expect(store.list().at(-1)).toMatchObject({ label: 'revert a hunk', kind: 'files' });
  expect(warnings).toEqual([]);
});
