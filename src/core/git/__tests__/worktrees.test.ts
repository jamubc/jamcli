import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describeWorktree, openWorktree, removeWorktree, worktreeChanges, worktreeNameProblem } from '../worktrees.js';

let root: string;

const IDENTITY = { GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' };
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-worktrees-')));
  git(root, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(root, 'add', 'a.txt');
  git(root, 'commit', '-q', '-m', 'first');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('a worktree is made from HEAD on its own branch, apart from the person\'s working copy', async () => {
  fs.writeFileSync(path.join(root, 'a.txt'), 'mine, not committed\n');
  const head = git(root, 'rev-parse', 'HEAD').trim();

  const tree = await openWorktree(root, 'feature');
  expect(tree).toMatchObject({ name: 'feature', branch: 'jamcli/feature', root: path.join(root, '.jamcli', 'worktrees', 'feature'), base: head, created: true });
  expect(tree.dir).toBe(tree.root);
  expect(git(tree.root, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('jamcli/feature');
  // It holds the commit, not the person's uncommitted change.
  expect(fs.readFileSync(path.join(tree.root, 'a.txt'), 'utf8')).toBe('one\n');
  // The person's branch and status are as they were, and the worktree is ignored there.
  expect(git(root, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main');
  expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe(' M a.txt\n');

  // Opening it again finds the same one.
  fs.writeFileSync(path.join(tree.root, 'b.txt'), 'new\n');
  const again = await openWorktree(root, 'feature');
  expect(again).toMatchObject({ root: tree.root, branch: tree.branch, base: head, created: false });
  expect(fs.existsSync(path.join(again.root, 'b.txt'))).toBe(true);
});

test('what a worktree holds is counted, and it is taken away with its branch', async () => {
  const tree = await openWorktree(root, 'work');
  expect(await worktreeChanges(tree)).toEqual({ commits: 0, uncommitted: [] });

  fs.writeFileSync(path.join(tree.root, 'a.txt'), 'two\n');
  git(tree.root, 'commit', '-q', '-am', 'second');
  fs.writeFileSync(path.join(tree.root, 'c.txt'), 'three\n');
  const changes = await worktreeChanges(tree);
  expect(changes).toEqual({ commits: 1, uncommitted: ['?? c.txt'] });
  const said = describeWorktree(tree, changes, root);
  expect(said).toContain('.jamcli/worktrees/work');
  expect(said).toContain('jamcli/work');
  expect(said).toContain('1 commit and 1 file changed and not committed');

  await removeWorktree(tree, { branch: true });
  expect(fs.existsSync(tree.root)).toBe(false);
  expect(git(root, 'branch', '--list', 'jamcli/work')).toBe('');
  expect(git(root, 'worktree', 'list')).not.toContain('worktrees/work');
});

test('a project in a subdirectory works in the same subdirectory of its worktree', async () => {
  const sub = path.join(root, 'packages', 'app');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'index.ts'), 'export {};\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'app');

  const tree = await openWorktree(sub, 'sub');
  expect(tree.root).toBe(path.join(sub, '.jamcli', 'worktrees', 'sub'));
  expect(tree.dir).toBe(path.join(tree.root, 'packages', 'app'));
  expect(fs.readFileSync(path.join(tree.dir, 'index.ts'), 'utf8')).toBe('export {};\n');
  expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe('');
});

test('a branch left from before is checked out, and a worktree deleted by hand is made again', async () => {
  git(root, 'branch', 'jamcli/kept');
  const kept = git(root, 'rev-parse', 'jamcli/kept').trim();
  git(root, 'commit', '-q', '--allow-empty', '-m', 'later on main');
  const tree = await openWorktree(root, 'kept');
  // The branch keeps its own commit rather than moving to the later HEAD.
  expect(git(root, 'rev-parse', 'jamcli/kept').trim()).toBe(kept);
  expect(git(tree.root, 'rev-parse', 'HEAD').trim()).toBe(kept);
  expect(tree.base).toBe(kept);

  fs.rmSync(tree.root, { recursive: true, force: true });
  const again = await openWorktree(root, 'kept');
  expect(again.created).toBe(true);
  expect(fs.existsSync(path.join(again.root, 'a.txt'))).toBe(true);
});

test('names, places, and repositories a worktree cannot have are refused', async () => {
  for (const name of ['', '../out', 'a b', '-flag', 'x.lock', 'a..b', 'end.', 'a/b', 'x'.repeat(65)]) {
    expect(worktreeNameProblem(name)).toBeDefined();
  }
  for (const name of ['feature', 'fix-12', 'v1.2_rc']) expect(worktreeNameProblem(name)).toBeUndefined();
  await expect(openWorktree(root, '../escape')).rejects.toThrow('cannot name a worktree');
  expect(fs.existsSync(path.join(root, '.jamcli', 'escape'))).toBe(false);

  fs.mkdirSync(path.join(root, '.jamcli', 'worktrees', 'taken'), { recursive: true });
  await expect(openWorktree(root, 'taken')).rejects.toThrow('exists and is not a worktree');

  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-plain-')));
  try {
    await expect(openWorktree(plain, 'x')).rejects.toThrow('needs a git repository');
    git(plain, 'init', '-q');
    await expect(openWorktree(plain, 'x')).rejects.toThrow('needs a commit');
  } finally {
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
