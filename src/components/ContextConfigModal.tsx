import React from 'react';
import { Box, Text } from 'ink';
import { MenuSurface, MenuHint, MenuSearchInput } from './menu/MenuPrimitives.js';

interface ContextConfigModalProps {
  visible: boolean;
  field: 'max_tokens' | 'compression_threshold';
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const ContextConfigModal = ({
  visible,
  field,
  value,
  onChange,
  onSubmit,
  onCancel,
}: ContextConfigModalProps) => {
  if (!visible) return null;

  const meta =
    field === 'max_tokens'
      ? {
          title: 'Context Limit',
          description: 'Set the maximum number of tokens before compression triggers.',
          label: 'Max Tokens',
          placeholder: '8000',
        }
      : {
          title: 'Compression Threshold',
          description: 'Trigger compression when context reaches this fraction (0.5 - 1.0).',
          label: 'Threshold',
          placeholder: '0.9',
        };

  return (
    <MenuSurface
      title={meta.title}
      borderColor="cyan"
      footer={<MenuHint text="Enter to save · Esc cancel" />}
    >
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text color="gray">{meta.description}</Text>
        <MenuSearchInput
          label={meta.label}
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={meta.placeholder}
          isFocused={true}
        />
      </Box>
    </MenuSurface>
  );
};