import { expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();
const tall = { width: 110, height: 44 };

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

function repository() {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: context.root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Pat Person');
  git('config', 'user.email', 'pat@example.com');
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'old\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  return git;
}

test('/commit stages everything when asked, shows the drafted message with the files, and commits on Enter', async () => {
  const git = repository();
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/commit');
    await frameWith(setup, (frame) => frame.includes('Nothing to commit: the working copy is as the last commit left it.'));

    fs.writeFileSync(path.join(context.root, 'a.txt'), 'new\n');
    fs.writeFileSync(path.join(context.root, 'b.txt'), 'added\n');
    await send(setup, '/commit');
    const offered = await frameWith(setup, (frame) => frame.includes('Nothing is staged'));
    expect(offered).toMatch(/Stage everything and commit\s+1 changed file and 1 untracked file/);
    context.server.enqueue({ text: '```\nfix(a): say new, and add b\n\nThe file said old.\n```' });
    setup.mockInput.pressEnter();
    const shown = await frameWith(setup, (frame) => frame.includes('Commit this?') && frame.includes('fix(a): say new, and add b'));
    expect(shown).toContain('M a.txt');
    expect(shown).toContain('A b.txt');
    expect(shown).toContain('2 files changed');
    // Nothing is staged until the commit is chosen.
    expect(git('diff', '--cached')).toBe('');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /Committed [0-9a-f]{12}: fix\(a\): say new, and add b\./.test(frame));
    expect(git('log', '-1', '--format=%an|%B')).toBe('Pat Person|fix(a): say new, and add b\n\nThe file said old.\n\n');
    expect(git('status', '--porcelain')).toBe('');
    // The model was asked once, for the draft.
    expect(context.server.completions().at(-1)?.body.messages[0].content).toContain('conventional commits');
  } finally {
    await close();
  }
}, 30_000);

test('/commit with a message asks nothing of the model, and the message can go back to the composer', async () => {
  const git = repository();
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'new\n');
  git('add', 'a.txt');
  const { setup, close } = await open({}, { size: tall });
  try {
    const before = context.server.completions().length;
    await send(setup, '/commit docs: say new');
    await frameWith(setup, (frame) => frame.includes('Commit this?') && frame.includes('Edit the message'));
    expect(context.server.completions().length).toBe(before);
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /│\/commit docs: say new\s+│/.test(frame));
    expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1');
  } finally {
    await close();
  }
}, 30_000);
