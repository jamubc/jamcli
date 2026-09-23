import { useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  CONFIG_SUBCOMMANDS,
  CONFIGURE_ENTRY_ID,
  SLASH_COMMANDS,
} from './layoutState.js';
import type { SlashCommand } from './InputBar.js';
import type { ModelInfo, Profile } from '../types/config.js';

export type UseSuggestionsOptions = {
  inputValue: string;
  activeProfile: Profile | null;
  availableModels: ModelInfo[];
  menuModels: ModelInfo[];
  recentModelsRef: { current: string[] };
  setSelectedSuggestion: Dispatch<SetStateAction<number>>;
};

export function useSuggestions({
  inputValue,
  activeProfile,
  availableModels,
  menuModels,
  recentModelsRef,
  setSelectedSuggestion,
}: UseSuggestionsOptions) {
  const suggestionData = useMemo(() => {
    if (!inputValue.startsWith('/')) return { list: [] as SlashCommand[], hint: null as string | null };
    const needle = inputValue.toLowerCase();

    // Inline model suggestions when user typed "/model " or started a model name.
    const modelParts = inputValue.trimStart().toLowerCase().split(/\s+/);
    const isModelCommand = modelParts[0] === '/model';
    const hasModelQuery = isModelCommand && (inputValue.endsWith(' ') || modelParts.length > 1);

    if (isModelCommand && hasModelQuery) {
      const query = modelParts.slice(1).join(' ').trim().toLowerCase();
      const preferredProvider = activeProfile?.preferred_provider;
      if (!preferredProvider) return { list: [], hint: null };

      const sourceModels = (availableModels.length ? availableModels : menuModels).filter(
        (m) => m.id !== CONFIGURE_ENTRY_ID
      );
      const providerFiltered = sourceModels.filter((m) => m.provider === preferredProvider);

      const filteredModels = providerFiltered.filter((model) => {
        if (!query) return true;
        const description = model.description?.toLowerCase() ?? '';
        const haystack = `${model.id} ${model.name}`.toLowerCase();
        return haystack.includes(query) || description.includes(query);
      });

      const recency = recentModelsRef.current;
      const sorted = filteredModels.sort((a, b) => {
        const aIdx = recency.indexOf(a.id);
        const bIdx = recency.indexOf(b.id);
        if (aIdx !== bIdx) {
          if (aIdx === -1) return 1;
          if (bIdx === -1) return -1;
          return aIdx - bIdx;
        }
        return a.name.localeCompare(b.name);
      });

      const list = sorted.slice(0, 10).map((model) => ({
        name: `/model ${model.id}`,
        description: model.provider,
      }));
      const hint = 'Need another provider? Use /model to open the menu.';
      return { list, hint };
    }

    const parts = needle.split(' ');
    if (parts.length === 1) {
      return { list: SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(needle)), hint: null };
    }

    if (parts[0] === '/config' && parts.length === 2) {
      const subcommandNeedle = parts[1];
      const list = CONFIG_SUBCOMMANDS.filter((cmd) => cmd.name.startsWith(subcommandNeedle))
        .map((cmd) => ({ name: `/config ${cmd.name}`, description: cmd.description }));
      return { list, hint: null };
    }

    return { list: [], hint: null };
  }, [inputValue, activeProfile?.preferred_provider, availableModels, menuModels]);

  const suggestions = suggestionData.list;
  const suggestionHint = suggestionData.hint;

  useEffect(() => {
    setSelectedSuggestion(0);
  }, [suggestions.length]);

  return { suggestions, suggestionHint };
}
