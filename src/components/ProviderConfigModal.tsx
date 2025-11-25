import React from 'react';
import { Box, Text } from 'ink';
import { MenuSurface, MenuHint, MenuSearchInput } from './menu/MenuPrimitives.js';

type ProviderKey = 'ollama' | 'openrouter';

interface ProviderConfigModalProps {
  visible: boolean;
  provider: ProviderKey;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const ProviderConfigModal = ({
  visible,
  provider,
  value,
  onChange,
  onSubmit,
  onCancel,
}: ProviderConfigModalProps) => {
  if (!visible) return null;

  const meta =
    provider === 'ollama'
      ? {
          title: 'Configure Ollama',
          description: 'Set the base URL (including port) for your Ollama server.',
          label: 'Ollama URL',
          placeholder: 'http://localhost:11434',
          borderColor: 'green',
        }
      : {
          title: 'Configure OpenRouter',
          description: 'Enter your OpenRouter API key to enable hosted models.',
          label: 'API key',
          placeholder: 'sk-or-v1-...',
          borderColor: 'magenta',
        };

  return (
    <MenuSurface
      title={meta.title}
      borderColor={meta.borderColor}
      footer={<MenuHint text="Enter to save · Esc cancel" />}
    >
      <Box flexDirection="column" gap={1} paddingX={1}>
        <Text color="gray">{meta.description}</Text>
        <MenuSearchInput
          label={meta.label}
          value={value}
          onChange={onChange}
          onSubmit={() => onSubmit()}
          placeholder={meta.placeholder}
          isFocused={true}
        />
        {provider === 'openrouter' && (
          <Text color="gray" dimColor>
            Stored locally in .jamcli/config.json
          </Text>
        )}
      </Box>
    </MenuSurface>
  );
};
