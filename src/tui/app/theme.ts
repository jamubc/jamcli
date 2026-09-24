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
  monochrome: { name: 'monochrome', tokens: {} },
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
