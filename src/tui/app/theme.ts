import { createContext, useContext } from 'react';
import type { ThemeName } from '../../types/config.js';

/**
 * The interface's colors, by role. Every state also has a word, so no color carries
 * meaning alone, and monochrome leaves every color to the terminal.
 */
export interface Theme {
  name: ThemeName;
  dim?: string;
  user?: string;
  accent?: string;
  warn?: string;
  error?: string;
  border?: string;
  /** Diff lines: backgrounds and the + and - signs. `default` is the terminal's own color. */
  diff: { addedBg: string; removedBg: string; addedSign: string; removedSign: string };
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
    dim: '#7a7f8c',
    user: '#9ece6a',
    accent: '#7aa2f7',
    warn: '#e0af68',
    error: '#f7768e',
    border: '#3b4261',
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
    dim: '#5c5f77',
    user: '#40a02b',
    accent: '#1e66f5',
    warn: '#b35900',
    error: '#d20f39',
    border: '#9ca0b0',
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
    dim: '#d0d0d0',
    user: '#00ff5f',
    accent: '#00d7ff',
    warn: '#ffff00',
    error: '#ff5f5f',
    border: '#ffffff',
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
  monochrome: { name: 'monochrome', diff: { addedBg: 'transparent', removedBg: 'transparent', addedSign: 'default', removedSign: 'default' }, tokens: {} },
};

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

/** Whether the environment asks for no color: `NO_COLOR` set to anything but empty, as no-color.org says. */
export const noColor = (env: Record<string, string | undefined>): boolean => Boolean(env.NO_COLOR);

/** The theme to draw with: monochrome whenever NO_COLOR is set, otherwise the configured one, or dark. */
export function resolveTheme(configured: ThemeName | undefined, env: Record<string, string | undefined>): Theme {
  if (noColor(env)) return THEMES.monochrome;
  return THEMES[configured ?? 'dark'] ?? THEMES.dark;
}

export const ThemeContext = createContext<Theme>(THEMES.dark);
export const useTheme = (): Theme => useContext(ThemeContext);

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
export const framed = (plain: boolean, color: string | undefined): { border?: true; borderColor?: string; paddingLeft: number; paddingRight: number } =>
  plain ? { paddingLeft: 0, paddingRight: 0 } : { border: true, ...(color ? { borderColor: color } : {}), paddingLeft: 1, paddingRight: 1 };

/** Reduced motion: no spinner and no shimmer. */
export const MotionContext = createContext(false);
export const useReducedMotion = (): boolean => useContext(MotionContext);
