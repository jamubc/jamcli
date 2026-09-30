import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { buildStatusStyle, BUILTIN_TEXT_STYLES } from '../../../styles/statusStyles.js';
import { frameWith, interfaceHarness, type Setup } from './harness.js';
import { THEMES } from '../theme.js';

const { context, open } = interfaceHarness();
const arrows = buildStatusStyle(
  { id: 'custom:red', label: 'Red', shimmerColors: ['#ff0000'], shimmer: false, source: 'custom' },
  { id: 'custom:arrows', label: 'Arrows', spinnerFrames: ['<', '>'], spinnerColors: ['#00ff00'], intervalMs: 40, source: 'custom' }
);

async function send(setup: Setup, line: string): Promise<void> {
  await setup.mockInput.typeText(line);
  setup.mockInput.pressEnter();
}

/** The color of the first character of `text` in the status line, as 0..255 values. */
function colorOf(setup: Setup, text: string): number[] | undefined {
  const line = setup.captureSpans().lines.at(-1)!;
  const span = line.spans.find((candidate) => candidate.text.includes(text[0]) && line.spans.map((entry) => entry.text).join('').includes(text));
  return span ? [...span.fg.buffer.slice(0, 3)] : undefined;
}

/** The spinner's marks seen beside `word` while it shows, until both have turned up. */
async function spins(setup: Setup, word: string): Promise<string[]> {
  const frames = new Set<string>();
  const pattern = new RegExp(`([<>]) ${word} · default mode`);
  const deadline = Date.now() + 3_000;
  while (frames.size < 2 && Date.now() < deadline) {
    frames.add((await frameWith(setup, (value) => pattern.test(value))).match(pattern)![1]);
    // Let the spinner's timer run between looks.
    await Bun.sleep(25);
  }
  return [...frames].sort();
}

test('while a turn works, the status line leads with the spinner and the phase in the style colors, and stops after', async () => {
  const { setup, close } = await open({ allowTools: ['run_command'] }, { statusStyle: arrows });
  try {
    context.server.enqueue(
      { delayMs: 600, toolCalls: [{ id: 'r1', name: 'run_command', arguments: { command: 'sleep 1' } }] },
      { text: 'Done.' }
    );
    await send(setup, 'go');
    expect(await spins(setup, 'thinking')).toEqual(['<', '>']);
    expect(colorOf(setup, 'thinking')).toEqual([255, 0, 0]);
    // A tool's run is work too: the spinner keeps moving through it.
    expect(await spins(setup, 'running')).toEqual(['<', '>']);
    const done = await frameWith(setup, (value) => value.includes('Done.') && value.includes('· ready'));
    expect(done.trim().split('\n').at(-1)).toStartWith('default mode');
  } finally {
    await close();
  }
}, 20_000);

const close = (opened: { close: () => Promise<void> }) => opened.close();

/** Arrows, with words of its own for thinking and for running a tool. */
const worded = (thinking: string) =>
  buildStatusStyle(
    { id: 'custom:worded', label: 'Worded', shimmerColors: ['#ff0000'], shimmer: false, words: { thinking: [thinking], tool: ['tinkering'] }, source: 'custom' },
    { id: 'custom:arrows', label: 'Arrows', spinnerFrames: ['<', '>'], spinnerColors: ['#00ff00'], intervalMs: 40, source: 'custom' }
  );

test("a style's words stand in for each phase's own, held across frames, fit the line, and are never read out", async () => {
  const first = await open({ allowTools: ['run_command'] }, { statusStyle: worded('pondering') });
  try {
    context.server.enqueue({ delayMs: 600, toolCalls: [{ id: 'r1', name: 'run_command', arguments: { command: 'sleep 1' } }] }, { text: 'Done.' });
    await send(first.setup, 'go');
    // Each phase shows its style's word for as long as it lasts, while the spinner turns.
    expect(await spins(first.setup, 'pondering')).toEqual(['<', '>']);
    expect(await spins(first.setup, 'tinkering')).toEqual(['<', '>']);
    await frameWith(first.setup, (value) => value.includes('Done.') && value.includes('· ready'));
  } finally {
    await close(first);
  }
  // A long word is measured as shown, so the rest of the status line gives way and stays on its row.
  const narrow = await open({}, { statusStyle: worded('contemplating the question at hand'), size: { width: 70, height: 20 } });
  try {
    context.server.enqueue({ text: 'Done.', delayMs: 600 });
    await send(narrow.setup, 'go');
    const frame = await frameWith(narrow.setup, (value) => value.includes('contemplating the question at hand'));
    expect(frame.trimEnd().split('\n').at(-1)).toMatch(/^[<>] contemplating the question at hand · default mode/);
  } finally {
    await close(narrow);
  }
  // Screen reader mode draws no indicator, and says what the phase is.
  const read = await open({}, { statusStyle: worded('pondering'), screenReader: true });
  try {
    context.server.enqueue({ text: 'Done.', delayMs: 400 });
    await send(read.setup, 'go');
    const working = await frameWith(read.setup, (value) => value.includes(', thinking'));
    expect(working).not.toContain('pondering');
  } finally {
    await close(read);
  }
}, 30_000);

test('the spinner stops while the terminal window is unfocused and runs again when it is back', async () => {
  const { setup, close } = await open({}, { statusStyle: arrows });
  try {
    context.server.enqueue({ text: 'Done.', delayMs: 1_500 });
    await send(setup, 'go');
    await frameWith(setup, (value) => /[<>] thinking/.test(value));
    setup.renderer.emit('blur');
    await Bun.sleep(60);
    const held = (await frameWith(setup, (value) => /[<>] thinking/.test(value))).match(/([<>]) thinking/)![1];
    for (let look = 0; look < 6; look += 1) {
      await Bun.sleep(45);
      await setup.renderOnce();
      expect(setup.captureCharFrame().match(/([<>]) thinking/)![1]).toBe(held);
    }
    setup.renderer.emit('focus');
    await frameWith(setup, (value) => value.match(/([<>]) thinking/)?.[1] !== held && /[<>] thinking/.test(value));
  } finally {
    await close();
  }
}, 30_000);

test('reduced motion, screen reader mode, and monochrome each keep the words and drop what they should', async () => {
  for (const view of [{ reducedMotion: true }, { screenReader: true }, { theme: THEMES.monochrome }]) {
    const { setup, close } = await open({}, { statusStyle: arrows, ...view });
    try {
      context.server.enqueue({ text: 'Done.', delayMs: 400 });
      await send(setup, 'go');
      const working = await frameWith(setup, (value) => value.includes('thinking'));
      if ('theme' in view) {
        // The motion stays; the color goes.
        expect(working).toMatch(/[<>] thinking · default mode/);
        expect(colorOf(setup, 'thinking')).not.toEqual([255, 0, 0]);
      } else {
        expect(working).not.toMatch(/[<>] thinking/);
        expect(working).toMatch(/(·|,) thinking/);
      }
      await frameWith(setup, (value) => value.includes('Done.'));
    } finally {
      await close();
    }
  }
}, 30_000);

test('/style lists the spinners and word styles, and a choice is used and saved', async () => {
  const { setup, close } = await open({}, { size: { width: 110, height: 40 } });
  try {
    await send(setup, '/style');
    const listed = await frameWith(setup, (frame) => frame.includes('Working indicator styles'));
    expect(listed).toContain('> Spinner: Pulse (default) (in use)');
    expect(listed).toContain('Spinner: Orbit');
    expect(listed).toContain('◜ ◠ ◝ ◞ ◡ ◟');
    await setup.mockInput.typeText('orbit');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Indicator spinner: orbit. It is saved in your user configuration.'));
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8'));
    expect(saved.ui.status_spinner_style).toBe('orbit');
    context.server.enqueue({ text: 'Done.', delayMs: 400 });
    await send(setup, 'go');
    await frameWith(setup, (frame) => /[◜◠◝◞◡◟] thinking/.test(frame));
    await send(setup, '/style aurora');
    await frameWith(setup, (frame) => frame.includes('Indicator words: aurora.'));
    expect(BUILTIN_TEXT_STYLES.aurora).toBeDefined();
  } finally {
    await close();
  }
}, 30_000);
