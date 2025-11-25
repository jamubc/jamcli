import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useColorSpinner, useShimmerTick } from '../hooks/useStatusIndicator.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';

const renderShimmeringText = (text: string, palette: string[], shimmerEnabled: boolean, shimmerTick: number) => {
  const baseColor = palette[0] || 'white';
  return text.split('').map((char, idx) => {
    const color = shimmerEnabled ? palette[(idx + shimmerTick) % palette.length] : baseColor;
    return (
      <Text key={`${text}-${idx}`} color={color} bold>
        {char}
      </Text>
    );
  });
};

const ColorSwatches = ({ label, colors }: { label: string; colors: string[] }) => {
  const safeColors = colors.length ? colors : ['white'];
  const titleCase = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

  return (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text color="gray">{label}:</Text>
      {safeColors.map((color, idx) => (
        <Box key={`${label}-${color}-${idx}`} flexDirection="row" gap={1} alignItems="center">
          <Text backgroundColor={color} color="black">
            {'  '}
          </Text>
          <Text color="gray">{titleCase(color)}</Text>
        </Box>
      ))}
    </Box>
  );
};

export const StatusStylePreview = ({
  style,
  optionLabel,
  optionSource,
  path,
  isActive,
}: {
  style: StatusStyleDefinition;
  optionLabel: string;
  optionSource: 'builtin' | 'custom';
  path?: string;
  isActive: boolean;
}) => {
  const palette = style.shimmerColors?.length ? style.shimmerColors : ['white'];
  const shimmerEnabled = style.shimmer ?? true;
  const spinnerPalette = style.spinnerColors?.length ? style.spinnerColors : palette;
  const [phase, setPhase] = useState<'thinking' | 'done'>('thinking');
  const spinnerFrame = useColorSpinner(style.spinnerFrames, phase === 'thinking', spinnerPalette, style.spinnerIntervalMs);
  const shimmerTick = useShimmerTick(shimmerEnabled);
  const normalizeFrame = (frame?: string) => {
    if (!frame) return '';
    if (!frame.includes('\n')) return frame;
    const rows = frame.split('\n');
    const middle = rows[Math.floor(rows.length / 2)]?.trim();
    return middle || rows[0].trim() || frame.replace(/\s+/g, ' ').trim();
  };
  const rawFrame = spinnerFrame?.frame || style.spinnerFrames[0];

  useEffect(() => {
    const id = setInterval(() => {
      setPhase((prev) => (prev === 'thinking' ? 'done' : 'thinking'));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const indicatorFrame =
    phase === 'thinking' ? normalizeFrame(rawFrame) || '⠦' : '✓';
  const indicatorColor =
    phase === 'thinking' ? spinnerFrame?.color || spinnerPalette[0] || 'cyan' : 'green';
  const textPalette = phase === 'done' ? ['green', ...palette] : palette;
  const previewText = phase === 'thinking' ? 'Thinking...' : 'Done';
  const previewHint = phase === 'thinking' ? 'loading' : 'success';

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text bold color="cyan">
          {optionLabel}
        </Text>
        <Text color={isActive ? 'green' : 'yellow'}>
          {isActive ? 'Active' : 'Preview (Not Saved)'}
        </Text>
      </Box>

      <Box
        borderStyle="round"
        borderColor={isActive ? 'green' : 'gray'}
        paddingX={1}
        paddingY={1}
        flexDirection="column"
        gap={1}
      >
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={indicatorColor}>{indicatorFrame}</Text>
          <Text>{renderShimmeringText(previewText, textPalette, shimmerEnabled, shimmerTick)}</Text>
          <Text color="gray">{previewHint}</Text>
        </Box>
        <Text color="gray" dimColor>
          {'Cycles: ⠦ Thinking -> ✓ Done (every 2s)'}
        </Text>
      </Box>

      <ColorSwatches label="Palette" colors={spinnerPalette} />
      <ColorSwatches label="Text shimmer" colors={palette} />

      <Box flexDirection="row" gap={1} alignItems="center">
        <Text color="gray">Source:</Text>
        <Text color={optionSource === 'custom' ? 'magenta' : 'gray'}>
          {optionSource === 'custom' ? 'Custom style' : 'Built-in'}
        </Text>
        <Text color="gray">· Speed: {style.spinnerIntervalMs}ms</Text>
      </Box>
      {path && (
        <Text color="gray">
          Path: {path}
        </Text>
      )}
    </Box>
  );
};
