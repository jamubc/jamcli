import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { SessionLog } from '../../../core/transcript/index.js';
import { TRANSCRIPT_ROWS } from '../App.js';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();
/** What a terminal sends for Page Up and Page Down; the mock keys have no names for them. */
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';

/** A session of `count` short messages, alternating the person's and the model's. */
function longSession(count: number): string {
  const log = SessionLog.create(context.root, { surface: 'tui' });
  for (let index = 0; index < count; index += 1) {
    log.append({ type: 'message', message: { role: index % 2 ? 'assistant' : 'user', content: `Message ${index}.`, timestamp: Date.now() } });
  }
  log.updateIndex();
  return log.id;
}

/** The transcript's first line with words on it, under the header, without the scroll bar. */
const topLine = (frame: string) =>
  frame
    .split('\n')
    .slice(1)
    .map((line) => line.replace(/[▀▄█]\s*$/, '').trim())
    .find(Boolean)!;

async function pageUpUntil(setup: Setup, done: (frame: string) => boolean): Promise<string> {
  for (let press = 0; press < 200; press += 1) {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    if (done(frame)) return frame;
    setup.mockInput.pressKey(PAGE_UP);
    await Bun.sleep(5);
  }
  throw new Error('Page Up never got there.');
}

test('a long session draws its latest rows, and Page Up at the top draws the earlier ones where they were', async () => {
  expect(TRANSCRIPT_ROWS).toBe(200);
  const sessionId = longSession(250);
  const { setup, close } = await open({ sessionId });
  try {
    const first = await frameWith(setup, (frame) => frame.includes('Message 249.'));
    expect(first).not.toContain('Message 49.');
    // Up to the top of what is drawn: the note, then the oldest row drawn.
    const top = await pageUpUntil(setup, (frame) => frame.includes('50 earlier rows are not drawn. Page Up at the top draws 50 more.'));
    expect(top).toContain('Message 50.');
    expect(top).not.toContain('Message 49.');
    // Once more draws the rest, and the row that was at the top stays in view.
    setup.mockInput.pressKey(PAGE_UP);
    // The view settles where it was, once the new rows have their heights.
    const revealed = await frameWith(setup, (frame) => !frame.includes('earlier rows') && frame.includes('Message 50.'), 2_000);
    expect(revealed).not.toContain('Message 0.');
    await Bun.sleep(700);
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain('Message 50.');
    const oldest = await pageUpUntil(setup, (frame) => frame.includes('Message 0.'));
    expect(topLine(oldest)).toBe('> Message 0.');
    // Page Down goes back the way it came.
    setup.mockInput.pressKey(PAGE_DOWN);
    await frameWith(setup, (frame) => !frame.includes('Message 0.'));
    // Another session starts at its latest rows, at the bottom, whatever this one had drawn.
    const other = longSession(250);
    await setup.mockInput.typeText(`/resume ${other}`);
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Resumed') && frame.includes('Message 249.'));
    await pageUpUntil(setup, (frame) => frame.includes('51 earlier rows are not drawn.'));
  } finally {
    await close();
  }
}, 30_000);

test('a long session resumed from a short one starts at its latest rows', async () => {
  const sessionId = longSession(250);
  const { setup, close } = await open({});
  try {
    await setup.mockInput.typeText(`/resume ${sessionId}`);
    setup.mockInput.pressEnter();
    // The notice that it resumed is a row too.
    const resumed = await frameWith(setup, (frame) => frame.includes('Resumed') && frame.includes('Message 249.'));
    await pageUpUntil(setup, (frame) => frame.includes('51 earlier rows are not drawn. Page Up at the top draws 51 more.'));
    expect(resumed).toContain('Message 249.');
  } finally {
    await close();
  }
}, 30_000);

test('thinking runs in a window of the size it is given, then leaves one line a click opens', async () => {
  const { setup, close } = await open({}, { thinking: { lines: 2, width: 30 } });
  try {
    const reasoning = 'I should read the file first. Then I should run the tests. Then I should say what changed.';
    context.server.enqueue({ reasoning, text: 'Read, tested, reported.' });
    await setup.mockInput.typeText('do the work');
    setup.mockInput.pressEnter();
    // Compact by default: the reply leaves one line behind, with none of the thinking's words.
    const done = await frameWith(setup, (frame) => frame.includes('Read, tested, reported.'));
    expect(done).toContain('▸ thinking, 1 line');
    expect(done).not.toContain('read the file first');
    // A click on that line opens that row's thinking, and another closes it.
    const rows = done.split('\n');
    const row = rows.findIndex((line) => line.includes('▸ thinking, 1 line'));
    const column = rows[row].indexOf('thinking');
    await setup.mockMouse.click(column, row);
    const shown = await frameWith(setup, (frame) => frame.includes('▾ thinking, 1 line'));
    expect(shown).toContain('read the file first');
    await Bun.sleep(600);
    await setup.mockMouse.click(column, row);
    await frameWith(setup, (frame) => frame.includes('▸ thinking, 1 line') && !frame.includes('read the file first'));
  } finally {
    await close();
  }
}, 20_000);

test('the expanded view shows every block whole, and the compact view puts them back', async () => {
  const { setup, close } = await open();
  try {
    const reasoning = 'I should read the file, then say what is in it.';
    context.server.enqueue({ reasoning, toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.txt' } }] }, { text: 'It has one line.' });
    fs.writeFileSync(path.join(context.root, 'a.txt'), 'the only line\n');
    await setup.mockInput.typeText('read a.txt');
    setup.mockInput.pressEnter();
    const compact = await frameWith(setup, (frame) => frame.includes('It has one line.'));
    expect(compact).toContain('✓ done: read_file a.txt');
    expect(compact).not.toContain('the only line');
    expect(compact).not.toContain('then say what is in it');
    expect(compact).not.toContain('expanded view');
    // One key opens everything at once: the thinking and the tool's output, with no row touched.
    setup.mockInput.pressKey('o', { ctrl: true });
    const wide = await frameWith(setup, (frame) => frame.includes('the only line'));
    expect(wide).toContain('then say what is in it');
    expect(wide).toContain('expanded view');
    // And the same key puts the compact view back.
    setup.mockInput.pressKey('o', { ctrl: true });
    const back = await frameWith(setup, (frame) => !frame.includes('the only line'));
    expect(back).not.toContain('then say what is in it');
    expect(back).toContain('It has one line.');
  } finally {
    await close();
  }
}, 20_000);
