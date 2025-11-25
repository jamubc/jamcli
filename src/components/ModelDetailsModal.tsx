import React from 'react';
import { Box, Text } from 'ink';
import { MenuSurface, MenuHint, MenuEmptyState } from './menu/MenuPrimitives.js';
import type { ModelInfo } from '../types/config.js';

interface ModelDetailsModalProps {
  visible: boolean;
  model: ModelInfo | null;
}

export const ModelDetailsModal = ({ visible, model }: ModelDetailsModalProps) => {
  if (!visible || !model) return null;

  return (
    <MenuSurface
      title={model.name}
      subtitle={`Provider: ${model.provider}`}
      borderColor="blue"
      footer={<MenuHint text="← back • Esc close" />}
    >
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text color="gray">Identifier: {model.id}</Text>
        {typeof model.supports_tool_calling === 'boolean' && (
          <Text color={model.supports_tool_calling ? 'green' : 'yellow'}>
            Tool calling: {model.supports_tool_calling ? 'Supported' : 'Not advertised'}
          </Text>
        )}
        {model.description ? (
          <Text>{model.description}</Text>
        ) : (
          <MenuEmptyState message="No description provided for this model." />
        )}
      </Box>
    </MenuSurface>
  );
};
