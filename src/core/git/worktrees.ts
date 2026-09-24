import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureProjectStateDir } from '../transcript/log.js';

/**
 * Worktrees (D15): a session started with `--worktree <name>`, or a task delegated with
 * `isolation: "worktree"`, works in a `git worktree add` directory on a `jamcli/<name>`
 * branch, so its changes stay apart from the person's working copy until they merge them.
 * The directories live under the project's `.jamcli/worktrees/`, which git ignores.
 */

export interface Worktree {
  name: string;
  /** The worktree's top directory. */
  root: string;
  /** The project inside it: its top, or the subdirectory the project is in. */
  dir: string;
  /** `jamcli/<name>`. */
  branch: string;
  /** The commit it was made from, which its changes are counted against. */
  base: string;
  /** False when an existing worktree of that name was opened again. */
  created: boolean;
}

export interface WorktreeChanges {
  /** Commits on the branch since the base. */
  commits: number;
  /** `git status --porcelain` lines: what is changed and not committed. */
  uncommitted: string[];
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim()));
      else resolve(String(stdout));
    });
  });
}

const attempt = (args: string[], cwd: string) => git(args, cwd).then((out) => out.trim(), () => undefined);

/** A path with its symbolic links resolved as far as it exists, as git reports worktrees. */
function real(target: string): string {
  if (fs.existsSync(target)) return fs.realpathSync(target);
  const parent = path.dirname(target);
  return parent === target ? target : path.join(real(parent), path.basename(target));
}

/** Why a worktree cannot have this name, or nothing when it can. */
export function worktreeNameProblem(name: string): string | undefined {
  if (!name) return 'A worktree needs a name.';
  if (name.length > 64) return 'A worktree name is at most 64 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..') || name.endsWith('.lock') || name.endsWith('.')) {
    return `"${name}" cannot name a worktree: use letters, digits, dots, dashes, and underscores, starting with a letter or digit.`;
  }
  return undefined;
}

/** The directory a worktree of this name has, under the project's `.jamcli/worktrees/`. */
export const worktreePath = (projectRoot: string, name: string) => path.join(path.resolve(projectRoot), '.jamcli', 'worktrees', name);

/**
 * Open the worktree `name`: made from HEAD on a new `jamcli/<name>` branch, or the existing
 * one again. A branch of that name left from before is checked out rather than replaced.
 */
export async function openWorktree(projectRoot: string, name: string): Promise<Worktree> {
  const problem = worktreeNameProblem(name);
  if (problem) throw new Error(problem);
  const top = await attempt(['rev-parse', '--show-toplevel'], projectRoot);
  if (!top) throw new Error('A worktree needs a git repository, and this project is not in one.');
  const project = path.resolve(projectRoot);
  const inside = path.relative(real(top), real(project));
  const root = worktreePath(project, name);
  const branch = `jamcli/${name}`;
  const dir = inside ? path.join(root, inside) : root;
  const head = await attempt(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], top);
  if (!head) throw new Error('A worktree needs a commit to start from, and this repository has none yet.');

  const listed = await git(['worktree', 'list', '--porcelain'], top);
  const registered = listed.split('\n').includes(`worktree ${real(root)}`);
  if (registered && fs.existsSync(root)) {
    const base = (await attempt(['merge-base', 'HEAD', head], root)) ?? head;
    return { name, root, dir, branch, base, created: false };
  }
  if (fs.existsSync(root)) throw new Error(`${path.relative(project, root)} exists and is not a worktree; move it aside or name another.`);
  // Registered but gone, as after the directory was deleted by hand: git forgets it first.
  if (registered) await git(['worktree', 'prune'], top);

  ensureProjectStateDir(project);
  fs.mkdirSync(path.dirname(root), { recursive: true });
  const exists = await attempt(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], top);
  await git(['worktree', 'add', ...(exists ? [root, branch] : ['-b', branch, root, head])], top);
  const base = exists ? ((await attempt(['merge-base', branch, head], top)) ?? head) : head;
  return { name, root, dir, branch, base, created: true };
}

/** What a worktree holds that its base does not: commits, and changes not committed. */
export async function worktreeChanges(tree: Worktree): Promise<WorktreeChanges> {
  const commits = Number((await attempt(['rev-list', '--count', `${tree.base}..HEAD`], tree.root)) ?? '0');
  const status = await git(['status', '--porcelain', '--untracked-files=all'], tree.root);
  return { commits, uncommitted: status.split('\n').filter(Boolean) };
}

/** Take a worktree away, and its branch with it when `branch` is set and it holds nothing new. */
export async function removeWorktree(tree: Worktree, options: { branch?: boolean } = {}): Promise<void> {
  await git(['worktree', 'remove', '--force', tree.root], path.dirname(tree.root));
  if (options.branch) await attempt(['branch', '-D', tree.branch], path.dirname(tree.root));
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Where a worktree's changes are, and what to do with them, in a line or two. */
export function describeWorktree(tree: Worktree, changes: WorktreeChanges, projectRoot: string): string {
  const where = path.relative(path.resolve(projectRoot), tree.root) || tree.root;
  const held = [changes.commits ? plural(changes.commits, 'commit') : '', changes.uncommitted.length ? `${plural(changes.uncommitted.length, 'file')} changed and not committed` : '']
    .filter(Boolean)
    .join(' and ');
  return `The worktree ${where}, on branch ${tree.branch}, holds ${held || 'no changes'}. Merge the branch with git merge ${tree.branch} once it is committed, or take it away with git worktree remove ${where}.`;
}
