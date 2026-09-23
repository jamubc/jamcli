import { useCallback } from 'react';
import { useInfoPanels } from './useInfoPanels.js';
import { useTextInput } from './useTextInput.js';
import { useStatusStyles } from './useStatusStyles.js';
import { useSuggestions } from './useSuggestions.js';
import { useStatusTracking, useExitHandling } from './useStatusExit.js';
import { useModelSessionMenus } from './useModelSessionMenus.js';
import { useConfigWizard } from './useConfigWizard.js';
import type { StatusStyleOption } from './StatusStyleModal.js';
import type { LayoutContext } from './useLayoutContext.js';

export function useLayoutPanels(ctx: LayoutContext) {
  const {
    messages,
    status,
    activeProfile,
    addMessage,
    setConfig,
    setActiveProfile,
    setUiConfig,
    setStatusDetail,
    uiConfig,
    inputValue,
    collapsedPaste,
    selectedSuggestion,
    setInputValue,
    setCollapsedPaste,
    setSelectedSuggestion,
    availableModels,
    modelMenuState,
    setModelMenuState,
    sessionMenuState,
    setSessionMenuState,
    setIsConfigMenuOpen,
    modelDetail,
    setModelDetail,
    configWizard,
    setConfigWizard,
    setExitConfirmation,
    modelTokenUsage,
    setStatusStyle,
    setStatusStyleOptions,
    showInlineNotice,
    abortControllerRef,
    cancelReasonRef,
    exitResetTimeoutRef,
    exitConfirmationRef,
    sessionStartRef,
    modelsUsedRef,
    recentModelsRef,
    returnToModelMenuRef,
    statusLineIndexRef,
    configServiceRef,
    modelServiceRef,
    mcpManagerRef,
    getSessionUsage,
    resumeSession,
    initializeModelTokenUsage,
    exit,
    projectRoot,
    terminalSize,
  } = ctx;
  const configService = configServiceRef.current;
  const modelService = modelServiceRef.current;
  const mcpManager = mcpManagerRef.current;

  const {
    showToolStatus,
    showMcpServers,
    showMcpTools,
    upsertMcpServer,
    removeMcpServer,
    updateToolPermissionSetting,
    showProviderSettings,
    updateProviderSetting,
    showConfigMenu,
    showSystemPrompt,
    updateSystemPromptSetting,
  } = useInfoPanels({ configService, mcpManager, addMessage, setConfig, setActiveProfile, setMcpServers: ctx.setMcpServers, projectRoot });

  const handleTextInputChange = useTextInput({
    collapsedPaste,
    inputValueRef: ctx.inputValueRef,
    pasteBufferRef: ctx.pasteBufferRef,
    pasteCounterRef: ctx.pasteCounterRef,
    terminalSize,
    setInputValue,
    setCollapsedPaste,
    showInlineNotice,
  });

  const {
    refreshStatusStyles,
    applyTextStyle,
    applySpinnerStyle,
    addCustomStatusStyle,
    openStatusStyleFolderMessage,
  } = useStatusStyles({ configService, uiConfig, addMessage, setUiConfig, setStatusStyle, setStatusStyleOptions });

  const { suggestions, suggestionHint } = useSuggestions({
    inputValue,
    activeProfile,
    availableModels,
    menuModels: modelMenuState.models,
    recentModelsRef,
    setSelectedSuggestion,
  });

  const openStatusStyleMenu = useCallback(async () => {
    if (!configService) {
      addMessage({ role: 'system', content: 'Configuration service is still initializing. Try again shortly.', timestamp: Date.now() });
      return;
    }
    await refreshStatusStyles();
    setIsConfigMenuOpen(true);
    // We might want to signal ConfigMenuScreen to open directly to 'style' tab, 
    // but for now let's just open the main menu or we can add a prop to ConfigMenuScreen to set initial tab.
    // However, the user asked for /config to open the menu. 
    // If they run /config style, we might want to jump there.
    // For now, let's just open the config menu.
  }, [addMessage, refreshStatusStyles]);

  const handleStatusStyleSubmit = useCallback(
    async (option?: StatusStyleOption) => {
      if (!option) return;
      if (option.kind === 'action') {
        if (option.id === 'add_custom') {
          await addCustomStatusStyle();
        } else if (option.id === 'manage_custom') {
          openStatusStyleFolderMessage();
        }
        return;
      }

      if (option.kind === 'text') {
        await applyTextStyle(option.id);
      } else if (option.kind === 'spinner') {
        await applySpinnerStyle(option.id);
      }

      if (option.source === 'custom' && option.path) {
        addMessage({
          role: 'system',
          content: `Edit this custom style at ${option.path} to tweak colors/spinner.`,
          timestamp: Date.now(),
        });
      }
      // Don't close menu here, let user keep exploring
    },
    [addCustomStatusStyle, addMessage, applySpinnerStyle, applyTextStyle, openStatusStyleFolderMessage]
  );

  const { recordModelUsage } = useStatusTracking({
    status,
    activeProfile,
    statusLineIndexRef,
    setStatusDetail,
    recentModelsRef,
    modelsUsedRef,
    initializeModelTokenUsage,
  });

  const { cancelCurrentRequest, clearExitConfirmation, performExit, handleCtrlC } = useExitHandling({
    status,
    activeProfile,
    messages,
    modelTokenUsage,
    modelsUsedRef,
    sessionStartRef,
    abortControllerRef,
    cancelReasonRef,
    exitResetTimeoutRef,
    exitConfirmationRef,
    setExitConfirmation,
    getSessionUsage,
    exit,
  });

  const {
    openModelMenu,
    closeModelMenu,
    openSessionMenu,
    closeSessionMenu,
    handleSessionSearch,
    handleModelSearchChange,
    changeSessionPage,
    handleSessionResume: handleSessionResumeBase,
    handleModelSwitch,
    refreshAvailableModels,
    updateToolModelFilterSetting,
    reopenModelMenu,
  } = useModelSessionMenus({
    activeProfile,
    projectRoot,
    modelService,
    configService,
    addMessage,
    setConfig,
    setActiveProfile,
    setAvailableModels: ctx.setAvailableModels,
    setModelDetail,
    setModelMenuState,
    setSessionMenuState,
    setConfigWizard,
    setIsConfigMenuOpen,
    modelMenuState,
    sessionMenuState,
    configWizard,
    modelDetail,
    recordModelUsage,
    resumeSession,
  });
  const handleSessionResume = (sessionId: string) => handleSessionResumeBase(sessionId, messages);

  const {
    openConfigMenu,
    closeConfigMenu,
    updateConfigWizardForm,
    cancelConfigWizard,
    removeProvider,
    handleConfigWizardSubmit,
  } = useConfigWizard({
    configService,
    configWizard,
    addMessage,
    setConfig,
    setConfigWizard,
    setIsConfigMenuOpen,
    returnToModelMenuRef,
    refreshStatusStyles,
    refreshAvailableModels,
    reopenModelMenu,
  });

  return {
    showToolStatus,
    showMcpServers,
    showMcpTools,
    upsertMcpServer,
    removeMcpServer,
    updateToolPermissionSetting,
    showProviderSettings,
    updateProviderSetting,
    showConfigMenu,
    showSystemPrompt,
    updateSystemPromptSetting,
    handleTextInputChange,
    refreshStatusStyles,
    openStatusStyleMenu,
    handleStatusStyleSubmit,
    suggestions,
    suggestionHint,
    cancelCurrentRequest,
    clearExitConfirmation,
    performExit,
    handleCtrlC,
    openModelMenu,
    closeModelMenu,
    openSessionMenu,
    closeSessionMenu,
    handleSessionSearch,
    handleModelSearchChange,
    changeSessionPage,
    handleModelSwitch,
    refreshAvailableModels,
    updateToolModelFilterSetting,
    reopenModelMenu,
    handleSessionResume,
    openConfigMenu,
    closeConfigMenu,
    updateConfigWizardForm,
    cancelConfigWizard,
    removeProvider,
    handleConfigWizardSubmit,
  };
}

export type LayoutPanels = ReturnType<typeof useLayoutPanels>;
