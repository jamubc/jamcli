import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveProjectPath } from './paths.js';
import { commitChanges } from '../git/commit.js';
import { loadConfig } from '../config/load.js';

const execFileAsync = promisify(execFile);

/**
 * Run a read-only git subcommand in the project root. Arguments are passed to
 * git as an argv array, so no shell is involved and nothing the model supplies
 * is interpreted as a command.
 */
async function runGit(gitArgs: string[], cwd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', gitArgs, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return (stdout || stderr || '').trimEnd();
  } catch (error: any) {
    const detail = String(error?.stderr || error?.message || error).trim();
    throw new Error(`git ${gitArgs[0]} failed: ${detail}`);
  }
}

/** Report the working tree status. */
export async function gitStatusRunner(_args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const output = await runGit(['status', '--short', '--branch'], ctx.projectRoot);
  return {
    output: output || 'Working tree clean.',
    metadata: { command: 'git status --short --branch' },
  };
}

/** Show the unstaged or staged diff, optionally limited to one path. */
export async function gitDiffRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const gitArgs = ['diff'];
  if (args.staged) gitArgs.push('--cached');
  if (typeof args.path === 'string' && args.path.length) {
    const absolute = resolveProjectPath(ctx.projectRoot, args.path);
    gitArgs.push('--', path.relative(ctx.projectRoot, absolute) || args.path);
  }
  const output = await runGit(gitArgs, ctx.projectRoot);
  return {
    output: output || 'No changes.',
    metadata: { command: `git ${gitArgs.join(' ')}` },
  };
}

/** Show recent commits, optionally for one path. */
export async function gitLogRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  const count = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 20, 1), 200);
  const gitArgs = ['log', '--no-color', `--max-count=${count}`, '--date=short', '--format=%h %ad %an %s'];
  if (typeof args.path === 'string' && args.path.length) {
    const absolute = resolveProjectPath(ctx.projectRoot, args.path);
    gitArgs.push('--', path.relative(ctx.projectRoot, absolute) || args.path);
  }
  const output = await runGit(gitArgs, ctx.projectRoot);
  return {
    output: output || 'No commits.',
    metadata: { command: `git ${gitArgs.join(' ')}` },
  };
}

const gitStatusSchema: JsonSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};

const gitDiffSchema: JsonSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Limit the diff to this path under the project root.' },
    staged: { type: 'boolean', description: 'Show the staged diff (git diff --cached).' },
  },
  required: [],
  additionalProperties: false,
};

const gitLogSchema: JsonSchema = {
  type: 'object',
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Number of commits to show. Defaults to 20.' },
    path: { type: 'string', description: 'Limit the log to commits touching this path.' },
  },
  required: [],
  additionalProperties: false,
};

export const GIT_TOOLS: RegisteredTool[] = [
  {
    name: 'git_status',
    description: 'Show the read-only working tree status for the project root.',
    inputSchema: gitStatusSchema,
    policy: 'read',
    runner: gitStatusRunner,
  },
  {
    name: 'git_diff',
    description: 'Show the read-only diff for the project root, optionally staged or limited to a path.',
    inputSchema: gitDiffSchema,
    policy: 'read',
    runner: gitDiffRunner,
  },
  {
    name: 'git_log',
    description: 'Show recent commits (hash, date, author, subject), optionally for one path.',
    inputSchema: gitLogSchema,
    policy: 'read',
    runner: gitLogRunner,
  },
];

/**
 * Commit what is staged, with `paths` staged first. The call always asks, showing the
 * message, the files, and the diffstat, and runs `git commit` so the repository's hooks
 * run. The commit carries the person's git identity, and a trailer only when
 * `git.attribution` names one.
 */
export async function gitCommitRunner(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
  if (typeof args.message !== 'string' || !args.message.trim()) throw new Error('git_commit needs a "message".');
  const paths = Array.isArray(args.paths) ? args.paths.filter((entry: unknown): entry is string => typeof entry === 'string') : [];
  for (const entry of paths) resolveProjectPath(ctx.projectRoot, entry, { additionalRoots: ctx.additionalRoots });
  const attribution = loadConfig({ projectRoot: ctx.projectRoot }).config.git?.attribution;
  const committed = await commitChanges(ctx.projectRoot, args.message, { paths, attribution });
  return {
    output: `Committed ${committed.sha.slice(0, 12)}: ${committed.subject}${committed.output ? `\n${committed.output}` : ''}`,
    metadata: { sha: committed.sha },
  };
}

const gitCommitSchema: JsonSchema = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'The commit message: a conventional-commits subject, then a blank line and a body that says why.' },
    paths: { type: 'array', items: { type: 'string' }, description: 'Files to stage before committing. Omit to commit what is already staged.' },
  },
  required: ['message'],
  additionalProperties: false,
};

export const GIT_COMMIT_TOOL: RegisteredTool = {
  name: 'git_commit',
  description: 'Commit staged changes, staging the paths given first. The person approves every commit, seeing the message, the files, and the diffstat.',
  inputSchema: gitCommitSchema,
  policy: 'execute',
  alwaysAsks: true,
  runner: gitCommitRunner,
};
