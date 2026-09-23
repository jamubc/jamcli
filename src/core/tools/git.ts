import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../types/tools.js';
import { resolveProjectPath } from './paths.js';

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
];
