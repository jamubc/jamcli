import { expect, test } from 'bun:test';
import { TextAttributes } from '@opentui/core';
import { TERMINAL, THEMES, THEME_NAMES, chosenRow, framed, noColor, resolveTheme, selectable } from '../theme.js';

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
  const { name, diff, tokens, selection, chosen, ...colors } = THEMES.monochrome;
  expect(Object.values(colors).every((color) => color === TERMINAL)).toBe(true);
  expect(tokens).toEqual({});
  expect(diff).toEqual({ addedBg: 'transparent', removedBg: 'transparent', addedSign: TERMINAL, removedSign: TERMINAL });
  expect(selection).toBe('inverse');
  expect(chosen).toBe('inverse');
});

test('a selection and a chosen row are drawn in the theme, and inverted where there is no color', () => {
  for (const name of THEME_NAMES) {
    if (name === 'monochrome') continue;
    // A selection has a background of its own, and a chosen row a bar of its own.
    const { selection, chosen } = THEMES[name];
    expect(typeof selection === 'object' && /^#[0-9a-f]{6}$/.test(selection.bg as string)).toBe(true);
    expect(/^#[0-9a-f]{6}$/.test(chosen as string)).toBe(true);
    expect(selectable(THEMES[name]).selectionBg).toBe((selection as { bg: string }).bg);
    expect(chosenRow(THEMES[name], true)).toEqual({ bg: chosen });
    expect(chosenRow(THEMES[name], false)).toEqual({});
  }
  // High contrast sets the text's color too, since bright tokens would vanish on white.
  expect(selectable(THEMES['high-contrast'])).toEqual({ selectionBg: '#ffffff', selectionFg: '#000000' });
  expect(selectable(THEMES.dark).selectionFg).toBeUndefined();
  // Monochrome leaves the selection colors unset, which OpenTUI draws as inverse video.
  expect(selectable(THEMES.monochrome)).toEqual({});
  expect(chosenRow(THEMES.monochrome, true)).toEqual({ attributes: TextAttributes.INVERSE });
});

test('a frame is a border with padding, and in screen reader mode there is neither', () => {
  expect(framed(false, '#123456')).toEqual({ border: true, borderColor: '#123456', paddingLeft: 1, paddingRight: 1 });
  expect(framed(false, TERMINAL)).toEqual({ border: true, borderColor: TERMINAL, paddingLeft: 1, paddingRight: 1 });
  expect(framed(true, '#123456')).toEqual({ paddingLeft: 0, paddingRight: 0 });
});
