import { expect, test } from 'bun:test';
import { THEMES, THEME_NAMES, framed, noColor, resolveTheme } from '../theme.js';

test('NO_COLOR set to anything but empty means monochrome, whatever the configured theme', () => {
  expect(noColor({})).toBe(false);
  expect(noColor({ NO_COLOR: '' })).toBe(false);
  expect(noColor({ NO_COLOR: '1' })).toBe(true);
  expect(resolveTheme('light', { NO_COLOR: '1' }).name).toBe('monochrome');
  expect(resolveTheme('light', {}).name).toBe('light');
  expect(resolveTheme(undefined, { NO_COLOR: '' }).name).toBe('dark');
});

test('every theme names itself, and monochrome carries no color at all', () => {
  for (const name of THEME_NAMES) expect(THEMES[name].name).toBe(name);
  const { name, diff, tokens, ...colors } = THEMES.monochrome;
  expect(Object.values(colors).filter(Boolean)).toEqual([]);
  expect(tokens).toEqual({});
  expect(diff).toEqual({ addedBg: 'transparent', removedBg: 'transparent', addedSign: 'default', removedSign: 'default' });
});

test('a frame is a border with padding, and in screen reader mode there is neither', () => {
  expect(framed(false, '#123456')).toEqual({ border: true, borderColor: '#123456', paddingLeft: 1, paddingRight: 1 });
  // A border color alone would draw a border, so a theme without one leaves it out.
  expect(framed(false, undefined)).toEqual({ border: true, paddingLeft: 1, paddingRight: 1 });
  expect(framed(true, '#123456')).toEqual({ paddingLeft: 0, paddingRight: 0 });
});
