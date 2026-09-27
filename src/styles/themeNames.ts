import type { ThemeName } from '../types/config.js';

/** The themes, in the order they are offered. */
export const THEME_NAMES: ThemeName[] = ['dark', 'light', 'high-contrast', 'monochrome'];

/** Whether the environment asks for no color: `NO_COLOR` set to anything but empty, as no-color.org says. */
export const noColor = (env: Record<string, string | undefined>): boolean => Boolean(env.NO_COLOR);
