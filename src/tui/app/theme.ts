import { RGBA, TextAttributes } from '@opentui/core';
import { createContext, useContext } from 'react';
import { noColor } from '../../styles/themeNames.js';
import type { ThemeName } from '../../types/config.js';

export type Color = string | RGBA;

/**
 * The terminal's own foreground. OpenTUI draws text with no color in plain white, which
 * vanishes on a light background, so every color the interface leaves to the terminal is
 * this one.
 */
export const TERMINAL: RGBA = RGBA.defaultForeground();

/**
 * The interface's colors, by role. Every state also has a word, so no color carries
 * meaning alone, and monochrome leaves every color to the terminal.
 */
export interface Theme {
  name: ThemeName;
  /** Text with no role of its own: the terminal's foreground in every theme. */
  text: Color;
  dim: Color;
  user: Color;
  accent: Color;
  warn: Color;
  error: Color;
  border: Color;
  /**
   * Text a drag selected: its background, and its foreground when the tokens' own colors
   * would not read on that background. Monochrome inverts the text instead.
   */
  selection: { bg: Color; fg?: Color } | 'inverse';
  /**
   * The row the keys or the pointer chose, in a list and in the permission prompt: a bar
   * behind it, so what a click would choose is plain before the click. Monochrome
   * inverts the row instead.
   */
  chosen: Color | 'inverse';
  /** A line whose work is done, between text and dim, so the live turn stands out from what settled. */
  settled: Color;
  /** Diff lines: backgrounds and the + and - signs. */
  diff: { addedBg: string; removedBg: string; addedSign: Color; removedSign: Color };
  /** Token colors for Markdown, code, and diffs. Monochrome keeps only bold, italic, and underline. */
  tokens: {
    heading?: string;
    list?: string;
    raw?: string;
    link?: string;
    keyword?: string;
    string?: string;
    comment?: string;
    number?: string;
    func?: string;
    type?: string;
    property?: string;
    operator?: string;
  };
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    text: TERMINAL,
    dim: '#7a7f8c',
    user: '#9ece6a',
    accent: '#7aa2f7',
    warn: '#e0af68',
    error: '#f7768e',
    border: '#3b4261',
    selection: { bg: '#33467c' },
    chosen: '#292e42',
    settled: '#9aa0b8',
    diff: { addedBg: '#1a4d1a', removedBg: '#4d1a1a', addedSign: '#22c55e', removedSign: '#ef4444' },
    tokens: {
      heading: '#7aa2f7',
      list: '#e0af68',
      raw: '#9ece6a',
      link: '#7dcfff',
      keyword: '#bb9af7',
      string: '#9ece6a',
      comment: '#7a7f8c',
      number: '#ff9e64',
      func: '#7aa2f7',
      type: '#2ac3de',
      property: '#73daca',
      operator: '#89ddff',
    },
  },
  light: {
    name: 'light',
    text: TERMINAL,
    dim: '#5c5f77',
    user: '#40a02b',
    accent: '#1e66f5',
    warn: '#b35900',
    error: '#d20f39',
    border: '#9ca0b0',
    selection: { bg: '#c9d4ee' },
    chosen: '#dce0e8',
    settled: '#4c4f64',
    diff: { addedBg: '#dafbe1', removedBg: '#ffebe9', addedSign: '#1a7f37', removedSign: '#cf222e' },
    tokens: {
      heading: '#1e66f5',
      list: '#b35900',
      raw: '#40a02b',
      link: '#0277bd',
      keyword: '#8839ef',
      string: '#40a02b',
      comment: '#6c6f85',
      number: '#d95e00',
      func: '#1e66f5',
      type: '#127c86',
      property: '#127c86',
      operator: '#04729e',
    },
  },
  'high-contrast': {
    name: 'high-contrast',
    text: TERMINAL,
    dim: '#d0d0d0',
    user: '#00ff5f',
    accent: '#00d7ff',
    warn: '#ffff00',
    error: '#ff5f5f',
    border: '#ffffff',
    selection: { bg: '#ffffff', fg: '#000000' },
    chosen: '#005f87',
    settled: '#e8e8e8',
    diff: { addedBg: '#003300', removedBg: '#330000', addedSign: '#00ff5f', removedSign: '#ff5f5f' },
    tokens: {
      heading: '#00d7ff',
      list: '#ffff00',
      raw: '#00ff5f',
      link: '#00d7ff',
      keyword: '#ff87ff',
      string: '#00ff5f',
      comment: '#d0d0d0',
      number: '#ffaf00',
      func: '#00d7ff',
      type: '#5fffff',
      property: '#5fffff',
      operator: '#ffffff',
    },
  },
  monochrome: {
    name: 'monochrome',
    text: TERMINAL,
    dim: TERMINAL,
    user: TERMINAL,
    accent: TERMINAL,
    warn: TERMINAL,
    error: TERMINAL,
    border: TERMINAL,
    selection: 'inverse',
    chosen: 'inverse',
    settled: TERMINAL,
    diff: { addedBg: 'transparent', removedBg: 'transparent', addedSign: TERMINAL, removedSign: TERMINAL },
    tokens: {},
  },
};

/** The theme to draw with: monochrome whenever NO_COLOR is set, otherwise the configured one, or dark. */
export function resolveTheme(configured: ThemeName | undefined, env: Record<string, string | undefined>): Theme {
  if (noColor(env)) return THEMES.monochrome;
  return THEMES[configured ?? 'dark'] ?? THEMES.dark;
}

export const ThemeContext = createContext<Theme>(THEMES.dark);
export const useTheme = (): Theme => useContext(ThemeContext);

/** What every text element takes so a drag across it is drawn in the theme's selection colors. */
export type Selectable = { selectionBg?: Color; selectionFg?: Color };

/**
 * The selection colors of a theme, as the props of a text, markdown, or diff element.
 * Inverse leaves them unset: OpenTUI then swaps each selected cell's own colors.
 */
export const selectable = (theme: Theme): Selectable =>
  theme.selection === 'inverse' ? {} : { selectionBg: theme.selection.bg, ...(theme.selection.fg ? { selectionFg: theme.selection.fg } : {}) };

export const useSelectable = (): Selectable => selectable(useTheme());

/** How a row is drawn when it is the chosen one: the theme's bar behind it, or inverse video. */
export const chosenRow = (theme: Theme, chosen: boolean): { bg?: Color; attributes?: number } => {
  if (!chosen) return {};
  return theme.chosen === 'inverse' ? { attributes: TextAttributes.INVERSE } : { bg: theme.chosen };
};

/**
 * Screen reader mode: plain labeled lines, with no boxes, no marks, and no Markdown
 * markers hidden, so everything on screen reads in order.
 */
export const PlainContext = createContext(false);
export const usePlain = (): boolean => useContext(PlainContext);

/**
 * A box's border in a color, or none in screen reader mode. OpenTUI draws a border
 * whenever a border color is given, so plain mode gives neither.
 */
export const framed = (plain: boolean, color: Color): { border?: true; borderColor?: Color; paddingLeft: number; paddingRight: number } =>
  plain ? { paddingLeft: 0, paddingRight: 0 } : { border: true, borderColor: color, paddingLeft: 1, paddingRight: 1 };

/** Reduced motion: no spinner and no shimmer. */
export const MotionContext = createContext(false);
export const useReducedMotion = (): boolean => useContext(MotionContext);
