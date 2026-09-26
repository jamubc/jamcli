import { expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';
import { openWorktree } from '../../../core/git/worktrees.js';

const { context, open } = interfaceHarness();

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

test('in a worktree session, the header, /diff, and /commit are the worktree\'s', async () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'one\n');
  git(context.root, 'init', '-q', '-b', 'main');
  // /commit below runs through the app's own git path, which does not inherit this
  // helper's env override, so it needs a repo-local identity: a fresh CI runner has
  // none, unlike a developer machine with a global one already set.
  git(context.root, 'config', 'user.name', 'P');
  git(context.root, 'config', 'user.email', 'p@example.com');
  git(context.root, 'add', 'a.txt');
  git(context.root, 'commit', '-q', '-m', 'first');
  const tree = await openWorktree(context.root, 'feature');
  fs.writeFileSync(path.join(tree.dir, 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(context.root, 'main-only.txt'), 'the person\'s\n');

  const { setup, close } = await open({ workTree: tree.dir }, { size: { width: 110, height: 40 } });
  try {
    await frameWith(setup, (frame) => frame.includes('jamcli · project · jamcli/feature · session'));
    await send(setup, '/diff');
    const shown = await frameWith(setup, (frame) => frame.includes('Changes, by hunk'));
    expect(shown).toContain('+ two');
    expect(shown).not.toContain('main-only.txt');
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Changes, by hunk'));

    await send(setup, '/commit feat: two');
    await frameWith(setup, (frame) => frame.includes('Stage everything and commit'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Commit this?') && frame.includes('M a.txt'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /Committed [0-9a-f]{12}: feat: two\./.test(frame));
    expect(git(context.root, 'log', '-1', '--format=%s', 'jamcli/feature').trim()).toBe('feat: two');
    expect(git(context.root, 'log', '-1', '--format=%s', 'main').trim()).toBe('first');
    expect(git(context.root, 'status', '--porcelain')).toBe('?? main-only.txt\n');
  } finally {
    await close();
  }
});
