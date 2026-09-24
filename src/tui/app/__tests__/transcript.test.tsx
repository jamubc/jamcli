import { expect, test } from 'bun:test';
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
