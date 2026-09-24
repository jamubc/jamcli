import { expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();
const tall = { width: 110, height: 50 };
const lines = (count: number, change: (index: number) => string | undefined = () => undefined) =>
  Array.from({ length: count }, (_, index) => change(index + 1) ?? `line ${index + 1}`).join('\n') + '\n';

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

test('/diff shows the changes, and stages or reverts one hunk at a time; a revert can be taken back', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: context.root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });
  const file = path.join(context.root, 'a.txt');
  fs.writeFileSync(file, lines(30));
  git('init', '-q', '-b', 'main');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  fs.writeFileSync(file, lines(30, (index) => (index === 3 ? 'line three' : index === 27 ? 'line twenty-seven' : undefined)));
  fs.writeFileSync(path.join(context.root, 'new.txt'), 'new\n');

  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/diff');
    const shown = await frameWith(setup, (frame) => frame.includes('Changes, by hunk'));
    expect(shown).toContain('Not staged, 2 changes:');
    expect(shown).toContain('+ line three');
    expect(shown).toContain('Untracked: new.txt');
    expect(shown).toMatch(/> a\.txt @@ -1,6 \+1,6 @@\s+not staged · \+1 -1/);
    expect(shown).toMatch(/a\.txt @@ -24,7 \+24,7 @@\s+not staged · \+1 -1/);
    expect(shown).toMatch(/new\.txt\s+untracked/);

    // Stage the first hunk.
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Stage it') && frame.includes('Revert it'));
    setup.mockInput.pressEnter();
    // The list stays open while the change applies, then shows it staged.
    await frameWith(setup, (frame) => frame.includes('Staged a.txt @@ -1,6 +1,6 @@.') && /a\.txt @@ -1,6 \+1,6 @@\s+staged · \+1 -1/.test(frame));
    expect(git('diff', '--cached')).toContain('+line three');
    expect(git('diff', '--cached')).not.toContain('twenty-seven');

    // Revert the other, which is still not staged: the first in the list.
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Revert it'));
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Reverted a.txt @@ -24,7 +24,7 @@.') && frame.includes('new.txt') && !frame.includes('Asking…'));
    const now = fs.readFileSync(file, 'utf8');
    expect(now).toContain('line three');
    expect(now).not.toContain('twenty-seven');
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Changes, by hunk'));

    // The revert is a checkpoint like any change, so /rewind can bring the line back.
    await send(setup, '/rewind');
    await frameWith(setup, (frame) => frame.includes('1. before revert a.txt @@ -24,7 +24,7 @@'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Restore the files'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Restored 1 file to checkpoint 1: a.txt.'));
    expect(fs.readFileSync(file, 'utf8')).toContain('line twenty-seven');

    // A staged hunk can only be unstaged; the working copy keeps it.
    await send(setup, '/diff');
    await frameWith(setup, (frame) => /> a\.txt @@ -24,7 \+24,7 @@\s+not staged/.test(frame));
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    const offered = await frameWith(setup, (frame) => frame.includes('Unstage it'));
    expect(offered).not.toContain('Revert it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Unstaged a.txt @@ -1,6 +1,6 @@.') && !frame.includes('Asking…'));
    expect(git('diff', '--cached')).toBe('');
    expect(fs.readFileSync(file, 'utf8')).toContain('line three');
  } finally {
    await close();
  }
}, 40_000);

test('/diff outside a repository, or with nothing changed, says so', async () => {
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/diff');
    await frameWith(setup, (frame) => frame.includes('This project is not a git repository'));
  } finally {
    await close();
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: context.root });
  const again = await open({}, { size: tall });
  try {
    await send(again.setup, '/diff');
    await frameWith(again.setup, (frame) => frame.includes('No changes: the working copy is as the last commit left it.'));
  } finally {
    await again.close();
  }
}, 30_000);
