import { useEffect, useState } from 'react';

export const DEFAULT_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const DEFAULT_SHIMMER_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue'];

export const useColorSpinner = (
  frames: string[] | undefined,
  active: boolean,
  colors: string[],
  intervalMs: number = 80
) => {
  const sequence = frames && frames.length > 0 ? frames : DEFAULT_SPINNER_FRAMES;
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % sequence.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, sequence.length]);

  const frame = sequence[frameIndex % sequence.length];
  const palette = colors && colors.length > 0 ? colors : DEFAULT_SHIMMER_COLORS;
  const color = palette[frameIndex % palette.length];
  return active ? { frame, color } : null;
};

const formatElapsed = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

export const useElapsedTimer = (startedAt?: number, active?: boolean) => {
  const [elapsed, setElapsed] = useState('0s');

  useEffect(() => {
    if (!startedAt || !active) {
      setElapsed('0s');
      return;
    }

    const update = () => {
      const diff = Date.now() - startedAt;
      setElapsed(formatElapsed(diff));
    };

    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [active, startedAt]);

  return elapsed;
};

export const useShimmerTick = (active: boolean) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((prev) => prev + 1), 120);
    return () => clearInterval(id);
  }, [active]);
  return tick;
};
