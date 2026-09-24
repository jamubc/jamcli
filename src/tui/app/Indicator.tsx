/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react';
import type { StatusStyleDefinition } from '../../styles/statusStyles.js';
import { frameRow } from './statusStyle.js';
import { useTheme } from './theme.js';

/**
 * The working indicator: a spinner and the phase's words in the style's colors. It moves
 * only while shown; with reduced motion or in screen reader mode the interface does not
 * draw it, and the status line's words say the same thing.
 */
export function Indicator({ style, words }: { style: StatusStyleDefinition; words: string }) {
  const theme = useTheme();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((count) => count + 1), style.spinnerIntervalMs);
    return () => clearInterval(timer);
  }, [style.spinnerIntervalMs]);
  // Monochrome, or NO_COLOR, keeps the motion and drops the colors.
  const colored = theme.name !== 'monochrome';
  const frame = frameRow(style.spinnerFrames[tick % style.spinnerFrames.length]);
  const spinner = colored ? style.spinnerColors[tick % style.spinnerColors.length] : theme.text;
  const palette = style.shimmerColors;
  return (
    <text fg={theme.text}>
      <span fg={spinner}>{frame}</span>
      {' '}
      {[...words].map((char, index) => (
        <span key={index} fg={colored ? palette[style.shimmer ? (index + tick) % palette.length : 0] : theme.text}>
          {char}
        </span>
      ))}
      {' · '}
    </text>
  );
}
