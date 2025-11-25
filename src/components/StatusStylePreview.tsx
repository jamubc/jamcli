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
  const spinnerFrame = useColorSpinner(style.spinnerFrames, true, spinnerPalette, style.spinnerIntervalMs);
  const shimmerTick = useShimmerTick(shimmerEnabled);
  const [phase, setPhase] = useState<'thinking' | 'replying'>('thinking');

  useEffect(() => {
    const id = setInterval(() => {
      setPhase((prev) => (prev === 'thinking' ? 'replying' : 'thinking'));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  const spinnerSample = style.spinnerFrames.slice(0, 8).join(' ');
  const spinnerSuffix = style.spinnerFrames.length > 8 ? ' ...' : '';
  const paletteSwatches = palette.map((color, idx) => (
    <Text key={`${color}-${idx}`} color={color}>
      []
    </Text>
  ));
  const spinnerSwatches = spinnerPalette.map((color, idx) => (
    <Text key={`${color}-spinner-${idx}`} color={color}>
      []
    </Text>
  ));

  const renderLine = (text: string, hint: string) => (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text color={spinnerFrame?.color || palette[0] || 'gray'}>{spinnerFrame?.frame || '•'}</Text>
      <Text>{renderShimmeringText(text, palette, shimmerEnabled, shimmerTick)}</Text>
      <Text color="gray">{hint}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text bold color="cyan">
          Live Preview
        </Text>
        <Text color={isActive ? 'green' : 'yellow'}>{isActive ? 'active' : 'not applied'}</Text>
      </Box>

      <Box
        width={17}
        height={7}
        borderStyle="single"
        borderColor={isActive ? 'green' : 'gray'}
        alignItems="center"
        justifyContent="center"
      >
        <Text color={spinnerFrame?.color || spinnerPalette[0] || 'gray'}>
          {spinnerFrame?.frame || '•'}
        </Text>
      </Box>

      <Box borderStyle="round" borderColor={isActive ? 'green' : 'gray'} paddingX={1} paddingY={0} flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text bold>{optionLabel}</Text>
          <Text color="gray">{optionSource === 'custom' ? 'custom' : 'built-in'}</Text>
        </Box>
        {renderLine(
          phase === 'thinking' ? 'Thinking through the prompt...' : 'Streaming the reply back to you',
          phase === 'thinking' ? '(thinking)' : '(replying)'
        )}
      </Box>

      <Box flexDirection="column" gap={0}>
        <Text color="gray">
          Spinner frames: {spinnerSample}
          {spinnerSuffix}
        </Text>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color="gray">Shimmer:</Text>
          <Text color={shimmerEnabled ? 'green' : 'yellow'}>{shimmerEnabled ? 'enabled' : 'disabled'}</Text>
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color="gray">Palette:</Text>
          {paletteSwatches}
          {!shimmerEnabled && <Text color="gray">(shimmer off)</Text>}
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color="gray">Spinner colors:</Text>
          {spinnerSwatches}
          <Text color="gray">· speed: {style.spinnerIntervalMs}ms</Text>
        </Box>
        {path && (
          <Text color="gray">
            Source file: {path}
          </Text>
        )}
      </Box>
    </Box>
  );
};
