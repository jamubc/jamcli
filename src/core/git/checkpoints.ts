import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTwoFilesPatch, parsePatch } from 'diff';
import type { ToolCall } from '../types.js';
import { ensureProjectStateDir } from '../transcript/log.js';

/**
 * Checkpoints of the working copy, taken before a step changes anything, so a change can
 * be undone whatever the person's own git state is (D15).
 *
 * In a repository, a checkpoint is a commit of the whole working copy on the private ref
 * `refs/jamcli/checkpoints/<session>`. It is built through a temporary index, seeded
 * from a copy of the person's index so that only changed files are read again: their
 * index, HEAD, branches, and stash are never touched, and ignored files stay out.
 * Outside a repository, the files a write is about to change are copied to
 * `.jamcli/checkpoints/<session>/<n>/`, with a note of those that did not exist yet.
 */

export interface Checkpoint {
  /** A commit on the private ref, or a backup directory outside a repository. */
  ref: string;
  kind: 'git' | 'files';
  /** Outside a repository: the files backed up, relative to the project. */
  files?: string[];
  /**
   * In a repository: the working copy once the step was done. A restore then touches only
   * what the step changed, not what the person changed since.
   */
  after?: string;
}

/** What restoring a checkpoint would change, as a unified diff and a file list. */
export interface RestorePreview {
  diff: string;
  files: { path: string; change: 'restored' | 'deleted' | 'recreated' }[];
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'JamCLI',
  GIT_AUTHOR_EMAIL: 'checkpoints@jamcli.invalid',
  GIT_COMMITTER_NAME: 'JamCLI',
  GIT_COMMITTER_EMAIL: 'checkpoints@jamcli.invalid',
};

function git(args: string[], cwd: string, env: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0]} failed: ${(stderr || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/** The files a state-changing call names, relative to the project, when it names them. */
export function filesOfCall(call: ToolCall, projectRoot: string): string[] {
  const args = call.arguments ?? {};
  const names: string[] = [];
  if (typeof args.path === 'string') names.push(args.path);
  if (call.name === 'apply_patch' && typeof args.patch === 'string') {
    try {
      for (const entry of parsePatch(args.patch)) {
        for (const name of [entry.oldFileName, entry.newFileName]) {
          const trimmed = name?.split('\t')[0].trim().replace(/^[ab]\//, '');
          if (trimmed && trimmed !== '/dev/null') names.push(trimmed);
        }
      }
    } catch {
      // A patch that does not parse will fail to apply too.
    }
  }
  const inside = names
    .map((name) => path.resolve(projectRoot, name))
    .filter((absolute) => absolute === projectRoot || absolute.startsWith(projectRoot + path.sep))
    .map((absolute) => path.relative(projectRoot, absolute));
  return [...new Set(inside)];
}

export class CheckpointStore {
  private root: Promise<string | undefined> | undefined;
  private backups = 0;

  constructor(
    readonly projectRoot: string,
    readonly sessionId: string
  ) {}

  /** The private ref this session's checkpoints are committed to. */
  get refName(): string {
    return `refs/jamcli/checkpoints/${this.sessionId}`;
  }

  /** The repository's top directory, or nothing outside a repository or without git. */
  repoRoot(): Promise<string | undefined> {
    this.root ??= git(['rev-parse', '--show-toplevel'], this.projectRoot).then(
      (out) => out.trim() || undefined,
      () => undefined
    );
    return this.root;
  }

  /** The working copy as a tree, through a temporary index; the person's index is only read. */
  private async snapshot(repo: string): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-index-'));
    const index = path.join(dir, 'index');
    try {
      const own = path.resolve(repo, (await git(['rev-parse', '--git-path', 'index'], repo)).trim());
      if (fs.existsSync(own)) {
        fs.copyFileSync(own, index);
        // Git re-reads a file changed in the same second as its index entry only when the
        // index itself is no older, so the copy keeps the original's times.
        const { atime, mtime } = fs.statSync(own);
        fs.utimesSync(index, atime, mtime);
      }
      const env = { GIT_INDEX_FILE: index };
      await git(['add', '-A', '--', '.'], repo, env);
      return (await git(['write-tree'], repo, env)).trim();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  private async latest(repo: string): Promise<string | undefined> {
    return git(['rev-parse', '--verify', '-q', this.refName], repo).then(
      (out) => out.trim() || undefined,
      () => undefined
    );
  }

  /** A commit of the working copy on the private ref; the last one again when nothing changed since. */
  private async commit(repo: string, label: string): Promise<string> {
    const tree = await this.snapshot(repo);
    const parent = await this.latest(repo);
    if (parent && (await git(['rev-parse', `${parent}^{tree}`], repo)).trim() === tree) return parent;
    const commit = (await git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', label], repo, IDENTITY)).trim();
    await git(['update-ref', this.refName, commit], repo);
    return commit;
  }

  /**
   * Take a checkpoint before `files` change. In a repository it is the whole working copy;
   * outside one, the files named, and nothing when none is named.
   */
  async take(label: string, files: string[] = []): Promise<Checkpoint | undefined> {
    const repo = await this.repoRoot();
    if (repo) return { ref: await this.commit(repo, label), kind: 'git' };
    if (!files.length) return undefined;
    ensureProjectStateDir(this.projectRoot);
    const base = path.join(this.projectRoot, '.jamcli', 'checkpoints', this.sessionId);
    let dir: string;
    do dir = path.join(base, String((this.backups += 1)));
    while (fs.existsSync(dir));
    const missing: string[] = [];
    for (const rel of files) {
      const source = path.join(this.projectRoot, rel);
      if (!fs.existsSync(source)) {
        missing.push(rel);
        continue;
      }
      const target = path.join(dir, 'files', rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ label, files, missing }, null, 2)}\n`);
    return { ref: dir, kind: 'files', files };
  }

  /**
   * Once the step is done: the working copy as it left it, or nothing when the step changed
   * nothing. Outside a repository the files named already bound what a restore touches.
   */
  async settle(checkpoint: Checkpoint, label: string): Promise<string | undefined> {
    if (checkpoint.kind !== 'git') return undefined;
    const repo = (await this.repoRoot())!;
    const after = await this.commit(repo, `after ${label}`);
    return after === checkpoint.ref ? undefined : after;
  }

  /** The paths, from the repository's top, that a step changed: those a restore may touch. */
  private async scope(repo: string, checkpoint: Checkpoint): Promise<string[] | undefined> {
    if (!checkpoint.after) return undefined;
    const out = await git(['diff', '--name-only', '--no-renames', '-z', checkpoint.ref, checkpoint.after], repo);
    return out.split('\0').filter(Boolean);
  }

  /** What restoring `checkpoint` over the working copy would change. */
  async preview(checkpoint: Checkpoint): Promise<RestorePreview> {
    if (checkpoint.kind === 'git') {
      const repo = (await this.repoRoot())!;
      const paths = await this.scope(repo, checkpoint);
      if (paths && !paths.length) return { diff: '', files: [] };
      const now = await this.snapshot(repo);
      const target = `${checkpoint.ref}^{tree}`;
      const only = paths ? ['--', ...paths] : [];
      const diff = await git(['diff', '--no-color', now, target, ...only], repo);
      const status = await git(['diff', '--name-status', '--no-renames', now, target, ...only], repo);
      const files = status
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [code, name] = line.split('\t');
          const change: RestorePreview['files'][number]['change'] = code === 'D' ? 'deleted' : code === 'A' ? 'recreated' : 'restored';
          return { path: path.relative(this.projectRoot, path.join(repo, name)), change };
        });
      return { diff, files };
    }
    const manifest = this.manifest(checkpoint);
    const files: RestorePreview['files'] = [];
    let diff = '';
    for (const rel of manifest.files) {
      const current = path.join(this.projectRoot, rel);
      const now = fs.existsSync(current) ? fs.readFileSync(current, 'utf8') : undefined;
      const then = manifest.missing.includes(rel) ? undefined : fs.readFileSync(path.join(checkpoint.ref, 'files', rel), 'utf8');
      if (now === then) continue;
      files.push({ path: rel, change: then === undefined ? 'deleted' : now === undefined ? 'recreated' : 'restored' });
      diff += createTwoFilesPatch(`a/${rel}`, `b/${rel}`, now ?? '', then ?? '');
    }
    return { diff, files };
  }

  /** Put the working copy back as `checkpoint` found it, and name the files changed. */
  async restore(checkpoint: Checkpoint): Promise<string[]> {
    const { files } = await this.preview(checkpoint);
    if (checkpoint.kind === 'git') {
      const repo = (await this.repoRoot())!;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-index-'));
      try {
        const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
        await git(['read-tree', `${checkpoint.ref}^{tree}`], repo, env);
        const written = files.filter((file) => file.change !== 'deleted').map((file) => path.relative(repo, path.join(this.projectRoot, file.path)));
        if (written.length) await git(['checkout-index', '-f', '-q', '--', ...written], repo, env);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } else {
      for (const file of files.filter((entry) => entry.change !== 'deleted')) {
        const target = path.join(this.projectRoot, file.path);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(checkpoint.ref, 'files', file.path), target);
      }
    }
    for (const file of files.filter((entry) => entry.change === 'deleted')) fs.rmSync(path.join(this.projectRoot, file.path), { force: true });
    return files.map((file) => file.path);
  }

  private manifest(checkpoint: Checkpoint): { files: string[]; missing: string[] } {
    return JSON.parse(fs.readFileSync(path.join(checkpoint.ref, 'manifest.json'), 'utf8'));
  }
}
