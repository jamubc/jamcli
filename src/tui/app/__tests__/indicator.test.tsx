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

test('while a turn works, the status line leads with the spinner and the phase in the style colors, and stops after', async () => {
  const { setup, close } = await open({}, { statusStyle: arrows });
  try {
    context.server.enqueue({ text: 'Done.', delayMs: 600 });
    await send(setup, 'go');
    const frames = new Set<string>();
    const deadline = Date.now() + 3_000;
    while (frames.size < 2 && Date.now() < deadline) {
      const frame = await frameWith(setup, (value) => /[<>] thinking · default mode/.test(value));
      frames.add(frame.match(/([<>]) thinking/)![1]);
      // Let the spinner's timer run between looks.
      await Bun.sleep(25);
    }
    expect([...frames].sort()).toEqual(['<', '>']);
    expect(colorOf(setup, 'thinking')).toEqual([255, 0, 0]);
    const done = await frameWith(setup, (value) => value.includes('Done.') && value.includes('· ready'));
    expect(done.trim().split('\n').at(-1)).toStartWith('default mode');
  } finally {
    await close();
  }
}, 20_000);

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
    expect(listed).toContain('> Spinner: Classic Spinner (in use)');
    expect(listed).toContain('Spinner: Orbit');
    expect(listed).toContain('◐ ◓ ◑ ◒');
    await setup.mockInput.typeText('orbit');
    setup.mockInput.pressEnter();
    await frameWith(setup, (frame) => frame.includes('Indicator spinner: orbit. It is saved in your user configuration.'));
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), 'utf8'));
    expect(saved.ui.status_spinner_style).toBe('orbit');
    context.server.enqueue({ text: 'Done.', delayMs: 400 });
    await send(setup, 'go');
    await frameWith(setup, (frame) => /[◐◓◑◒] thinking/.test(frame));
    await send(setup, '/style aurora');
    await frameWith(setup, (frame) => frame.includes('Indicator words: aurora.'));
    expect(BUILTIN_TEXT_STYLES.aurora).toBeDefined();
  } finally {
    await close();
  }
}, 30_000);
