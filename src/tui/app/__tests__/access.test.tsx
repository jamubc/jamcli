import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from './harness.js';
import { loadKeybindings } from '../keys.js';
import { THEMES } from '../theme.js';

const { context, open } = interfaceHarness();
const tall = { width: 110, height: 40 };

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

const BOXES = /[┌┐└┘│─]/;
const MARKS = /[✓✗⊘●○⏱■]/;

test('screen reader mode draws labeled lines, with no boxes and no marks', async () => {
  const { setup, close } = await open({}, { size: tall, screenReader: true });
  try {
    const first = await frameWith(setup, (frame) => frame.includes('Status: default mode, ollama:fake-model'));
    expect(first).toContain('JamCLI, project project');
    expect(first).toContain('Message: Message JamCLI.');
    context.server.enqueue({ text: '**Hello** there.' });
    await send(setup, 'hi');
    const replied = await frameWith(setup, (frame) => frame.includes('JamCLI: **Hello** there.'));
    expect(replied).toContain('You: hi');

    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo hi' } }] });
    await send(setup, 'run it');
    const asked = await frameWith(setup, (frame) => frame.includes('Permission needed: Allow run_command echo hi?'));
    expect(asked).toContain('Tool asking: run_command echo hi');
    setup.mockInput.pressEscape();
    const denied = await frameWith(setup, (frame) => /Tool denied: run_command echo hi, \d+ ms \(denied by you\)/.test(frame));
    expect(denied).toContain('Warning: Stopped because a tool call was denied.');
    await send(setup, '/cost');
    const listed = await frameWith(setup, (frame) => frame.includes('Result: '));
    expect(listed).toContain('Command: /cost');
    for (const frame of [first, replied, asked, denied, listed]) {
      expect(frame).not.toMatch(BOXES);
      expect(frame).not.toMatch(MARKS);
    }
  } finally {
    await close();
  }
}, 30_000);

test('keys follow the keybindings file, and what does not fit in it is named', async () => {
  const file = path.join(process.env.JAMCLI_CONFIG_DIR!, 'keybindings.json');
  fs.writeFileSync(file, JSON.stringify({ cycle_mode: 'ctrl+y', exit: 'ctrl+q', bogus: 'ctrl+b' }));
  let exited = 0;
  const { runtime, setup, close } = await open({}, { size: tall, keys: loadKeybindings(file), onExit: () => void (exited += 1) });
  try {
    await frameWith(setup, (frame) => frame.includes('bogus is not an action'));
    setup.mockInput.pressTab({ shift: true });
    await setup.renderOnce();
    expect(runtime.permissionMode).toBe('default');
    setup.mockInput.pressKey('y', { ctrl: true });
    await frameWith(setup, (frame) => frame.includes('accept-edits mode'));
    setup.mockInput.pressCtrlC();
    await setup.renderOnce();
    expect(exited).toBe(0);
    setup.mockInput.pressKey('q', { ctrl: true });
    await frameWith(setup, (frame) => frame.includes('Press Ctrl+Q again to exit.'));
    setup.mockInput.pressKey('q', { ctrl: true });
    await setup.renderOnce();
    expect(exited).toBe(1);
  } finally {
    await close();
  }
}, 30_000);

test('Ctrl+R searches earlier messages, newest first, and puts the chosen one in the composer', async () => {
  const { setup, current, close } = await open({}, { size: tall });
  try {
    for (const [message, reply] of [
      ['first message', 'One.'],
      ['second message', 'Two.'],
    ]) {
      context.server.enqueue({ text: reply });
      await send(setup, message);
      await frameWith(setup, (frame) => frame.includes(reply) && frame.includes('· ready'));
    }
    setup.mockInput.pressKey('r', { ctrl: true });
    const listed = await frameWith(setup, (frame) => frame.includes('Earlier messages, newest first'));
    const overlay = listed.slice(listed.indexOf('Earlier messages, newest first'));
    expect(overlay).toContain('> second message');
    expect(overlay.indexOf('second message')).toBeLessThan(overlay.indexOf('first message'));
    await setup.mockInput.typeText('first');
    await frameWith(setup, (frame) => frame.includes('> first message'));
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => /│first message +│/.test(frame));

    // A new session still finds what was sent in the last one, and says where.
    const before = current().sessionId;
    for (let index = 0; index < 'first message'.length; index += 1) setup.mockInput.pressBackspace();
    await send(setup, '/clear');
    await frameWith(setup, (frame) => frame.includes('New session.'));
    setup.mockInput.pressKey('r', { ctrl: true });
    const found = await frameWith(setup, (frame) => frame.includes('Earlier messages, newest first') && frame.includes('first message'));
    expect(found).toMatch(new RegExp(`second message\\s+${before}`));
  } finally {
    await close();
  }
}, 30_000);

test('Ctrl+T shows the todo list the model last wrote, and hides it again', async () => {
  const { setup, close } = await open({}, { size: tall });
  try {
    setup.mockInput.pressKey('t', { ctrl: true });
    await frameWith(setup, (frame) => frame.includes('No todo list yet.'));
    const todos = [
      { content: 'Read the parser', status: 'completed' },
      { content: 'Fix the bug', status: 'in_progress', active_form: 'Fixing the bug' },
      { content: 'Add a test', status: 'pending' },
    ];
    context.server.enqueue({ toolCalls: [{ id: 't1', name: 'todo_write', arguments: { todos } }] }, { text: 'Planned.' });
    await send(setup, 'plan it');
    const shown = await frameWith(setup, (frame) => frame.includes('doing: Fixing the bug'));
    expect(shown).toContain('done: Read the parser');
    expect(shown).toContain('to do: Add a test');
    setup.mockInput.pressKey('t', { ctrl: true });
    await frameWith(setup, (frame) => !frame.includes('doing: Fixing the bug'));
  } finally {
    await close();
  }
}, 30_000);

test('a diff has colored lines in a color theme, and none in monochrome', async () => {
  const background = (setup: Setup, text: string) => {
    for (const line of setup.captureSpans().lines) {
      const span = line.spans.find((candidate) => candidate.text.includes(text));
      if (span) return [...span.bg.buffer];
    }
    return undefined;
  };
  for (const theme of [THEMES.dark, THEMES.monochrome]) {
    fs.writeFileSync(path.join(context.root, 'a.txt'), 'one\ntwo\n');
    const { setup, close } = await open({}, { size: tall, theme });
    try {
      context.server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'two', replace_string: 'TWO' } }] });
      await send(setup, 'change it');
      await frameWith(setup, (frame) => frame.includes('Allow edit a.txt?') && frame.includes('TWO'));
      const bg = background(setup, 'TWO')!;
      if (theme.name === 'monochrome') expect(bg[3]).toBe(0);
      else expect(bg.slice(0, 3)).toEqual([0x1a, 0x4d, 0x1a]);
      setup.mockInput.pressEscape();
      await frameWith(setup, (frame) => frame.includes('denied: edit a.txt'));
    } finally {
      await close();
    }
  }
}, 40_000);
