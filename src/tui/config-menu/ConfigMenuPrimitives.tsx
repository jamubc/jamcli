import React from 'react';
import { Box, Text } from 'ink';
import type { FocusArea } from './menuModel.js';

export const SplitMenuSurface = ({
  title,
  subtitle,
  borderColor = 'cyan',
  leftPanel,
  rightPanel,
  footer,
  width = 100,
}: {
  title: string;
  subtitle?: string;
  borderColor?: string;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) => {
  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      marginY={1}
      gap={1}
      width={width}
    >
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text color={borderColor} bold>
          {title}
        </Text>
        {subtitle && <Text color="gray">{subtitle}</Text>}
      </Box>
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" width="50%">
          {leftPanel}
        </Box>
        <Box width={1} flexDirection="column">
           <Box height="100%" borderStyle="single" borderLeft={false} borderTop={false} borderBottom={false} borderRightColor="gray" />
        </Box>
        <Box flexDirection="column" width="50%" paddingLeft={1}>
          {rightPanel}
        </Box>
      </Box>
      {footer && <Box>{footer}</Box>}
    </Box>
  );
};

export const StyleListItem = ({
  label,
  meta,
  isFocused,
  isActive,
  accentColor,
  hotkey,
}: {
  label: string;
  meta?: string;
  isFocused: boolean;
  isActive: boolean;
  accentColor: string;
  hotkey?: string;
}) => {
  const foreground = isFocused ? 'black' : 'white';
  const metaColor = isActive ? 'green' : isFocused ? 'black' : 'gray';
  const badgeColor = isFocused ? 'black' : 'yellow';

  return (
    <Box paddingX={1} paddingY={0} backgroundColor={isFocused ? accentColor : undefined}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={isFocused ? 'black' : 'gray'}>{isFocused ? '>' : ' '}</Text>
        <Box flexDirection="row" flexGrow={1} justifyContent="space-between">
          <Text color={foreground} bold={isFocused || isActive}>
            {isActive ? '✓ ' : ''}
            {label}
          </Text>
          {meta && (
            <Text color={metaColor} dimColor={!isFocused && !isActive}>
              {meta}
            </Text>
          )}
        </Box>
        {hotkey && <Text color={badgeColor}>{hotkey}</Text>}
      </Box>
    </Box>
  );
};

export const SectionDivider = () => (
  <Box paddingX={1}>
    <Text color="gray">{'-'.repeat(36)}</Text>
  </Box>
);

export const HelpBar = ({ focusArea }: { focusArea: FocusArea }) => (
  <Box paddingX={1} paddingY={0} backgroundColor="gray">
    <Text color="black">
      ↑/↓ Navigate · Enter Apply · / Search · Tab Switch Pane · Esc Cancel · Pane: {focusArea === 'left' ? 'List' : 'Preview'}
    </Text>
  </Box>
);
