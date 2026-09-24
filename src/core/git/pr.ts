import { execFile } from 'child_process';

/**
 * Pushing a branch and opening a pull request through the GitHub CLI (D15). Each is its
 * own step for the person to approve. Git pushes with the person's own credentials and
 * `gh` opens the pull request with its own sign-in; JamCLI never sees a GitHub token.
 */

export interface BranchState {
  /** The repository's top directory. */
  root: string;
  branch: string;
  /** The branch pull requests go to, such as `main`. */
  base: string;
  remote?: string;
  /** The branch's upstream, such as `origin/feature`, once it has been pushed. */
  upstream?: string;
  /** Commits not on the upstream yet, or not on the base when there is no upstream. */
  ahead: number;
}

export type GhState = 'ready' | 'missing' | 'signed-out';

function run(file: string, args: string[], cwd: string, options: { input?: string; env?: Record<string, string | undefined> } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile(file, args, { cwd, env: (options.env ?? process.env) as NodeJS.ProcessEnv, maxBuffer: 16 * 1024 * 1024 }, (error: any, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 127) : 0, stdout: String(stdout), stderr: String(stderr || (error?.code === 'ENOENT' ? 'not found' : '')) });
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

async function git(args: string[], cwd: string): Promise<string | undefined> {
  const result = await run('git', args, cwd);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/** Where the current branch stands against its remote and base. */
export async function branchState(projectRoot: string): Promise<BranchState> {
  const root = await git(['rev-parse', '--show-toplevel'], projectRoot);
  if (!root) throw new Error('This project is not a git repository.');
  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  if (!branch) throw new Error('HEAD is not on a branch, so there is nothing to push.');
  const remotes = (await git(['remote'], root))?.split('\n').filter(Boolean) ?? [];
  const remote = remotes.includes('origin') ? 'origin' : remotes[0];
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root);
  const remoteHead = remote ? await git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], root) : undefined;
  const base = remoteHead?.slice(remote!.length + 1) || ((await git(['rev-parse', '--verify', '--quiet', 'main'], root)) ? 'main' : 'master');
  const against = upstream ?? (remote && (await git(['rev-parse', '--verify', '--quiet', `${remote}/${base}`], root)) ? `${remote}/${base}` : base);
  const ahead = Number((await git(['rev-list', '--count', `${against}..HEAD`], root)) ?? '0');
  return { root, branch, base, ...(remote ? { remote } : {}), ...(upstream ? { upstream } : {}), ahead };
}

/** Whether `gh` is installed and signed in. */
export async function ghState(cwd: string, env: Record<string, string | undefined> = process.env): Promise<GhState> {
  if ((await run('gh', ['--version'], cwd, { env })).code !== 0) return 'missing';
  return (await run('gh', ['auth', 'status'], cwd, { env })).code === 0 ? 'ready' : 'signed-out';
}

/** Push the branch and set its upstream, with the person's own git credentials. */
export async function pushBranch(state: BranchState): Promise<string> {
  if (!state.remote) throw new Error('This repository has no remote to push to.');
  const result = await run('git', ['push', '-u', state.remote, state.branch], state.root);
  if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim());
  return `${result.stdout}${result.stderr}`.trim();
}

/** Open a pull request with `gh`, and return its address. */
export async function openPullRequest(
  state: BranchState,
  request: { title: string; body: string; draft?: boolean },
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  if (!request.title.trim()) throw new Error('The pull request needs a title.');
  const args = ['pr', 'create', '--title', request.title.trim(), '--body-file', '-', '--base', state.base, '--head', state.branch, ...(request.draft ? ['--draft'] : [])];
  const result = await run('gh', args, state.root, { input: request.body, env });
  if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim());
  return result.stdout.trim().split('\n').at(-1) ?? '';
}

/** What the model is asked for a pull request: the branch's commits and its diffstat. */
export async function pullRequestPrompt(state: BranchState, limit = 12_000): Promise<string> {
  const against = state.remote ? `${state.remote}/${state.base}` : state.base;
  const range = (await git(['rev-parse', '--verify', '--quiet', against], state.root)) ? `${against}..HEAD` : `${state.base}..HEAD`;
  const log = (await git(['log', '--format=%s%n%n%b', range], state.root)) ?? '';
  const stat = (await git(['diff', '--stat', range.replace('..', '...')], state.root)) ?? '';
  const text = log.length > limit ? `${log.slice(0, limit)}\n[the rest is left out]` : log;
  return [
    `Write a pull request for the branch ${state.branch} into ${state.base}.`,
    'The first line is the title: short, plain, and specific. Then a blank line and a body in',
    'Markdown that says what changed and why, and how it was tested when the commits say.',
    'Reply with the pull request alone: no quotes, no code fence.',
    '',
    'Commits:',
    text,
    '',
    stat,
  ].join('\n');
}

/** A drafted pull request, split into its title and its body. */
export function splitPullRequest(text: string): { title: string; body: string } {
  const cleaned = text
    .trim()
    .replace(/^```[a-z]*\n([\s\S]*?)\n```$/, '$1')
    .trim();
  const [title, ...rest] = cleaned.split('\n');
  return { title: title.replace(/^#+\s*/, '').replace(/^"(.*)"$/, '$1').trim(), body: rest.join('\n').trim() };
}
