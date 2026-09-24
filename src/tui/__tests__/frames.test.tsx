import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { frameWith, interfaceHarness, type Setup } from '../app/__tests__/harness.js';
import { THEMES } from '../app/theme.js';

/**
 * Frame text of the interface's key states, compared with what was recorded. What
 * changes from run to run (the session's id, times, the context share, the spinner's
 * frame) is replaced with a stand-in first. A change here is a change a person sees:
 * update the snapshot only when it is meant.
 */
const { context, open } = interfaceHarness();
const size = { width: 80, height: 24 };

const normalize = (frame: string): string =>
  frame
    .replace(/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}/g, '<session>')
    .replace(/context \d+%/g, 'context N%')
    .replace(/\d+ ms/g, 'N ms')
    .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '⠋')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

test('the empty session', async () => {
  const { setup, close } = await open({}, { size });
  try {
    expect(normalize(await frameWith(setup, (frame) => frame.includes('· ready')))).toMatchSnapshot();
  } finally {
    await close();
  }
});

test('a reply part-way through streaming', async () => {
  const { setup, close } = await open({}, { size });
  try {
    context.server.enqueue({ text: 'Here is the first part, and then the rest arrives.', chunkSize: 8, pauseAfterEvents: { events: 3, ms: 1_500 } });
    await send(setup, 'tell me');
    const partway = await frameWith(setup, (frame) => frame.includes('the firs'));
    expect(partway).not.toContain('arrives');
    expect(normalize(partway)).toMatchSnapshot();
    await frameWith(setup, (frame) => frame.includes('arrives.') && frame.includes('· ready'));
  } finally {
    await close();
  }
}, 20_000);

test('a finished tool block and the reply after it', async () => {
  fs.writeFileSync(path.join(context.root, 'notes.txt'), 'alpha\nbeta\n');
  const { setup, close } = await open({}, { size });
  try {
    context.server.enqueue({ toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'notes.txt' } }] }, { text: 'It lists alpha and beta.' });
    await send(setup, 'read the notes');
    expect(normalize(await frameWith(setup, (frame) => frame.includes('It lists alpha and beta.') && frame.includes('· ready')))).toMatchSnapshot();
  } finally {
    await close();
  }
}, 20_000);

test('the permission prompt for a command', async () => {
  const { setup, close } = await open({}, { size });
  try {
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'npm test' } }] });
    await send(setup, 'run the tests');
    expect(normalize(await frameWith(setup, (frame) => frame.includes('Allow run_command npm test?')))).toMatchSnapshot();
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => frame.includes('denied'));
  } finally {
    await close();
  }
}, 20_000);

/** An edit waiting for its answer, which shows the diff it would make. */
async function editPrompt(setup: Setup): Promise<string> {
  context.server.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'two', replace_string: 'TWO' } }] });
  await send(setup, 'change it');
  return frameWith(setup, (frame) => frame.includes('Allow edit a.txt?') && frame.includes('TWO'));
}

test('a diff, in the prompt for an edit', async () => {
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'one\ntwo\nthree\n');
  const { setup, close } = await open({}, { size: { width: 80, height: 30 } });
  try {
    expect(normalize(await editPrompt(setup))).toMatchSnapshot();
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => frame.includes('denied'));
  } finally {
    await close();
  }
}, 20_000);

test('screen reader mode, through a reply, a tool, and a prompt', async () => {
  fs.writeFileSync(path.join(context.root, 'notes.txt'), 'alpha\n');
  const { setup, close } = await open({}, { size: { width: 80, height: 30 }, screenReader: true });
  try {
    context.server.enqueue({ toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'notes.txt' } }] }, { text: 'It says alpha.' });
    await send(setup, 'read the notes');
    await frameWith(setup, (frame) => frame.includes('JamCLI: It says alpha.') && frame.includes(', ready'));
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'ls' } }] });
    await send(setup, 'list');
    expect(normalize(await frameWith(setup, (frame) => frame.includes('Permission needed: Allow run_command ls?')))).toMatchSnapshot();
    setup.mockInput.pressEscape();
    await frameWith(setup, (frame) => frame.includes('denied'));
  } finally {
    await close();
  }
}, 20_000);

test('NO_COLOR: the same frame, every character in the terminal\'s own colors', async () => {
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'one\ntwo\nthree\n');
  const { setup, close } = await open({}, { size: { width: 80, height: 30 }, theme: THEMES.monochrome });
  try {
    const colors = new Set<string>();
    const collect = () => {
      for (const line of setup.captureSpans().lines) {
        for (const span of line.spans) if (span.text.trim()) colors.add(`${[...span.fg.buffer]} on ${[...span.bg.buffer]}`);
      }
    };
    // The composer's frame first, then the prompt that takes its place.
    await frameWith(setup, (value) => value.includes('· ready'));
    collect();
    const frame = await editPrompt(setup);
    collect();
    expect(colors.size).toBe(1);
    expect({ frame: normalize(frame), colors: [...colors] }).toMatchSnapshot();
    setup.mockInput.pressEscape();
    await frameWith(setup, (value) => value.includes('denied'));
  } finally {
    await close();
  }
}, 20_000);

test('an overlay: the list, the one chosen, and how to move', async () => {
  const { setup, close } = await open({}, { size });
  try {
    await send(setup, '/theme');
    expect(normalize(await frameWith(setup, (frame) => frame.includes('> dark (in use)')))).toMatchSnapshot();
    setup.mockInput.pressEscape();
  } finally {
    await close();
  }
});

test('no theme draws text in plain white, which a light terminal would hide', async () => {
  fs.writeFileSync(path.join(context.root, 'a.txt'), 'one\ntwo\nthree\n');
  const white = (setup: Setup) =>
    setup
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.text.trim() && [...span.fg.buffer].join() === '255,255,255,255')
      .map((span) => span.text.trim());
  for (const theme of [THEMES.light, THEMES.dark]) {
    const { setup, close } = await open({}, { size: { width: 80, height: 30 }, theme });
    try {
      await send(setup, '/theme');
      await frameWith(setup, (frame) => frame.includes('(in use)'));
      expect(white(setup)).toEqual([]);
      setup.mockInput.pressEscape();
      await frameWith(setup, (frame) => !frame.includes('(in use)'));
      await editPrompt(setup);
      expect(white(setup)).toEqual([]);
      setup.mockInput.pressEscape();
      await frameWith(setup, (value) => value.includes('denied'));
    } finally {
      await close();
    }
  }
}, 30_000);
