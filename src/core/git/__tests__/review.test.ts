import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readChanges, revertFile, revertHunk, stageFile, stageHunk, unstageFile, unstageHunk } from '../review.js';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });
const lines = (count: number, change: (index: number) => string | undefined = () => undefined) =>
  Array.from({ length: count }, (_, index) => change(index + 1) ?? `line ${index + 1}`).join('\n') + '\n';

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-review-')));
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), lines(30));
  fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0, 1, 2, 3]));
  git('add', '.');
  git('commit', '-q', '-m', 'first');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test('changes come by file and hunk, and one hunk is staged, unstaged, or reverted on its own', async () => {
  // Two changes far enough apart to be two hunks.
  fs.writeFileSync(path.join(dir, 'a.txt'), lines(30, (index) => (index === 3 ? 'line three' : index === 27 ? 'line twenty-seven' : undefined)));
  fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([9, 9, 0, 9]));
  fs.writeFileSync(path.join(dir, 'new.txt'), 'new\n');
  let changes = await readChanges(dir);
  expect(changes.root).toBe(dir);
  expect(changes.untracked).toEqual(['new.txt']);
  expect(changes.staged).toEqual([]);
  const [text, binary] = changes.unstaged;
  expect(binary).toMatchObject({ file: 'b.bin', kind: 'binary', hunks: [] });
  expect(text.kind).toBe('modified');
  expect(text.hunks.map((hunk) => [hunk.header, hunk.added, hunk.removed])).toEqual([
    ['@@ -1,6 +1,6 @@', 1, 1],
    ['@@ -24,7 +24,7 @@', 1, 1],
  ]);

  await stageHunk(changes.root, text.hunks[0]);
  expect(git('diff', '--cached')).toContain('+line three');
  expect(git('diff', '--cached')).not.toContain('twenty-seven');
  changes = await readChanges(dir);
  expect(changes.staged.map((file) => [file.file, file.hunks.length])).toEqual([['a.txt', 1]]);
  expect(changes.unstaged[0].hunks).toHaveLength(1);

  await unstageHunk(changes.root, changes.staged[0].hunks[0]);
  expect(git('diff', '--cached')).toBe('');
  expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toContain('line three');

  changes = await readChanges(dir);
  await revertHunk(changes.root, changes.unstaged[0].hunks[1]);
  const now = fs.readFileSync(path.join(dir, 'a.txt'), 'utf8');
  expect(now).toContain('line three');
  expect(now).not.toContain('twenty-seven');
  expect(now).toContain('line 27');

  // Whole files, for a binary or an untracked one.
  await stageFile(changes.root, 'b.bin');
  await stageFile(changes.root, 'new.txt');
  expect(git('diff', '--cached', '--name-only')).toBe('b.bin\nnew.txt\n');
  await unstageFile(changes.root, 'new.txt');
  expect(git('diff', '--cached', '--name-only')).toBe('b.bin\n');
  await unstageFile(changes.root, 'b.bin');
  await revertFile(changes.root, 'b.bin');
  expect([...fs.readFileSync(path.join(dir, 'b.bin'))]).toEqual([0, 1, 2, 3]);
});

test('a hunk that no longer fits is refused, and a project outside git says so', async () => {
  fs.writeFileSync(path.join(dir, 'a.txt'), lines(30, (index) => (index === 3 ? 'line three' : undefined)));
  const hunk = (await readChanges(dir)).unstaged[0].hunks[0];
  fs.writeFileSync(path.join(dir, 'a.txt'), lines(30, (index) => (index === 3 ? 'something else' : undefined)));
  await expect(revertHunk(dir, hunk)).rejects.toThrow(/patch does not apply/);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-review-')));
  try {
    await expect(readChanges(outside)).rejects.toThrow('This project is not a git repository');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('paths are from the top of the repository when the project is a subdirectory', async () => {
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.writeFileSync(path.join(dir, 'pkg', 'c.txt'), 'c\n');
  git('add', '.');
  git('commit', '-q', '-m', 'second');
  fs.writeFileSync(path.join(dir, 'pkg', 'c.txt'), 'C\n');
  const changes = await readChanges(path.join(dir, 'pkg'));
  expect(changes.root).toBe(dir);
  expect(changes.unstaged.map((file) => file.file)).toEqual(['pkg/c.txt']);
  await stageHunk(changes.root, changes.unstaged[0].hunks[0]);
  expect(git('diff', '--cached', '--name-only')).toBe('pkg/c.txt\n');
});
