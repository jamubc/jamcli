import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useStore } from '../store/index.js';
import { DEFAULT_SHIMMER_COLORS, DEFAULT_SPINNER_FRAMES, useColorSpinner } from '../hooks/useStatusIndicator.js';
import { DEFAULT_STATUS_STYLE } from '../styles/statusStyles.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';

type HeaderMode = 'standard' | 'compact' | 'minimal';

interface HeaderProps {
  mode?: HeaderMode;
  statusStyle?: StatusStyleDefinition;
}

export const Header = ({ mode = 'standard', statusStyle }: HeaderProps) => {
  const activeProfile = useStore((s) => s.activeProfile);
  const config = useStore((s) => s.config);
  const status = useStore((s) => s.status);
  const getSessionUsage = useStore((s) => s.getSessionUsage);
  const modelTokenUsage = useStore((s) => s.modelTokenUsage);
  const sessionUsage = getSessionUsage();
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

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
  const statusLabel = status === 'thinking' ? 'thinking' : status === 'streaming' ? 'streaming' : 'ready';
  const statusGlyph = status === 'idle' ? 'o' : spinner?.frame || DEFAULT_SPINNER_FRAMES[0];
  const glyphColor = status === 'idle' ? palette[0] || 'green' : spinner?.color || palette[0] || 'green';
  const statusBadge = (withLabel: boolean = true) => (
    <Box flexDirection="row" gap={1} alignItems="center">
      <Text color={glyphColor}>{statusGlyph}</Text>
      {withLabel && (
        <Text color={shimmerEnabled ? undefined : palette[0] || 'white'} bold={!shimmerEnabled}>
          {statusLabel}
        </Text>
      )}
    </Box>
  );
  const availableProviders = Object.keys(config?.api_registry || {}).filter(
    (key) => config?.api_registry[key as keyof typeof config.api_registry]
  );
  const fallbackProvider = availableProviders[0] || 'ollama';
  const providerName = activeProfile?.preferred_provider || fallbackProvider;
  const activeModelKey = activeProfile?.preferred_model
    ? `${providerName}:${activeProfile.preferred_model}`
    : null;
  const activeModelTokens = activeModelKey && modelTokenUsage[activeModelKey]
    ? modelTokenUsage[activeModelKey].total_tokens
    : 0;
  const activeModelLabel = activeProfile?.preferred_model || 'N/A';

  const truncateMiddle = (value: string, max: number) => {
    if (!value) return '';
    if (value.length <= max) return value;
    if (max <= 3) return value.slice(0, max);
    const half = Math.max(1, Math.floor((max - 3) / 2));
    return `${value.slice(0, half)}...${value.slice(-half)}`;
  };

  const profileBudget = Math.max(8, Math.min(20, Math.floor(columns * 0.28)));
  const modelProviderBudget = Math.max(12, Math.min(36, Math.floor(columns * 0.45)));

  const renderModelProvider = (budget: number) => {
    const safeBudget = Math.max(10, budget);
    const modelBudget = Math.max(4, Math.min(safeBudget - 6, Math.floor((safeBudget - 1) * 0.55)));
    const providerBudget = Math.max(4, safeBudget - 1 - modelBudget);
    const modelText = truncateMiddle(activeModelLabel, modelBudget);
    const providerText = truncateMiddle(providerName, providerBudget);
    return (
      <Text>
        <Text color="yellow" bold>
          {modelText}
        </Text>
        <Text color="gray">:</Text>
        <Text color="magenta">{providerText}</Text>
      </Text>
    );
  };

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
          Profile:{' '}
          <Text color="green" bold>
            {truncateMiddle(activeProfile?.name || 'Loading...', profileBudget)}
          </Text>
        </Text>
        <Text color="gray">
          {renderModelProvider(Math.max(14, Math.min(modelProviderBudget, 24)))}
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
            {truncateMiddle(activeProfile?.name || 'Loading...', profileBudget)}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {renderModelProvider(Math.max(16, modelProviderBudget - 6))}
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
      flexWrap="wrap"
      gap={2}
      justifyContent="space-between"
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
          {truncateMiddle(activeProfile?.name || 'Loading...', profileBudget)}
        </Text>
      </Box>

      <Box flexDirection="row" gap={1} alignItems="center">
        {renderModelProvider(Math.max(18, modelProviderBudget))}
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

      {statusBadge(true)}
    </Box>
  );
};
