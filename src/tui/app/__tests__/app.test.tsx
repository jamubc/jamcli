/** @jsxImportSource @opentui/react */
import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness } from './harness.js';

const { context, open } = interfaceHarness();

test('a message typed and sent runs a turn, and the reply and status line are shown', async () => {
  const { runtime, setup, close } = await open();
  try {
    const first = await frameWith(setup, (frame) => frame.includes('default mode'));
    expect(first).toContain('ollama:fake-model');
    expect(first).toContain(`session ${runtime.sessionId}`);
    expect(first).toContain('no sandbox');
    expect(first).toContain('ready');

    context.server.enqueue({ text: 'Hello from the model.', usage: { prompt: 120, completion: 8 } });
    await setup.mockInput.typeText('hi there');
    setup.mockInput.pressEnter();
    const frame = await frameWith(setup, (value) => value.includes('Hello from the model.'));
    expect(frame).toContain('> hi there');
    await frameWith(setup, (value) => value.includes('120 in, 8 out'));
    // After the turn the status line reads the runtime again: the context has grown.
    const usage = runtime.contextUsage();
    await frameWith(setup, (value) => value.includes(`context ${Math.round((usage.used / usage.budget) * 100)}%`));
    expect(context.server.completions().at(-1)!.body.messages.at(-1).content).toBe('hi there');
  } finally {
    await close();
  }
}, 20_000);

test('a call that asks shows the permission prompt, and Escape denies it', async () => {
  const { runtime, setup, close } = await open();
  try {
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo hello' } }] });
    await setup.mockInput.typeText('say hello');
    setup.mockInput.pressEnter();
    const prompt = await frameWith(setup, (value) => value.includes('Allow run_command echo hello?'));
    expect(prompt).toContain('1 allow once');
    expect(prompt).toContain('Asked because default mode asks before tools that run commands.');
    setup.mockInput.pressEscape();
    // A person's no, without feedback, ends the turn, and the interface says so.
    const after = await frameWith(setup, (value) => value.includes('Stopped because a tool call was denied.'));
    expect(after).toContain('denied: run_command echo hello');
    expect(after).toContain('(denied by you)');
    expect(after).not.toContain('Allow run_command');
  } finally {
    await close();
  }
}, 20_000);

test('1 allows a call once; Shift+Tab changes the mode; Ctrl+C twice asks to leave', async () => {
  let exited = 0;
  const { runtime, setup, close } = await open({}, () => void (exited += 1));
  try {
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo allowed-output' } }] }, { text: 'It printed.' });
    await setup.mockInput.typeText('run it');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('Allow run_command'));
    setup.mockInput.pressKey('1');
    const after = await frameWith(setup, (value) => value.includes('It printed.'));
    expect(after).toMatch(/done: run_command echo allowed-output, \d+ ms \(allowed by you\)/);

    setup.mockInput.pressTab({ shift: true });
    expect(await frameWith(setup, (value) => value.includes('accept-edits mode'))).toContain('accept-edits mode');
    expect(runtime.permissionMode).toBe('accept-edits');

    setup.mockInput.pressCtrlC();
    await frameWith(setup, (value) => value.includes('Press Ctrl+C again to exit.'));
    expect(exited).toBe(0);
    setup.mockInput.pressCtrlC();
    await setup.renderOnce();
    expect(exited).toBe(1);
  } finally {
    await close();
  }
}, 20_000);

test('replies render as Markdown, and an edit shows its diff in the prompt and in its block', async () => {
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'one\ntwo\nthree\n');
  const { runtime, setup, close } = await open();
  try {
    context.server.enqueue({ text: '**Bold words** and a list:\n\n- first item\n- second item\n\n```ts\nconst answer = 42\n```' });
    await setup.mockInput.typeText('format something');
    setup.mockInput.pressEnter();
    const reply = await frameWith(setup, (value) => value.includes('const answer = 42') && value.includes('second item'));
    // The Markdown markers are hidden; the words stay.
    expect(reply).toContain('Bold words');
    expect(reply).not.toContain('**Bold words**');

    context.server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'two', replace_string: 'TWO' } }] }, { text: 'Changed it.' });
    await setup.mockInput.typeText('change two');
    setup.mockInput.pressEnter();
    const prompt = await frameWith(setup, (value) => value.includes('Allow edit a.txt?'));
    expect(prompt).toMatch(/-\s*two/);
    expect(prompt).toMatch(/\+\s*TWO/);
    setup.mockInput.pressKey('1');
    const after = await frameWith(setup, (value) => value.includes('Changed it.'));
    expect(after).toContain('done: edit a.txt, 1 line added and 1 removed');
    expect(after).toMatch(/\+\s*TWO/);
    expect(fs.readFileSync(path.join(context.root, 'a.txt'), 'utf8')).toBe('one\nTWO\nthree\n');
  } finally {
    await close();
  }
}, 20_000);

test('Escape stops a running turn, and the interface says it stopped', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue({ text: 'Too late.', delayMs: 3_000 });
    await setup.mockInput.typeText('take your time');
    setup.mockInput.pressEnter();
    await frameWith(setup, (value) => value.includes('· thinking'));
    setup.mockInput.pressEscape();
    const after = await frameWith(setup, (value) => value.includes('Stopped.'));
    expect(after).toContain('· ready');
    expect(after).not.toContain('Too late.');
  } finally {
    await close();
  }
}, 20_000);
