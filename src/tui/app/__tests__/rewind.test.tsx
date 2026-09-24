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

/** The project as a git repository with one committed file. */
function repository(): (name: string) => string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: context.root, env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'old\n');
  git('init', '-q', '-b', 'main');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  return (name) => fs.readFileSync(path.join(context.root, name), 'utf8');
}

/** The model edits a.txt, and the person allows it. */
async function edited(setup: Setup, prompt: string): Promise<void> {
  context.server.enqueue({ toolCalls: [{ id: `e-${prompt}`, name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'Changed it.' });
  await send(setup, prompt);
  await frameWith(setup, (frame) => frame.includes('Allow edit a.txt?'));
  await setup.mockInput.typeText('1');
  await frameWith(setup, (frame) => frame.includes('Changed it.') && frame.includes('· ready'));
}

test('/undo shows what it would change, and restores the files only when asked', async () => {
  const read = repository();
  const { setup, close } = await open({}, { size: tall });
  try {
    await send(setup, '/undo');
    await frameWith(setup, (frame) => frame.includes('This session has no checkpoints yet.'));
    await edited(setup, 'change it');
    expect(read('a.txt')).toBe('new\n');

    await send(setup, '/undo');
    const offered = await frameWith(setup, (frame) => frame.includes('Undo edit a.txt') && frame.includes('Restore the files'));
    expect(offered).toContain('Checkpoint 1, taken before edit a.txt. Restoring it changes: a.txt restored.');
    expect(offered).toMatch(/-\s*new/);
    expect(offered).not.toContain('conversation');
    // Escape leaves everything as it is.
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => !frame.includes('Restore the files'));
    expect(read('a.txt')).toBe('new\n');

    await send(setup, '/undo');
    await frameWith(setup, (frame) => frame.includes('Restore the files'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Restored 1 file to checkpoint 1: a.txt.'));
    expect(read('a.txt')).toBe('old\n');
    // Again, /undo looks at the model's change, which is undone; redoing is /rewind's.
    await send(setup, '/undo');
    await frameWith(setup, (frame) => frame.includes('Checkpoint 1, taken before edit a.txt. The files are as it left them.') && frame.includes('Nothing to restore'));
    expect(read('a.txt')).toBe('old\n');
  } finally {
    await close();
  }
}, 30_000);

test('/rewind lists the checkpoints, and can put the conversation back to before the turn, with its message in the composer', async () => {
  const read = repository();
  const { setup, current, close } = await open({}, { size: tall });
  try {
    await edited(setup, 'change it');
    const before = current().sessionId;
    await send(setup, '/rewind');
    const listed = await frameWith(setup, (frame) => frame.includes('Checkpoints, latest first'));
    expect(listed).toMatch(/> 1\. before edit a\.txt\s+\d\d:\d\d:\d\d · "change it"/);
    setup.mockInput.pressEnter();
    const offered = await frameWith(setup, (frame) => frame.includes('Rewind to checkpoint 1'));
    for (const choice of ['Restore the files', 'Restore the files and the conversation', 'Restore the conversation only']) expect(offered).toContain(choice);
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressArrow('down');
    setup.mockInput.pressEnter();
    const rewound = await frameWith(setup, (frame) => frame.includes('The conversation is back to before "change it"'));
    // A new session, without the turn, whose message waits in the composer; the files stay.
    expect(current().sessionId).not.toBe(before);
    expect(rewound).not.toContain('Changed it.');
    expect(rewound).toMatch(/│change it\s+│/);
    expect(read('a.txt')).toBe('new\n');
    expect(current().session.messages.map((message) => message.content)).not.toContain('change it');
  } finally {
    await close();
  }
}, 30_000);
