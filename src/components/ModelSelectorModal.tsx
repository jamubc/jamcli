import React, { useMemo } from 'react';
import { Box } from 'ink';
import { MenuSurface, MenuSectionHeader, MenuOptionRow, MenuSearchInput, MenuHint, MenuEmptyState } from './menu/MenuPrimitives.js';
import type { ModelInfo } from '../types/config.js';

interface ModelSelectorModalProps {
  visible: boolean;
  models: ModelInfo[];
  totalCount: number;
  selectedIndex: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  maxVisibleItems?: number;
  isSearchFocused?: boolean;
  configureEntryId?: string;
}

export const ModelSelectorModal = ({
  visible,
  models,
  totalCount,
  selectedIndex,
  searchQuery,
  onSearchChange,
  maxVisibleItems = 12,
  isSearchFocused = true,
  configureEntryId = '__configure__',
}: ModelSelectorModalProps) => {
  if (!visible) return null;

  const selectedModelId = models[selectedIndex]?.id;
  const windowSize = Math.max(1, Math.min(maxVisibleItems, Math.max(1, models.length)));

  let windowStart = Math.max(0, selectedIndex - Math.floor(windowSize / 2));
  if (windowStart + windowSize > models.length) {
    windowStart = Math.max(0, models.length - windowSize);
  }

  const windowedModels = models.slice(windowStart, windowStart + windowSize);
  const configureEntries = windowedModels.filter((model) => model.id === configureEntryId);
  const providerModels = windowedModels.filter((model) => model.id !== configureEntryId);

  const groupedModels = useMemo(() => {
    return providerModels.reduce<Record<string, ModelInfo[]>>((groups, model) => {
      if (!groups[model.provider]) {
        groups[model.provider] = [];
      }
      groups[model.provider].push(model);
      return groups;
    }, {});
  }, [providerModels]);

  const providerEntries = Object.entries(groupedModels);
  const hasAnyModels = totalCount > 0;
  const hasVisibleModels = windowedModels.length > 0;
  const visibleStart = hasVisibleModels ? windowStart + 1 : 0;
  const visibleEnd = hasVisibleModels ? windowStart + windowedModels.length : 0;
  const footerRange = hasVisibleModels
    ? `Showing ${visibleStart}-${visibleEnd} of ${models.length}${searchQuery ? ' matching' : ''}`
    : `0 of ${models.length} matching`;
  const subtitle =
    searchQuery && searchQuery.trim().length > 0
      ? `filter: ${searchQuery}`
      : `${totalCount} available`;

  return (
    <MenuSurface
      title="Select AI Model"
      subtitle={subtitle}
      borderColor="cyan"
      footer={
        <Box flexDirection="column" gap={0}>
          <MenuHint text={`${footerRange}`} />
          <MenuHint text="↑/↓ navigate • → details • Enter select • Esc cancel" />
        </Box>
      }
    >
      <MenuSearchInput
        value={searchQuery}
        onChange={onSearchChange}
        placeholder="Type to filter models"
        isFocused={isSearchFocused}
        editable={true}
      />

      {!hasAnyModels ? (
        <MenuEmptyState message="No providers configured. Add a provider or start Ollama." color="red" />
      ) : hasVisibleModels ? (
        <Box flexDirection="column" gap={0}>
          {configureEntries.map((model) => {
            const isSelected = model.id === selectedModelId;
            return (
              <MenuOptionRow
                key={model.id}
                label={model.name}
                description={model.description}
                isSelected={isSelected}
                accentColor="magenta"
              />
            );
          })}
          {providerEntries.map(([provider, providerModels], providerIdx) => (
            <React.Fragment key={provider}>
              <MenuSectionHeader label={provider.toUpperCase()} marginTop={providerIdx === 0 ? 0 : 1} />
              {providerModels.map((model) => {
                const isSelected = model.id === selectedModelId;
                return (
                  <MenuOptionRow
                    key={model.id}
                    label={model.name}
                    meta={model.provider}
                    isSelected={isSelected}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </Box>
      ) : (
        <MenuEmptyState message="No models match your search." />
      )}
    </MenuSurface>
  );
};
