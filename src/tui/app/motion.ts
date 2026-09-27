import type { Color, Theme } from './theme.js';

/**
 * The working indicator's motion, as pure functions of time: a spinner that breathes
 * through a color ramp, and a soft band of light that sweeps across the phase's words.
 * Nothing here touches a timer or the renderer, so it is tested by value.
 */

/** How often the indicator redraws. Ramps are sampled at this clock, so motion eases instead of stepping. */
export const TICK_MS = 50;
/** How many characters the sweep's band lights at once. */
export const BAND = 3;
/** How many character widths the sweep rests for after leaving the words, before it comes back. */
export const REST = 8;
/** How long the sweep takes to move one character. */
export const SWEEP_MS_PER_CHAR = 70;

/** The theme roles a style may name in place of a color, so the default style follows the theme. */
const ROLES = new Set(['text', 'dim', 'accent', 'warn', 'error']);

/** The 16 terminal color names the Ink interface's styles used, in the interface's own palette. */
const NAMED: Record<string, string> = {
  black: '#1a1b26',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#c0caf5',
  gray: '#7a7f8c',
  grey: '#7a7f8c',
};

/** A style's color as the renderer draws it: a theme role, a hex color, a legacy name, or whatever the style said. */
export function resolveColor(name: string, theme: Theme): Color {
  if (ROLES.has(name)) return theme[name as 'text' | 'dim' | 'accent' | 'warn' | 'error'];
  const lower = name.toLowerCase();
  const plain = lower.replace(/^bright/, '');
  return NAMED[plain] ?? name;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const rgb = (color: Color): [number, number, number] | undefined => {
  if (typeof color !== 'string' || !HEX.test(color)) return undefined;
  const hex = color.length === 4 ? [...color.slice(1)].map((digit) => digit + digit).join('') : color.slice(1);
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
};

const hex = (channel: number): string => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0');

/**
 * The color `weight` of the way from `from` to `to`. Only hex colors blend; the terminal's
 * own foreground has no known value, so a blend toward it steps at the halfway point.
 */
export function mix(from: Color, to: Color, weight: number): Color {
  const w = Math.min(1, Math.max(0, weight));
  const a = rgb(from);
  const b = rgb(to);
  if (!a || !b) return w < 0.5 ? from : to;
  return `#${hex(a[0] + (b[0] - a[0]) * w)}${hex(a[1] + (b[1] - a[1]) * w)}${hex(a[2] + (b[2] - a[2]) * w)}`;
}

/** The color `weight` of the way along a ramp of stops, blending between neighbours. */
export function sample(ramp: Color[], weight: number): Color {
  if (ramp.length === 0) return '#ffffff';
  if (ramp.length === 1) return ramp[0];
  const position = Math.min(1, Math.max(0, weight)) * (ramp.length - 1);
  const index = Math.min(ramp.length - 2, Math.floor(position));
  return mix(ramp[index], ramp[index + 1], position - index);
}

/** A breath: 0 at the start of a cycle, 1 halfway, 0 at the end, eased so it never jerks. */
export const breath = (phase: number): number => (1 - Math.cos(2 * Math.PI * (phase % 1))) / 2;

/** How long one sweep across `length` characters takes, rest included. */
export const sweepMs = (length: number): number => (length + 2 * BAND + REST) * SWEEP_MS_PER_CHAR;

/**
 * How lit each of `length` characters is at `phase` (0 to 1) of a sweep: a band of BAND
 * characters, brightest at its center and fading to its edges, travels left to right
 * across the words, then rests off the right edge before it comes back.
 */
export function sweep(length: number, phase: number): number[] {
  const span = length + 2 * BAND + REST;
  const head = (phase % 1) * span - BAND;
  return Array.from({ length }, (_, index) => {
    const distance = Math.abs(index - head);
    return distance >= BAND ? 0 : 1 - distance / BAND;
  });
}
