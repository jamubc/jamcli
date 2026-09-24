import { execFile, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The one commit path the model's `git_commit` and the person's `/commit` share (D15):
 * what is staged, with any paths chosen staged first, committed through `git commit` so
 * the repository's hooks run. The person's identity is git's own; JamCLI adds a trailer
 * only when `git.attribution` names one.
 */

export interface CommitPlan {
  /** The repository's top directory. */
  root: string;
  /** What the commit would hold, as `git diff --cached --name-status` lines. */
  files: { status: string; path: string }[];
  /** `git diff --cached --stat`. */
  stat: string;
  /** The staged diff. */
  diff: string;
}

function gitSync(args: string[], cwd: string, env: Record<string, string> = {}): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error((result.stderr || result.error?.message || `git ${args[0]} failed`).trim());
  return result.stdout;
}

/**
 * What committing now would include: what is staged, and `paths` as if staged first. It
 * is worked out in a temporary index, so nothing is staged before the commit is approved.
 */
export function planCommit(projectRoot: string, paths: string[] = []): CommitPlan {
  const root = gitSync(['rev-parse', '--show-toplevel'], projectRoot).trim();
  const own = path.resolve(root, gitSync(['rev-parse', '--git-path', 'index'], root).trim());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-commit-'));
  const index = path.join(dir, 'index');
  try {
    if (fs.existsSync(own)) {
      fs.copyFileSync(own, index);
      const { atime, mtime } = fs.statSync(own);
      fs.utimesSync(index, atime, mtime);
    }
    const env = { GIT_INDEX_FILE: index };
    if (paths.length) gitSync(['add', '--', ...paths.map((file) => path.resolve(projectRoot, file))], root, env);
    const status = gitSync(['diff', '--cached', '--name-status', '--no-renames'], root, env);
    return {
      root,
      files: status
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [code, name] = line.split('\t');
          return { status: code, path: name };
        }),
      stat: gitSync(['diff', '--cached', '--stat'], root, env).trimEnd(),
      diff: gitSync(['diff', '--cached', '--no-color'], root, env),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The message with the attribution trailer, when one is configured and not already there. */
export function withAttribution(message: string, attribution: string | undefined): string {
  const body = message.trimEnd();
  if (!attribution?.trim() || body.includes(attribution.trim())) return `${body}\n`;
  return `${body}\n\n${attribution.trim()}\n`;
}

/** Why a message cannot be committed as it is, or nothing when it can. */
export function messageProblem(message: string): string | undefined {
  const subject = message.trim().split('\n')[0] ?? '';
  if (!subject.trim()) return 'The commit message is empty.';
  return undefined;
}

export interface Committed {
  sha: string;
  subject: string;
  /** What git and the repository's hooks printed. */
  output: string;
}

/** Stage `paths`, then commit what is staged with `message`, hooks and all. */
export function commitChanges(projectRoot: string, message: string, options: { paths?: string[]; attribution?: string } = {}): Promise<Committed> {
  const problem = messageProblem(message);
  if (problem) return Promise.reject(new Error(problem));
  const root = gitSync(['rev-parse', '--show-toplevel'], projectRoot).trim();
  if (options.paths?.length) gitSync(['add', '--', ...options.paths.map((file) => path.resolve(projectRoot, file))], root);
  if (!gitSync(['diff', '--cached', '--name-only'], root).trim()) return Promise.reject(new Error('Nothing is staged, so there is nothing to commit.'));
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['commit', '-F', '-'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim();
      if (error) return reject(new Error(output || error.message));
      const sha = gitSync(['rev-parse', 'HEAD'], root).trim();
      resolve({ sha, subject: gitSync(['log', '-1', '--format=%s'], root).trim(), output });
    });
    child.stdin?.end(withAttribution(message, options.attribution));
  });
}

/** The request for a drafted message: the staged diff, cut to fit, and the conventions. */
export function draftPrompt(plan: CommitPlan, limit = 12_000): string {
  const diff = plan.diff.length > limit ? `${plan.diff.slice(0, limit)}\n[the rest of the diff is left out]` : plan.diff;
  return [
    'Write a commit message for the staged changes below, in the conventional commits style:',
    'a subject of the form "type(scope): summary", lowercase and imperative, at most 72 characters,',
    'then a blank line and a short body that says why, wrapped at 72 characters.',
    'Reply with the message alone: no quotes, no code fence, no trailers.',
    '',
    plan.stat,
    '',
    diff,
  ].join('\n');
}

/** A drafted message as the model returned it, with any fence or quotes around it taken off. */
export function cleanDraft(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\n([\s\S]*?)\n```$/, '$1')
    .replace(/^"([\s\S]*)"$/, '$1')
    .trim();
}
