import { useCallback } from 'react';
import { useMountInit } from './useMountInit.js';
import { useMcpPanels } from './useMcpPanels.js';
import { useMenusActions } from './useMenusActions.js';
import { useToolConversation } from './useToolConversation.js';
import { useSlashCommands } from './useSlashCommands.js';
import { forkSession } from '../core/session/store.js';
import { useChatSubmit } from './useChatSubmit.js';
import { useLayoutInput } from './useLayoutInput.js';
import type { LayoutContext } from './useLayoutContext.js';
import type { LayoutDerived } from './useLayoutDerived.js';
import type { LayoutPanels } from './useLayoutPanels.js';

export function useLayoutActions(ctx: LayoutContext, derived: LayoutDerived, panels: LayoutPanels) {
  const {
    messages,
    pendingAction,
    status,
    config,
    activeProfile,
    addMessage,
    updateLastMessage,
    setConfig,
    setActiveProfile,
    setStatus,
    setPendingAction,
    initializeHistory,
    persistTurn,
    replaceMessages,
    getSessionId,
    incrementModelTokenUsage,
    initializeModelTokenUsage,
    inputValue,
    setInputValue,
    collapsedPaste,
    setCollapsedPaste,
    selectedSuggestion,
    setSelectedSuggestion,
    availableModels,
    setAvailableModels,
    modelMenuState,
    setModelMenuState,
    sessionMenuState,
    setSessionMenuState,
    isConfigMenuOpen,
    setIsConfigMenuOpen,
    modelDetail,
    setModelDetail,
    configWizard,
    setIsExpandedView,
    exitConfirmation,
    autoApproveActions,
    setAutoApproveActions,
    mcpServers,
    setMcpTestResults,
    testService,
    clearInlineNotice,
    showInlineNotice,
    abortControllerRef,
    cancelReasonRef,
    coreApprovalRef,
    modelsUsedRef,
    toolServiceRef,
    configServiceRef,
    modelServiceRef,
    mcpManagerRef,
    projectRoot,
  } = ctx;
  const configService = configServiceRef.current;
  const modelService = modelServiceRef.current;
  const mcpManager = mcpManagerRef.current;

  const {
    filteredModelList,
    showSuggestions,
  } = derived;

  const {
    refreshStatusStyles,
    performExit,
    openSessionMenu,
    openModelMenu,
    reopenModelMenu,
    refreshAvailableModels,
    handleModelSwitch,
    openStatusStyleMenu,
    openConfigMenu,
    cancelConfigWizard,
    handleModelSearchChange,
    handleCtrlC,
    cancelCurrentRequest,
    clearExitConfirmation,
    suggestions,
  } = panels;

  const refreshMcpServers = useCallback(async () => {
    if (!configService) return [];
    try {
      const servers = await configService.listMcpServers();
      ctx.setMcpServers(servers);
      return servers;
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to load MCP servers: ${error.message}`,
        timestamp: Date.now(),
      });
      return [];
    }
  }, [addMessage]);

  useMountInit({
    projectRoot,
    setConfig,
    setActiveProfile,
    setAvailableModels,
    setStatusStyle: ctx.setStatusStyle,
    refreshStatusStyles,
    refreshMcpServers,
    initializeHistory,
    configServiceRef,
    toolServiceRef,
    modelServiceRef,
    mcpManagerRef,
  });

  const {
    openAddMcpWizard,
    openEditMcpWizard,
    handleMcpWizardSubmit,
    handleTestMcpServer,
    handleTestAllMcpServers,
    copyMcpConfigPath,
    openMcpConfigFile,
  } = useMcpPanels({
    configService,
    mcpManager,
    testService,
    projectRoot,
    configWizard,
    mcpServers,
    addMessage,
    setConfigWizard: ctx.setConfigWizard,
    setMcpTestResults,
    refreshMcpServers,
    openConfigMenu,
  });

  const {
    handleConfigMenuSubmit,
    handleModelMenuSubmit,
    isModelDetailOpen,
    safeModelMenuIndex,
    safeSessionMenuIndex,
    sessionTotalPages,
    copyConversation,
    performToolCall,
    handleConfirmAction,
    handleRejectAction,
  } = useMenusActions({
    modelMenuState,
    sessionMenuState,
    modelDetail,
    filteredModelList,
    messages,
    mcpManager,
    pendingAction,
    coreApprovalRef,
    toolServiceRef,
    setModelDetail,
    setModelMenuState,
    setSessionMenuState,
    setPendingAction,
    addMessage,
    openConfigMenu,
    closeModelMenu: panels.closeModelMenu,
    closeSessionMenu: panels.closeSessionMenu,
    handleModelSwitch,
    handleSessionResume: panels.handleSessionResume,
    handleSessionSearch: panels.handleSessionSearch,
    changeSessionPage: panels.changeSessionPage,
  });

  const { runToolEnabledConversation } = useToolConversation({
    mcpManager,
    activeProfile,
    config,
    projectRoot,
    autoApproveActions,
    coreApprovalRef,
    addMessage,
    updateLastMessage,
    setStatus,
    setPendingAction,
    persistTurn,
    incrementModelTokenUsage,
    performToolCall,
  });

  const { handleCommand } = useSlashCommands({
    messages,
    config,
    activeProfile,
    status,
    projectRoot,
    modelService,
    configService,
    mcpManager,
    setIsConfigMenuOpen,
    setIsExpandedView,
    setModelDetail,
    replaceMessages,
    addMessage,
    performExit,
    openSessionMenu,
    showToolStatus: panels.showToolStatus,
    updateToolPermissionSetting: panels.updateToolPermissionSetting,
    showMcpServers: panels.showMcpServers,
    showMcpTools: panels.showMcpTools,
    upsertMcpServer: panels.upsertMcpServer,
    removeMcpServer: panels.removeMcpServer,
    openConfigMenu,
    showSystemPrompt: panels.showSystemPrompt,
    updateSystemPromptSetting: panels.updateSystemPromptSetting,
    showProviderSettings: panels.showProviderSettings,
    updateProviderSetting: panels.updateProviderSetting,
    copyConversation,
    openStatusStyleMenu,
    setStatus,
    setAvailableModels,
    getSessionId,
    forkSession,
    initializeHistory,
    openModelMenu,
    reopenModelMenu,
    refreshAvailableModels,
    handleModelSwitch,
  });

  const { handleInputSubmit } = useChatSubmit({
    collapsedPaste,
    isConfigMenuOpen,
    projectRoot,
    messages,
    activeProfile,
    config,
    abortControllerRef,
    cancelReasonRef,
    modelsUsedRef,
    setInputValue,
    setCollapsedPaste,
    clearInlineNotice,
    showInlineNotice,
    handleCommand,
    addMessage,
    updateLastMessage,
    setStatus,
    replaceMessages,
    showMcpTools: panels.showMcpTools,
    persistTurn,
    incrementModelTokenUsage,
    initializeModelTokenUsage,
    runToolEnabledConversation,
  });

  const { isProcessing } = useLayoutInput({
    collapsedPaste,
    exitConfirmation,
    isProcessing: status === 'thinking' || status === 'streaming',
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
  });

  return {
    mcpPanels: {
      openAddMcpWizard,
      openEditMcpWizard,
      handleMcpWizardSubmit,
      handleTestMcpServer,
      handleTestAllMcpServers,
      copyMcpConfigPath,
      openMcpConfigFile,
    },
    menusActions: {
      handleConfigMenuSubmit,
      handleModelMenuSubmit,
      isModelDetailOpen,
      safeModelMenuIndex,
      safeSessionMenuIndex,
      sessionTotalPages,
      copyConversation,
      performToolCall,
      handleConfirmAction,
      handleRejectAction,
    },
    handleCommand,
    handleInputSubmit,
    runToolEnabledConversation,
    isProcessing,
  };
}

export type LayoutActions = ReturnType<typeof useLayoutActions>;
