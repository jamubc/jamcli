import { useInput } from 'ink';
import { CONFIGURE_ENTRY_ID } from './layoutState.js';
import type { CollapsedPastePreview } from './layoutState.js';
import type { Action } from '../store/index.js';
import type { InlineNotice } from './useInlineNotice.js';

interface InputDeps {
  collapsedPaste: CollapsedPastePreview | null;
  exitConfirmation: boolean;
  isProcessing: boolean;
  configWizard: unknown;
  isConfigMenuOpen: boolean;
  modelMenuState: { open: boolean; searchQuery: string };
  modelDetail: unknown;
  filteredModelList: { id: string }[];
  safeModelMenuIndex: number;
  pendingAction: Action | null;
  showSuggestions: boolean;
  suggestions: { name: string }[];
  selectedSuggestion: number;
  inputValue: string;
  setInputValue: (value: string) => void;
  setCollapsedPaste: (value: CollapsedPastePreview | null) => void;
  setIsExpandedView: (updater: (prev: boolean) => boolean) => void;
  setModelDetail: (model: any) => void;
  setSelectedSuggestion: (updater: (prev: number) => number) => void;
  setAutoApproveActions: (value: boolean) => void;
  clearInlineNotice: () => void;
  showInlineNotice: (notice: InlineNotice) => void;
  handleInputSubmit: (payload: string) => void;
  handleCtrlC: () => void;
  cancelCurrentRequest: (reason: 'escape' | 'ctrl+c') => boolean;
  cancelConfigWizard: () => void;
  handleModelSearchChange: (query: string) => void;
  handleModelMenuSubmit: (model: any) => void;
  handleConfirmAction: () => void;
  handleRejectAction: () => void;
  clearExitConfirmation: () => void;
}

export function useLayoutInput({
  collapsedPaste,
  exitConfirmation,
  isProcessing,
  configWizard,
  isConfigMenuOpen,
  modelMenuState,
  modelDetail,
  filteredModelList,
  safeModelMenuIndex,
  pendingAction,
  showSuggestions,
  suggestions,
  selectedSuggestion,
  inputValue,
  setInputValue,
  setCollapsedPaste,
  setIsExpandedView,
  setModelDetail,
  setSelectedSuggestion,
  setAutoApproveActions,
  clearInlineNotice,
  showInlineNotice,
  handleInputSubmit,
  handleCtrlC,
  cancelCurrentRequest,
  cancelConfigWizard,
  handleModelSearchChange,
  handleModelMenuSubmit,
  handleConfirmAction,
  handleRejectAction,
  clearExitConfirmation,
}: InputDeps) {
  const submitCollapsedPaste = () => {
    if (!collapsedPaste) return;
    const payload = collapsedPaste.content;
    setCollapsedPaste(null);
    void handleInputSubmit(payload);
  };

  const discardCollapsedPaste = () => {
    if (!collapsedPaste) return;
    setCollapsedPaste(null);
    setInputValue('');
  };

  const expandCollapsedPaste = () => {
    if (!collapsedPaste) return;
    setInputValue(collapsedPaste.content);
    setCollapsedPaste(null);
  };

  const isProcessingValue = isProcessing;

  useInput((input, key) => {
    const isCtrlC = input === '\u0003' || (key.ctrl && input?.toLowerCase() === 'c');
    const isCtrlR = key.ctrl && (input?.toLowerCase() === 'r' || (key as any).raw === '\u0012');

    if (collapsedPaste) {
      if (key.return) {
        submitCollapsedPaste();
        return;
      }
      if (key.escape) {
        discardCollapsedPaste();
        return;
      }
      if (key.ctrl && input?.toLowerCase() === 'e') {
        expandCollapsedPaste();
        return;
      }
      return;
    }

    if (exitConfirmation && !isCtrlC) {
      clearExitConfirmation();
    }

    if (isCtrlC) {
      handleCtrlC();
      return;
    }

    if (isProcessingValue && key.escape) {
      cancelCurrentRequest('escape');
      return;
    }

    if (isCtrlR) {
      const previousValue = inputValue;
      setIsExpandedView((prev) => !prev);

      setTimeout(() => {
        setInputValue(previousValue);
      }, 0);
      return;
    }

    if (configWizard) {
      if (key.escape) {
        cancelConfigWizard();
      }
      return;
    }

    if (isConfigMenuOpen) {
      return;
    }

    if (modelMenuState.open) {
      if (modelDetail) {
        if (key.escape || key.leftArrow) {
          setModelDetail(null);
          return;
        }

        if (!key.ctrl && !key.meta) {
          const isPrintable = !!input && input.length === 1 && /[\x20-\x7E]/.test(input);
          if (key.backspace || input === '\u007f') {
            if (modelMenuState.searchQuery.length > 0) {
              handleModelSearchChange(modelMenuState.searchQuery.slice(0, -1));
            }
            return;
          }
          if (isPrintable) {
            handleModelSearchChange(`${modelMenuState.searchQuery}${input}`);
            return;
          }
        }

        return;
      }

      if (key.rightArrow) {
        const activeModel = filteredModelList[safeModelMenuIndex];
        if (activeModel) {
          if (activeModel.id === CONFIGURE_ENTRY_ID) {
            handleModelMenuSubmit(activeModel);
          } else {
            setModelDetail(activeModel);
          }
        }
        return;
      }

      if (!key.ctrl && !key.meta) {
        const isPrintable = !!input && input.length === 1 && /[\x20-\x7E]/.test(input);
        if (key.backspace || input === '\u007f') {
          if (modelMenuState.searchQuery.length > 0) {
            handleModelSearchChange(modelMenuState.searchQuery.slice(0, -1));
          }
          return;
        }
        if (isPrintable) {
          handleModelSearchChange(`${modelMenuState.searchQuery}${input}`);
          return;
        }
      }
    }

    if (pendingAction) {
      const normalized = input.toLowerCase();
      if (key.return || normalized === '1' || normalized === 'y') {
        handleConfirmAction();
        clearInlineNotice();
      } else if (normalized === '2') {
        setAutoApproveActions(true);
        showInlineNotice({
          message: 'Auto-approving tool actions for this session.',
          tone: 'info',
          kind: 'sticky',
        });
        handleConfirmAction();
      } else if (normalized === '3' || normalized === 'n' || normalized === 'd') {
        handleRejectAction();
        clearInlineNotice();
      }
      return;
    }

    if (showSuggestions && suggestions.length > 0) {
      if (key.downArrow) {
        setSelectedSuggestion((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (key.upArrow) {
        setSelectedSuggestion((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (key.tab) {
        const suggestion = suggestions[selectedSuggestion];
        if (suggestion) {
          setInputValue(`${suggestion.name} `);
        }
        return;
      }
      if (key.escape) {
        setInputValue('');
        return;
      }
    }
  });

  return { submitCollapsedPaste, discardCollapsedPaste, expandCollapsedPaste, isProcessing: isProcessingValue };
}
