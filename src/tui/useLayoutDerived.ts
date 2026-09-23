import { useEffect, useMemo } from 'react';
import type { ModelInfo } from '../types/config.js';
import type { LayoutContext } from './useLayoutContext.js';

export interface LayoutDerived {
  isInputFocused: boolean;
  showSuggestions: boolean;
  modelMenuWindowSize: number;
  modelMenuReservedLines: number;
  headerMode: 'standard' | 'compact' | 'minimal';
  layoutPaddingX: number;
  layoutPaddingY: number;
  layoutGap: number;
  displayCwd: string;
  currentModelName: string;
  collapsedPasteSummary: { label: string; detail: string } | null;
  filteredModelList: ModelInfo[];
}

export function useLayoutDerived(ctx: LayoutContext, suggestions: { length: number }): LayoutDerived {
  const {
    collapsedPaste,
    modelMenuState,
    setModelMenuState,
    sessionMenuState,
    configWizard,
    pendingAction,
    inputValue,
    terminalSize,
    activeProfile,
  } = ctx;

  const isInputFocused =
    !collapsedPaste &&
    !modelMenuState.open &&
    !sessionMenuState.open &&
    !configWizard &&
    !pendingAction;
  const showSuggestions = isInputFocused && inputValue.startsWith('/') && suggestions.length > 0;
  const terminalRows = terminalSize.rows ?? 24;
  const modelMenuWindowSize = Math.max(5, Math.min(18, Math.floor((terminalRows - 10) / 2)));
  const modelMenuReservedLines = modelMenuState.open ? Math.max(8, modelMenuWindowSize + 6) : 0;
  const headerMode: 'standard' | 'compact' | 'minimal' =
    terminalRows <= 18 ? 'minimal' : terminalRows <= 28 ? 'compact' : 'standard';
  const layoutPaddingX = headerMode === 'minimal' ? 0 : 1;
  const layoutPaddingY = headerMode === 'minimal' ? 0 : 1;
  const layoutGap = headerMode === 'standard' ? 1 : 0;
  const cwd = process.cwd();
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const displayCwd = homeDir && cwd.startsWith(homeDir)
    ? `~${cwd.slice(homeDir.length)}`
    : cwd;

  const currentModelName = activeProfile?.preferred_model || 'No Model';

  const collapsedPasteSummary = collapsedPaste
    ? {
        label: `[Paste #${collapsedPaste.id} – ${collapsedPaste.lineCount} ${collapsedPaste.lineCount === 1 ? 'line' : 'lines'}]`,
        detail: `${collapsedPaste.charCount.toLocaleString()} chars · Enter sends · Ctrl+E expands · Esc cancels`,
      }
    : null;

  const filteredModelList = useMemo(() => {
    const query = modelMenuState.searchQuery.trim().toLowerCase();
    if (!query) {
      return modelMenuState.models;
    }

    return modelMenuState.models.filter((model) => {
      const description = model.description?.toLowerCase() ?? '';
      return (
        model.name.toLowerCase().includes(query) ||
        model.provider.toLowerCase().includes(query) ||
        description.includes(query)
      );
    });
  }, [modelMenuState.models, modelMenuState.searchQuery]);

  useEffect(() => {
    if (!modelMenuState.open) return;

    setModelMenuState((prev) => {
      if (!prev.open) return prev;
      const maxIndex = Math.max(0, filteredModelList.length - 1);

      if (filteredModelList.length === 0) {
        return prev.selectedIndex === 0 ? prev : { ...prev, selectedIndex: 0 };
      }

      if (prev.selectedIndex > maxIndex) {
        return { ...prev, selectedIndex: maxIndex };
      }

      return prev;
    });
  }, [filteredModelList.length, modelMenuState.open, setModelMenuState]);

  return {
    isInputFocused,
    showSuggestions,
    modelMenuWindowSize,
    modelMenuReservedLines,
    headerMode,
    layoutPaddingX,
    layoutPaddingY,
    layoutGap,
    displayCwd,
    currentModelName,
    collapsedPasteSummary,
    filteredModelList,
  };
}
