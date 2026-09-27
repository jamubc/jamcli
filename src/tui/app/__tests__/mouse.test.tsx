import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { RGBA } from '@opentui/core';
import { THEMES } from '../theme.js';
import { frameWith, interfaceHarness, type Setup } from './harness.js';

const { context, open } = interfaceHarness();

/** Where some text is on screen: its column and row in the last frame. */
function where(setup: Setup, text: string): { x: number; y: number } {
  const rows = setup.captureCharFrame().split('\n');
  const y = rows.findIndex((row) => row.includes(text));
  if (y < 0) throw new Error(`"${text}" is not on screen:\n${rows.join('\n')}`);
  return { x: rows[y].indexOf(text), y };
}

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

test('dragging across the transcript copies what it selects, and the status line says so', async () => {
  const { setup, copied, close } = await open();
  try {
    context.server.enqueue({ text: 'Alpha beta gamma delta.' });
    await send(setup, 'hello');
    await frameWith(setup, (frame) => frame.includes('Alpha beta gamma delta.'));
    const from = where(setup, 'Alpha');
    await setup.mockMouse.drag(from.x, from.y, from.x + 'Alpha beta gamma'.length - 1, from.y);
    await frameWith(setup, (frame) => /Copied \d+ characters/.test(frame));
    expect(copied).toEqual(['Alpha beta gamma']);
    // A click is not a drag: it copies nothing more. (Straight after a release it would be a
    // double click, which selects the word, so the click waits.)
    await Bun.sleep(600);
    await setup.mockMouse.click(from.x, from.y);
    await setup.renderOnce();
    expect(copied).toEqual(['Alpha beta gamma']);
  } finally {
    await close();
  }
}, 30_000);

test('a selection dragged above the transcript keeps scrolling it, so a long reply is selected whole', async () => {
  const { setup, copied, close } = await open({}, { size: { width: 80, height: 20 } });
  try {
    const lines = Array.from({ length: 60 }, (_, index) => `row ${index + 1}`);
    context.server.enqueue({ text: lines.join('\n\n') });
    await send(setup, 'long');
    await frameWith(setup, (frame) => frame.includes('row 60'));
    const firstShown = Number(/row (\d+)/.exec(setup.captureCharFrame())![1]);
    const start = where(setup, 'row 60');
    await setup.mockMouse.pressDown(start.x + 'row 60'.length, start.y);
    // The header row, above the transcript.
    await setup.mockMouse.moveTo(2, 0);
    for (let tick = 0; tick < 30; tick += 1) {
      await Bun.sleep(40);
      await setup.renderOnce();
    }
    await setup.mockMouse.release(2, 0);
    await frameWith(setup, (frame) => frame.includes('Copied'));
    const earliest = Math.min(...[...copied[0].matchAll(/row (\d+)/g)].map((match) => Number(match[1])));
    expect(earliest).toBeLessThan(firstShown);
    expect(copied[0]).toContain('row 60');
  } finally {
    await close();
  }
}, 30_000);

test('clicking a permission choice answers it, and clicking a tool line opens and closes its output', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo clicked-output' } }] }, { text: 'Done.' });
    await send(setup, 'run it');
    await frameWith(setup, (frame) => frame.includes('1  Allow once'));
    const allow = where(setup, '1  Allow once');
    await setup.mockMouse.click(allow.x + 2, allow.y);
    await frameWith(setup, (frame) => frame.includes('Done.'));
    const line = where(setup, 'run_command echo clicked-output');
    const shownBefore = setup.captureCharFrame().split('\n').filter((row) => row.trim() === 'clicked-output').length;
    await setup.mockMouse.click(line.x + 2, line.y);
    const toggled = await frameWith(setup, (frame) => frame.split('\n').filter((row) => row.trim() === 'clicked-output').length !== shownBefore);
    await Bun.sleep(600);
    await setup.mockMouse.click(where(setup, 'run_command echo clicked-output').x + 2, where(setup, 'run_command echo clicked-output').y);
    await frameWith(setup, (frame) => frame.split('\n').filter((row) => row.trim() === 'clicked-output').length === shownBefore);
    expect(toggled).toBeTruthy();
  } finally {
    await close();
  }
}, 30_000);

test('in a list, the pointer marks a row and a click chooses it; in the palette a click runs the command', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 36 } });
  try {
    await send(setup, '/theme');
    await frameWith(setup, (frame) => frame.includes('dark text on a light background'));
    const light = where(setup, 'dark text on a light background');
    await setup.mockMouse.moveTo(light.x, light.y);
    await frameWith(setup, (frame) => frame.split('\n').some((row) => /> light/.test(row)));
    await setup.mockMouse.click(light.x, light.y);
    await frameWith(setup, (frame) => !frame.includes('Up/Down move'));
    const saved = () => JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8')).ui?.theme;
    for (let wait = 0; wait < 50 && saved() !== 'light'; wait += 1) await Bun.sleep(20);
    expect(saved()).toBe('light');

    await setup.mockInput.typeText('/hel');
    await frameWith(setup, (frame) => frame.includes('/help'));
    const help = where(setup, '/help');
    await setup.mockMouse.click(help.x + 1, help.y);
    await frameWith(setup, (frame) => frame.includes('> /help'));
  } finally {
    await close();
  }
}, 30_000);

test('the wheel scrolls a long list: the highlight moves a row per turn, and the list moves only at its edge', async () => {
  const { setup, close } = await open({}, { size: { width: 100, height: 40 } });
  try {
    await send(setup, '/config');
    const listed = await frameWith(setup, (frame) => /(\d+) of (\d+) ·/.test(frame));
    const total = Number(/\d+ of (\d+) ·/.exec(listed)![1]);
    expect(total).toBeGreaterThan(12);
    const over = where(setup, 'Filter:');
    // Nine turns keep the list where it was; the highlight reaches its last row.
    for (let turn = 0; turn < 9; turn += 1) await setup.mockMouse.scroll(over.x, over.y, 'down');
    await frameWith(setup, (frame) => frame.includes(`10 of ${total} ·`));
    const rows = (frame: string) => frame.split('\n').filter((row) => /^│ ( {2}|> )\S/.test(row));
    const before = rows(setup.captureCharFrame());
    expect(before[before.length - 1]).toContain('> ');
    // The tenth scrolls it by one row, and the highlight stays on the edge.
    await setup.mockMouse.scroll(over.x, over.y, 'down');
    await frameWith(setup, (frame) => frame.includes(`11 of ${total} ·`));
    const after = rows(setup.captureCharFrame());
    expect(after[0]).toBe(before[1]);
    // Up moves the highlight back without moving the list.
    await setup.mockMouse.scroll(over.x, over.y, 'up');
    await frameWith(setup, (frame) => frame.includes(`10 of ${total} ·`));
    expect(rows(setup.captureCharFrame())).toEqual(after.map((row, index) => (index === after.length - 2 ? row.replace('│   ', '│ > ') : row.replace('│ > ', '│   '))));
  } finally {
    await close();
  }
}, 30_000);

/** The colors of the cell at a column and row of the last frame. */
function cellAt(setup: Setup, x: number, y: number): { bg: RGBA; fg: RGBA; attributes: number } {
  let column = 0;
  for (const span of setup.captureSpans().lines[y].spans) {
    if (x < column + span.width) return span;
    column += span.width;
  }
  throw new Error(`No cell at ${x},${y}.`);
}

const sameColor = (color: RGBA, hex: string): boolean => color.equals(RGBA.fromHex(hex));

test('pointing at a permission choice draws it as a bar, so what a click would answer is plain before the click', async () => {
  const { setup, close } = await open();
  try {
    context.server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo pointed' } }] }, { text: 'Done.' });
    await send(setup, 'run it');
    await frameWith(setup, (frame) => frame.includes('1  Allow once'));
    const once = where(setup, '1  Allow once');
    const session = where(setup, '2  Allow this session');
    const chosen = THEMES.dark.chosen as string;
    expect(sameColor(cellAt(setup, once.x + 4, once.y).bg, chosen)).toBe(false);
    await setup.mockMouse.moveTo(once.x + 4, once.y);
    await frameWith(setup, () => sameColor(cellAt(setup, once.x + 4, once.y).bg, chosen));
    // The bar runs the width of the row, not just the words.
    expect(sameColor(cellAt(setup, once.x + 60, once.y).bg, chosen)).toBe(true);
    expect(sameColor(cellAt(setup, session.x + 4, session.y).bg, chosen)).toBe(false);
    await setup.mockMouse.moveTo(session.x + 4, session.y);
    await frameWith(setup, () => sameColor(cellAt(setup, session.x + 4, session.y).bg, chosen));
    expect(sameColor(cellAt(setup, once.x + 4, once.y).bg, chosen)).toBe(false);
    await setup.mockMouse.click(session.x + 4, session.y);
    await frameWith(setup, (frame) => frame.includes('Done.'));
  } finally {
    await close();
  }
}, 30_000);

test("a selection is drawn in the theme's selection colors, and stays on its words when the transcript scrolls", async () => {
  const { setup, copied, close } = await open({}, { size: { width: 80, height: 24 } });
  try {
    context.server.enqueue({ text: Array.from({ length: 60 }, (_, index) => `row ${index + 1}`).join('\n\n') });
    await send(setup, 'long');
    await frameWith(setup, (frame) => frame.includes('row 60'));
    const from = where(setup, 'row 55');
    const selection = (THEMES.dark.selection as { bg: string }).bg;
    expect(sameColor(cellAt(setup, from.x, from.y).bg, selection)).toBe(false);
    await setup.mockMouse.drag(from.x, from.y, from.x + 'row 55'.length - 1, from.y);
    await frameWith(setup, (frame) => frame.includes('Copied'));
    expect(copied).toEqual(['row 55']);
    expect(sameColor(cellAt(setup, from.x, from.y).bg, selection)).toBe(true);
    expect(sameColor(cellAt(setup, from.x + 'row 55'.length, from.y).bg, selection)).toBe(false);
    // The wheel moves the transcript; the highlight moves with its words, as in a document.
    await setup.mockMouse.scroll(from.x, from.y, 'up');
    await setup.mockMouse.scroll(from.x, from.y, 'up');
    const moved = await frameWith(setup, (frame) => where(setup, 'row 55').y !== from.y);
    expect(moved).toContain('row 55');
    const now = where(setup, 'row 55');
    expect(sameColor(cellAt(setup, now.x, now.y).bg, selection)).toBe(true);
    expect(sameColor(cellAt(setup, now.x, from.y).bg, selection)).toBe(false);
    expect(setup.renderer.getSelection()?.getSelectedText()).toBe('row 55');
  } finally {
    await close();
  }
}, 30_000);
