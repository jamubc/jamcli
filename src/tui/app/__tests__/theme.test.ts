import { expect, test } from 'bun:test';
import { TERMINAL, THEMES, THEME_NAMES, framed, noColor, resolveTheme } from '../theme.js';

test('NO_COLOR set to anything but empty means monochrome, whatever the configured theme', () => {
  expect(noColor({})).toBe(false);
  expect(noColor({ NO_COLOR: '' })).toBe(false);
  expect(noColor({ NO_COLOR: '1' })).toBe(true);
  expect(resolveTheme('light', { NO_COLOR: '1' }).name).toBe('monochrome');
  expect(resolveTheme('light', {}).name).toBe('light');
  expect(resolveTheme(undefined, { NO_COLOR: '' }).name).toBe('dark');
});

test('every theme names itself, and monochrome leaves every color to the terminal', () => {
  for (const name of THEME_NAMES) {
    expect(THEMES[name].name).toBe(name);
    // Text with no role is the terminal's own color everywhere, never OpenTUI's plain white.
    expect(THEMES[name].text).toBe(TERMINAL);
  }
  const { name, diff, tokens, ...colors } = THEMES.monochrome;
  expect(Object.values(colors).every((color) => color === TERMINAL)).toBe(true);
  expect(tokens).toEqual({});
  expect(diff).toEqual({ addedBg: 'transparent', removedBg: 'transparent', addedSign: TERMINAL, removedSign: TERMINAL });
});

test('a frame is a border with padding, and in screen reader mode there is neither', () => {
  expect(framed(false, '#123456')).toEqual({ border: true, borderColor: '#123456', paddingLeft: 1, paddingRight: 1 });
  expect(framed(false, TERMINAL)).toEqual({ border: true, borderColor: TERMINAL, paddingLeft: 1, paddingRight: 1 });
  expect(framed(true, '#123456')).toEqual({ paddingLeft: 0, paddingRight: 0 });
});
