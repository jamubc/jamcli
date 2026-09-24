import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fakeGh } from '../../../testing/fakeGh.js';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();
const tall = { width: 110, height: 44 };
const shared = process.env.PATH;
afterEach(() => {
  process.env.PATH = shared;
});

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

/** The project as a clone of a bare remote, on main, pushed. */
function clone() {
  const remote = path.join(path.dirname(context.root), 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '-q', remote, context.root], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: context.root, encoding: 'utf8' });
  git('config', 'user.name', 'Pat Person');
  git('config', 'user.email', 'pat@example.com');
  git('checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'old\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  git('push', '-q', '-u', 'origin', 'main');
  git('remote', 'set-head', 'origin', 'main');
  return git;
}

test('/pr pushes and opens a pull request through gh, each step asked for, and says what is missing first', async () => {
  const git = clone();
  const gh = fakeGh();
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/pr');
    await frameWith(setup, (frame) => frame.includes('This is main itself; a pull request needs a branch of its own.'));
    git('checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(context.root, 'a.txt'), 'new\n');
    git('commit', '-qam', 'feat(a): say new');

    // With no gh on PATH, it says what to install; JamCLI never asks for a token.
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-bin-'));
    fs.symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), path.join(bare, 'git'));
    process.env.PATH = bare;
    await send(setup, '/pr');
    await frameWith(setup, (frame) => frame.includes('Opening a pull request needs the GitHub CLI (gh).'));

    process.env.PATH = gh.path;
    await send(setup, '/pr');
    const push = await frameWith(setup, (frame) => frame.includes('Push feature to origin?'));
    expect(push).toContain('1 commit not on main; the branch is new on origin');
    expect(git('ls-remote', '--heads', 'origin', 'feature')).toBe('');
    context.server.enqueue({ text: 'Say new\n\nThe file said old.' });
    setup.mockInput.pressEnter();
    const offered = await frameWith(setup, (frame) => frame.includes('Open a pull request from feature into main?') && frame.includes('The file said old.'));
    expect(offered).toContain('Pushed feature to origin.');
    expect(git('ls-remote', '--heads', 'origin', 'feature')).toContain('refs/heads/feature');
    // Nothing has gone to gh but the checks.
    expect(gh.calls().filter((call) => call.startsWith('pr'))).toEqual([]);
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Opened https://github.com/example/repo/pull/7.'));
    expect(gh.calls().at(-1)).toBe('pr create --title Say new --body-file - --base main --head feature');
    expect(gh.body()).toBe('The file said old.');

    // Pushed and up to date: straight to the pull request, with the title given.
    await send(setup, '/pr A better title');
    await frameWith(setup, (frame) => frame.includes('Open it as a draft') && frame.includes('A better title'));
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Opened https://github.com/example/repo/pull/7, as a draft.'));
    expect(gh.calls().at(-1)).toBe('pr create --title A better title --body-file - --base main --head feature --draft');
  } finally {
    gh.remove();
    await close();
  }
}, 40_000);

test('/pr with gh signed out says to sign in', async () => {
  const git = clone();
  git('checkout', '-q', '-b', 'feature');
  const gh = fakeGh({ signedOut: true });
  process.env.PATH = gh.path;
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/pr');
    await frameWith(setup, (frame) => frame.includes('gh is not signed in. Run gh auth login'));
  } finally {
    gh.remove();
    await close();
  }
}, 30_000);
