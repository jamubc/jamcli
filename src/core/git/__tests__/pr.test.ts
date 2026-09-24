import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fakeGh } from '../../../testing/fakeGh.js';
import { branchState, ghState, openPullRequest, pullRequestPrompt, pushBranch, splitPullRequest } from '../pr.js';

let base: string;
let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-pr-')));
  const remote = path.join(base, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  dir = path.join(base, 'work');
  execFileSync('git', ['clone', '-q', remote, dir], { stdio: 'ignore' });
  git('config', 'user.name', 'Pat Person');
  git('config', 'user.email', 'pat@example.com');
  git('checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'old\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  git('push', '-q', '-u', 'origin', 'main');
  git('remote', 'set-head', 'origin', 'main');
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

test('a branch not pushed yet counts its commits against the base, and pushing sets its upstream', async () => {
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'new\n');
  git('commit', '-qam', 'feat(a): say new');
  let state = await branchState(dir);
  expect(state).toMatchObject({ root: dir, branch: 'feature', base: 'main', remote: 'origin', ahead: 1 });
  expect(state.upstream).toBeUndefined();
  await pushBranch(state);
  state = await branchState(dir);
  expect(state).toMatchObject({ upstream: 'origin/feature', ahead: 0 });
  expect(git('ls-remote', '--heads', 'origin', 'feature')).toContain('refs/heads/feature');
});

test('gh is found, signed in or not, or missing; a pull request goes to it with its body on stdin', async () => {
  const gh = fakeGh();
  const out = fakeGh({ signedOut: true });
  try {
    expect(await ghState(dir, { ...process.env, PATH: gh.path })).toBe('ready');
    expect(await ghState(dir, { ...process.env, PATH: out.path })).toBe('signed-out');
    expect(await ghState(dir, { ...process.env, PATH: path.join(base, 'nothing-here') })).toBe('missing');
    git('checkout', '-q', '-b', 'feature');
    const url = await openPullRequest(await branchState(dir), { title: 'Say new', body: 'Because.\n', draft: true }, { ...process.env, PATH: gh.path });
    expect(url).toBe('https://github.com/example/repo/pull/7');
    expect(gh.calls().at(-1)).toBe('pr create --title Say new --body-file - --base main --head feature --draft');
    expect(gh.body()).toBe('Because.\n');
  } finally {
    gh.remove();
    out.remove();
  }
});

test('the request for a draft names the commits, and a reply splits into a title and a body', async () => {
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'new\n');
  git('commit', '-qam', 'feat(a): say new');
  const prompt = await pullRequestPrompt(await branchState(dir));
  expect(prompt).toContain('into main');
  expect(prompt).toContain('feat(a): say new');
  expect(prompt).toContain('a.txt');
  expect(splitPullRequest('# Say new\n\nThe file said old.\n')).toEqual({ title: 'Say new', body: 'The file said old.' });
  expect(splitPullRequest('```\nSay new\n\nBody\n```')).toEqual({ title: 'Say new', body: 'Body' });
});

test('outside a repository, or on no branch, it says so', async () => {
  await expect(branchState(base)).rejects.toThrow('This project is not a git repository.');
  git('checkout', '-q', '--detach');
  await expect(branchState(dir)).rejects.toThrow('HEAD is not on a branch');
});
