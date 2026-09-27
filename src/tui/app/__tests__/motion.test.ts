import { expect, test } from 'bun:test';
import { BAND, breath, mix, resolveColor, sample, sweep, sweepMs } from '../motion.js';
import { THEMES } from '../theme.js';

test('a theme role, a hex color, and a legacy terminal name each resolve to a color the renderer can draw', () => {
  expect(resolveColor('accent', THEMES.dark)).toBe(THEMES.dark.accent);
  expect(resolveColor('accent', THEMES.light)).toBe(THEMES.light.accent);
  expect(resolveColor('#ff0000', THEMES.dark)).toBe('#ff0000');
  expect(resolveColor('cyan', THEMES.dark)).toMatch(/^#[0-9a-f]{6}$/);
  expect(resolveColor('brightCyan', THEMES.dark)).toBe(resolveColor('cyan', THEMES.dark));
  expect(resolveColor('rebeccapurple', THEMES.dark)).toBe('rebeccapurple');
});

test('hex colors blend by weight, and a blend toward the terminal foreground steps at the halfway point', () => {
  expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
  expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  expect(mix('#000', '#fff', 0.5)).toBe('#808080');
  expect(mix('#000000', '#ffffff', 2)).toBe('#ffffff');
  expect(mix('#000000', THEMES.dark.text, 0.4)).toBe('#000000');
  expect(mix('#000000', THEMES.dark.text, 0.6)).toBe(THEMES.dark.text);
});

test('a ramp is sampled across its stops, so the middle stop is reached halfway', () => {
  expect(sample(['#ff0000'], 0.7)).toBe('#ff0000');
  expect(sample(['#000000', '#ffffff'], 0.25)).toBe('#404040');
  expect(sample(['#000000', '#ff0000', '#ffffff'], 0.5)).toBe('#ff0000');
  expect(sample(['#000000', '#ff0000', '#ffffff'], 1)).toBe('#ffffff');
  expect(sample([], 0.5)).toBe('#ffffff');
});

test('a breath rests at the start and end of a cycle and peaks halfway', () => {
  expect(breath(0)).toBeCloseTo(0);
  expect(breath(0.5)).toBeCloseTo(1);
  expect(breath(1)).toBeCloseTo(0);
  expect(breath(0.25)).toBeCloseTo(0.5);
});

test('the sweep lights a soft band that crosses the words left to right and then rests off the edge', () => {
  const length = 8;
  const dark = sweep(length, 0);
  expect(dark.every((weight) => weight === 0)).toBe(true);
  const span = length + 2 * BAND + 8;
  const centered = sweep(length, (BAND + 3) / span);
  expect(centered[3]).toBeCloseTo(1);
  expect(centered[2]).toBeCloseTo(1 - 1 / BAND);
  expect(centered[4]).toBeCloseTo(1 - 1 / BAND);
  expect(centered[0]).toBe(0);
  expect(centered[7]).toBe(0);
  const resting = sweep(length, (BAND + length + BAND + 2) / span);
  expect(resting.every((weight) => weight === 0)).toBe(true);
  expect(sweepMs(length)).toBe(span * 70);
});
