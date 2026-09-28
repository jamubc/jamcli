/** @jsxImportSource @opentui/react */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlur, useFocus } from '@opentui/react';
import type { StatusStyleDefinition } from '../../styles/statusStyles.js';
import { breath, resolveColor, sample, sweep, sweepMs, TICK_MS } from './motion.js';
import { frameRow } from '../../styles/fromConfig.js';
import { useSelectable, useTheme } from './theme.js';

/**
 * The working indicator: a spinner that breathes through the style's color ramp, and
 * the phase's words with a soft band of light sweeping across them. Both run on one
 * clock from the moment the indicator is shown, so the motion is continuous rather than
 * stepped. It is drawn only while shown; with reduced motion or in screen reader mode the
 * interface does not draw it, and the status line's words say the same thing.
 */
export function Indicator({ style, words }: { style: StatusStyleDefinition; words: string }) {
  const theme = useTheme();
  const sel = useSelectable();
  const started = useRef(Date.now());
  const [now, setNow] = useState(started.current);
  // Nothing moves while the terminal window is unfocused; the clock carries on where it was.
  const [awake, setAwake] = useState(true);
  useBlur(() => setAwake(false));
  useFocus(() => setAwake(true));
  useEffect(() => {
    if (!awake) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [awake]);
  const elapsed = now - started.current;

  // Monochrome, or NO_COLOR, keeps the motion and drops the colors.
  const colored = theme.name !== 'monochrome';
  const frames = useMemo(() => style.spinnerFrames.map(frameRow), [style.spinnerFrames]);
  const spinnerRamp = useMemo(() => style.spinnerColors.map((color) => resolveColor(color, theme)), [style.spinnerColors, theme]);
  const wordRamp = useMemo(() => style.shimmerColors.map((color) => resolveColor(color, theme)), [style.shimmerColors, theme]);

  const cycle = Math.max(TICK_MS, style.spinnerIntervalMs) * frames.length;
  const phase = (elapsed % cycle) / cycle;
  const frame = frames[Math.min(frames.length - 1, Math.floor(phase * frames.length))];
  const spinner = colored ? sample(spinnerRamp, breath(phase)) : theme.text;

  const chars = [...words];
  const lit = style.shimmer ? sweep(chars.length, (elapsed % sweepMs(chars.length)) / sweepMs(chars.length)) : undefined;
  const colorAt = (index: number) => (colored ? (lit ? sample(wordRamp, lit[index]) : wordRamp[0] ?? theme.text) : theme.text);

  return (
    <text {...sel} fg={theme.text}>
      <span fg={spinner}>{frame}</span>
      {' '}
      {chars.map((char, index) => (
        <span key={index} fg={colorAt(index)}>
          {char}
        </span>
      ))}
      {' · '}
    </text>
  );
}
