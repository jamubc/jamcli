import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store/index.js';
import { DEFAULT_SHIMMER_COLORS, DEFAULT_SPINNER_FRAMES, useColorSpinner, useShimmerTick } from '../hooks/useStatusIndicator.js';
import { DEFAULT_STATUS_STYLE } from '../styles/statusStyles.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';

type HeaderMode = 'standard' | 'compact' | 'minimal';

interface HeaderProps {
  mode?: HeaderMode;
  statusStyle?: StatusStyleDefinition;
}

export const Header = ({ mode = 'standard', statusStyle }: HeaderProps) => {
  const { activeProfile, config, status, getSessionUsage, modelTokenUsage } = useStore();
  const sessionUsage = getSessionUsage();

  const activeStyle = statusStyle || DEFAULT_STATUS_STYLE;
  const palette = activeStyle.shimmerColors?.length ? activeStyle.shimmerColors : DEFAULT_SHIMMER_COLORS;
  const spinnerColors = activeStyle.spinnerColors?.length ? activeStyle.spinnerColors : palette;
  const shimmerEnabled = status !== 'idle' && (activeStyle.shimmer ?? true);
  const spinner = useColorSpinner(
    activeStyle.spinnerFrames,
    status !== 'idle',
    spinnerColors,
    activeStyle.spinnerIntervalMs
  );
  const shimmerTick = useShimmerTick(shimmerEnabled);
  const statusLabel = status === 'thinking' ? 'thinking' : status === 'streaming' ? 'streaming' : 'ready';
  const statusGlyph = status === 'idle' ? 'o' : spinner?.frame || DEFAULT_SPINNER_FRAMES[0];
  const glyphColor = status === 'idle' ? palette[0] || 'green' : spinner?.color || palette[0] || 'green';
  const statusBadge = (withLabel: boolean = true) => (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text color={glyphColor}>{statusGlyph}</Text>
      {withLabel && (
        <Text>
          {statusLabel.split('').map((char, idx) => {
            const color = shimmerEnabled ? palette[(idx + shimmerTick) % palette.length] : palette[0] || 'white';
            return (
              <Text key={`${char}-${idx}`} color={color} bold>
                {char}
              </Text>
            );
          })}
        </Text>
      )}
    </Box>
  );
  const providerName =
    Object.keys(config?.api_registry || {}).find(
      (key) => config?.api_registry[key as keyof typeof config.api_registry]
    ) || 'Ollama';
  const activeProvider = activeProfile?.preferred_provider || 'ollama';
  const activeModelKey = activeProfile?.preferred_model
    ? `${activeProvider}:${activeProfile.preferred_model}`
    : null;
  const activeModelTokens = activeModelKey && modelTokenUsage[activeModelKey]
    ? modelTokenUsage[activeModelKey].total_tokens
    : 0;
  const activeModelLabel = activeProfile?.preferred_model || 'N/A';

  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  if (mode === 'minimal') {
    return (
      <Box
        width="100%"
        borderStyle="single"
        borderColor="blue"
        paddingX={1}
        paddingY={0}
        flexDirection="column"
        gap={0}
        marginBottom={0}
      >
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color="blue" bold>
            jamcli (v1.0)
          </Text>
          {statusBadge(true)}
        </Box>
        <Text color="gray">
          {activeProfile?.name ? `Profile: ${activeProfile.name}` : 'Loading profile...'}
        </Text>
        <Text color="gray">
          {activeModelLabel} · {providerName}
        </Text>
        <Text color="cyan">
          Model tokens: {formatTokens(activeModelTokens)}
        </Text>
        {sessionUsage && sessionUsage.totalTokens > 0 && (
          <Text color="gray" dimColor>
            Session tokens: {formatTokens(sessionUsage.totalTokens)}
          </Text>
        )}
      </Box>
    );
  }

  if (mode === 'compact') {
    return (
      <Box
        width="100%"
        borderStyle="single"
        borderColor="blue"
        paddingX={1}
        paddingY={0}
        flexDirection="column"
        gap={0}
        marginBottom={1}
      >
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color="blue" bold>
            jamcli (v1.0)
          </Text>
          {statusBadge(false)}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="gray">Profile:</Text>
          <Text color="green" bold>
            {activeProfile?.name || 'Loading...'}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="gray">Model:</Text>
          <Text color="yellow" bold>
            {activeModelLabel}
          </Text>
          <Text color="gray">| Provider:</Text>
          <Text color="magenta">{providerName}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text color="gray">Model tokens:</Text>
          <Text color="cyan">{formatTokens(activeModelTokens)}</Text>
        </Box>
        {sessionUsage && sessionUsage.totalTokens > 0 && (
          <Box flexDirection="row" gap={1}>
            <Text color="gray">Session tokens:</Text>
            <Text color="cyan">{formatTokens(sessionUsage.totalTokens)}</Text>
            <Text color="gray" dimColor>
              ({sessionUsage.callCount} calls)
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box
      width="100%"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      paddingY={0}
      flexDirection="row"
      justifyContent="space-between"
      gap={2}
      marginBottom={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text color="blue" bold>
          jamcli
        </Text>
        <Text color="gray">(v1.0)</Text>
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text color="gray">Profile:</Text>
        <Text color="green" bold>
          {activeProfile?.name || 'Loading...'}
        </Text>
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text color="gray">Model:</Text>
        <Text color="yellow" bold>
          {activeModelLabel}
        </Text>
        <Text color="gray">| Provider:</Text>
        <Text color="magenta">{providerName}</Text>
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text color="gray">Model tokens:</Text>
        <Text color="cyan">{formatTokens(activeModelTokens)}</Text>
      </Box>

      {sessionUsage && sessionUsage.totalTokens > 0 && (
        <Box flexDirection="row" gap={1}>
          <Text color="gray">Session tokens:</Text>
          <Text color="cyan">{formatTokens(sessionUsage.totalTokens)}</Text>
        </Box>
      )}

      <Box flexDirection="row" gap={1}>
        <Text color="gray">Status:</Text>
        {statusBadge(true)}
      </Box>
    </Box>
  );
};
