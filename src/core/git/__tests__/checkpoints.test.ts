import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CheckpointStore, filesOfCall } from '../checkpoints.js';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });
const write = (name: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
};
const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-checkpoints-')));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Everything about the person's own git state that a checkpoint must leave alone. */
const ownState = () => ({
  head: git('rev-parse', 'HEAD'),
  branches: git('branch', '--list'),
  staged: git('diff', '--cached'),
  stash: git('stash', 'list'),
  status: git('status', '--porcelain'),
});

test('in a repository, a checkpoint restores the working copy and leaves the index, HEAD, branches, and stash as they were', async () => {
  git('init', '-q', '-b', 'main');
  write('.gitignore', 'secret.log\n');
  write('a.txt', 'one\n');
  write('gone.txt', 'here\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  write('a.txt', 'stashed\n');
  git('stash', '-q');
  write('a.txt', 'staged\n');
  git('add', 'a.txt');
  write('a.txt', 'working\n');
  write('untracked.txt', 'mine\n');
  write('secret.log', 'ignored\n');

  const store = new CheckpointStore(dir, 's1');
  const before = ownState();
  const checkpoint = (await store.take('before edit'))!;
  expect(checkpoint.kind).toBe('git');
  expect(ownState()).toEqual(before);
  expect(git('rev-parse', store.refName).trim()).toBe(checkpoint.ref);
  // The ignored file is not in the checkpoint.
  expect(git('ls-tree', '-r', '--name-only', checkpoint.ref)).not.toContain('secret.log');

  // Nothing changed, so the same checkpoint stands for this moment too.
  expect((await store.take('again'))!.ref).toBe(checkpoint.ref);

  write('a.txt', 'changed by the model\n');
  write('added.txt', 'new\n');
  fs.rmSync(path.join(dir, 'gone.txt'));
  write('secret.log', 'ignored, changed\n');
  const preview = await store.preview(checkpoint);
  expect(preview.files).toEqual([
    { path: 'a.txt', change: 'restored' },
    { path: 'added.txt', change: 'deleted' },
    { path: 'gone.txt', change: 'recreated' },
  ]);
  expect(preview.diff).toContain('-changed by the model');
  expect(preview.diff).toContain('+working');

  const staged = git('diff', '--cached');
  expect(await store.restore(checkpoint)).toEqual(['a.txt', 'added.txt', 'gone.txt']);
  expect(read('a.txt')).toBe('working\n');
  expect(read('gone.txt')).toBe('here\n');
  expect(fs.existsSync(path.join(dir, 'added.txt'))).toBe(false);
  expect(read('untracked.txt')).toBe('mine\n');
  expect(read('secret.log')).toBe('ignored, changed\n');
  expect(git('diff', '--cached')).toBe(staged);
  expect(git('stash', 'list')).toBe(before.stash);
  expect(git('rev-parse', 'HEAD')).toBe(before.head);

  // A second checkpoint follows the first on the private ref.
  write('a.txt', 'later\n');
  const next = (await store.take('later'))!;
  expect(git('rev-parse', `${next.ref}^`).trim()).toBe(checkpoint.ref);
});

test('in a subdirectory of a repository, paths are the project\'s own', async () => {
  git('init', '-q', '-b', 'main');
  write('pkg/a.txt', 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const store = new CheckpointStore(path.join(dir, 'pkg'), 's2');
  const checkpoint = (await store.take('x'))!;
  write('pkg/a.txt', 'two\n');
  expect((await store.preview(checkpoint)).files).toEqual([{ path: 'a.txt', change: 'restored' }]);
  await store.restore(checkpoint);
  expect(read('pkg/a.txt')).toBe('one\n');
});

test('outside a repository, the named files are backed up, and restoring removes those that did not exist', async () => {
  write('a.txt', 'one\n');
  const store = new CheckpointStore(dir, 's3');
  expect(await store.take('nothing named')).toBeUndefined();
  const checkpoint = (await store.take('before write', ['a.txt', 'new/b.txt']))!;
  expect(checkpoint).toMatchObject({ kind: 'files', files: ['a.txt', 'new/b.txt'] });
  expect(checkpoint.ref.startsWith(path.join(dir, '.jamcli', 'checkpoints', 's3'))).toBe(true);
  write('a.txt', 'two\n');
  write('new/b.txt', 'created\n');
  const preview = await store.preview(checkpoint);
  expect(preview.files).toEqual([
    { path: 'a.txt', change: 'restored' },
    { path: 'new/b.txt', change: 'deleted' },
  ]);
  await store.restore(checkpoint);
  expect(read('a.txt')).toBe('one\n');
  expect(fs.existsSync(path.join(dir, 'new', 'b.txt'))).toBe(false);
  // Another backup does not overwrite the first.
  const second = (await store.take('again', ['a.txt']))!;
  expect(second.ref).not.toBe(checkpoint.ref);
});

test("a call's files are the ones it names inside the project", () => {
  const root = '/work/project';
  expect(filesOfCall({ id: '1', name: 'write_file', arguments: { path: 'src/a.ts', content: '' } }, root)).toEqual(['src/a.ts']);
  const patch = ['--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-a', '+b', '--- /dev/null', '+++ b/y.ts', '@@ -0,0 +1 @@', '+c', ''].join('\n');
  expect(filesOfCall({ id: '2', name: 'apply_patch', arguments: { patch } }, root)).toEqual(['x.ts', 'y.ts']);
  expect(filesOfCall({ id: '3', name: 'edit', arguments: { path: '../elsewhere.ts' } }, root)).toEqual([]);
  expect(filesOfCall({ id: '4', name: 'run_command', arguments: { command: 'rm -rf x' } }, root)).toEqual([]);
});

test('a change git sees only through its racy-file check is seen in a checkpoint too', async () => {
  git('init', '-q', '-b', 'main');
  // Only size and modification time count, so a same-size edit at the same time looks unchanged
  // unless git notices that the index is no newer than the entry.
  git('config', 'core.trustctime', 'false');
  git('config', 'core.checkStat', 'minimal');
  const past = new Date('2020-01-01T00:00:00Z');
  write('a.txt', 'old\n');
  fs.utimesSync(path.join(dir, 'a.txt'), past, past);
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  fs.utimesSync(path.join(dir, '.git', 'index'), past, past);
  const store = new CheckpointStore(dir, 'racy');
  const checkpoint = (await store.take('before'))!;
  write('a.txt', 'new\n');
  fs.utimesSync(path.join(dir, 'a.txt'), past, past);
  expect((await store.preview(checkpoint)).files).toEqual([{ path: 'a.txt', change: 'restored' }]);
  // Git sees it too. Asked first, git status would have rewritten the index and hidden the case.
  expect(git('status', '--porcelain')).toBe(' M a.txt\n');
});

test("a settled checkpoint restores only what its step changed, not the person's own changes since", async () => {
  git('init', '-q', '-b', 'main');
  write('a.txt', 'one\n');
  write('mine.txt', 'mine\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  const store = new CheckpointStore(dir, 's4');
  const before = (await store.take('edit a.txt'))!;
  // The step changes a.txt and adds made.txt.
  write('a.txt', 'two\n');
  write('made.txt', 'made\n');
  const after = (await store.settle(before, 'edit a.txt'))!;
  expect(git('rev-parse', `${after}^`).trim()).toBe(before.ref);
  // Then the person edits their own file and adds another.
  write('mine.txt', 'mine, edited\n');
  write('notes.md', 'notes\n');
  const settled = { ...before, after };
  expect((await store.preview(settled)).files).toEqual([
    { path: 'a.txt', change: 'restored' },
    { path: 'made.txt', change: 'deleted' },
  ]);
  await store.restore(settled);
  expect(read('a.txt')).toBe('one\n');
  expect(fs.existsSync(path.join(dir, 'made.txt'))).toBe(false);
  expect(read('mine.txt')).toBe('mine, edited\n');
  expect(read('notes.md')).toBe('notes\n');
  // A step that changed nothing settles to nothing.
  const idle = (await store.take('run_command true'))!;
  expect(await store.settle(idle, 'run_command true')).toBeUndefined();
});
