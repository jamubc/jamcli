import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import clipboard from 'clipboardy';
import { spawn } from 'child_process';
import path from 'path';
import { Header } from './Header.js';
import { ChatViewport } from './ChatViewport.js';
import { InputBar } from './InputBar.js';
import { ActionModal } from './ActionModal.js';
import { ModelSelectorModal } from './ModelSelectorModal.js';
import { ModelDetailsModal } from './ModelDetailsModal.js';
import { SessionSelectorModal } from './SessionSelectorModal.js';
import { ConfigMenuScreen } from './ConfigMenuScreen.js';
import { StatusStyleOption } from './StatusStyleModal.js';
import { ProviderConfigModal } from './ProviderConfigModal.js';
import { McpServerModal, type McpServerForm } from './McpServerModal.js';
import { useStore } from '../store/index.js';
import type { Action } from '../store/index.js';
import type { Message, TokenUsage } from '../core/types.js';
import { useMenuNavigation } from './useMenuNavigation.js';
import { useInlineNotice } from './useInlineNotice.js';
import { useSuggestions } from './useSuggestions.js';
import { useTextInput } from './useTextInput.js';
import { useLayoutContext } from './useLayoutContext.js';
import { useInfoPanels } from './useInfoPanels.js';
import { useStatusStyles } from './useStatusStyles.js';
import { useStatusTracking, useExitHandling } from './useStatusExit.js';
import { useMountInit } from './useMountInit.js';
import { useModelSessionMenus } from './useModelSessionMenus.js';
import { useConfigWizard } from './useConfigWizard.js';
import { useMcpPanels } from './useMcpPanels.js';
import { useMenusActions } from './useMenusActions.js';
import { useToolConversation } from './useToolConversation.js';
import { McpTestService } from '../services/McpTestService.js';
import { ContextManager } from '../core/context/manager.js';
import { LLMFactory, type ToolCall as LlmToolCall } from '../services/LLMProvider.js';
import { CoreAgent } from '../core/agent.js';
import { adaptLegacyProvider } from '../core/providers/legacy.js';
import { createSession } from '../core/state.js';
import type { ChatMessage } from '../core/types.js';
import { buildSystemPrompt, buildToolAvailabilityPrompt } from '../core/prompt.js';
import { isMcpToolQuery, selectToolsForQuery, userQueryNeedsTools } from '../core/sensor.js';
import { FileSystemService } from '../services/FileSystemService.js';
import { ExecutionService } from '../services/ExecutionService.js';
import { HistoryService, SessionMetadata } from '../services/HistoryService.js';
import type { Config, ModelInfo, Profile, ToolPermission, UiConfig } from '../types/config.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import type { ToolCall, ToolResult, ToolName } from '../types/tools.js';
import { ALL_TOOL_NAMES, SAFE_TOOL_NAMES, TOOL_DEFINITIONS } from '../types/tools.js';
import type { McpServerConfig, McpTestResult, McpToolDescriptor } from '../types/mcp.js';
import {
  DEFAULT_CUSTOM_STYLE,
  listStatusSpinnerStyleOptions,
  listStatusTextStyleOptions,
  resolveSpinnerStyle,
  resolveStatusStyle,
  resolveTextStyle,
  StatusStyleDefinition,
  StatusSpinnerStyleDefinition,
  StatusTextStyleDefinition,
} from '../styles/statusStyles.js';
import { resolveJamcliProjectRoot } from '../utils/projectRoot.js';
import { resolveAtReferences, type AtReference, type MissingAtReference } from '../utils/atReferences.js';

import {
  CONFIGURE_ENTRY_ID,
  CONFIGURE_MODELS_ENTRY,
  initialModelMenuState,
  initialSessionMenuState,
  MCP_COMMAND_USAGE,
  PROVIDER_COMMAND_USAGE,
  resetTerminalViewport,
  SESSION_PAGE_SIZE,
  STREAMING_STATUS_LINES,
  THINKING_STATUS_LINES,
  TOOL_COMMAND_USAGE,
} from './layoutState.js';
import type {
  AgentLoopState,
  CollapsedPastePreview,
  ConfigWizardState,
  ModelMenuState,
  ProviderSlug,
  SessionMenuState,
  StatusDetail,
} from './layoutState.js';
import {
  describeToolMode,
  formatProviderSummary,
  formatToolStatusTable,
  maskKey,
  normalizeProvider,
  normalizeToolIdentifier,
  truncateOutput,
} from './layoutFormat.js';

export const Layout = () => {
  const ctx = useLayoutContext();
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
    setUiConfig,
    setStatus,
    setPendingAction,
    initializeHistory,
    persistTurn,
    replaceMessages,
    getSessionUsage,
    resumeSession,
    modelTokenUsage,
    incrementModelTokenUsage,
    initializeModelTokenUsage,
    clearModelTokenUsage,
    uiConfig,
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
    setConfigWizard,
    isExpandedView,
    setIsExpandedView,
    exitConfirmation,
    setExitConfirmation,
    autoApproveActions,
    setAutoApproveActions,
    mcpServers,
    setMcpServers,
    mcpTestResults,
    setMcpTestResults,
    testService,
    statusDetail,
    setStatusDetail,
    statusStyle,
    setStatusStyle,
    statusStyleOptions,
    setStatusStyleOptions,
    inlineNotice,
    showInlineNotice,
    clearInlineNotice,
    abortControllerRef,
    cancelReasonRef,
    coreApprovalRef,
    exitResetTimeoutRef,
    exitConfirmationRef,
    isProcessingRef,
    sessionStartRef,
    modelsUsedRef,
    recentModelsRef,
    prefetchingModelsRef,
    returnToModelMenuRef,
    inputValueRef,
    pasteCounterRef,
    pasteBufferRef,
    prevContextEnabledRef,
    statusLineIndexRef,
    toolServiceRef,
    configServiceRef,
    modelServiceRef,
    mcpManagerRef,
    exit,
    stdout,
    terminalSize,
    setTerminalSize,
    projectRoot,
    defaultMcpConfigPath,
  } = ctx;
  const configService = configServiceRef.current;
  const modelService = modelServiceRef.current;
  const mcpManager = mcpManagerRef.current;

  useEffect(() => {
    if (!stdout || !stdout.isTTY) return;
    try {
      stdout.write('\x1b[?2004h');
    } catch {
      // no-op
    }
    return () => {
      try {
        stdout.write('\x1b[?2004l');
      } catch {
        // no-op
      }
    };
  }, [stdout]);

  useEffect(() => {
    const ctxEnabled = config?.context_management?.enabled ?? false;
    const previous = prevContextEnabledRef.current;
    prevContextEnabledRef.current = ctxEnabled;
    const thresholdPct = Math.round(((config?.context_management?.compression_threshold ?? 0.9) * 100));
    const maxTokens = config?.context_management?.max_tokens ?? 8000;

    if (previous === undefined && !ctxEnabled) return;
    if (previous === ctxEnabled) return;

    showInlineNotice({
      message: ctxEnabled
        ? `Context compression on (${thresholdPct}% of ${maxTokens} tokens).`
        : 'Context compression off.',
      tone: 'info',
      kind: 'clear_input',
    });
  }, [config?.context_management, showInlineNotice]);

  useEffect(() => {
    if (!pendingAction) {
      return;
    }

    const description =
      pendingAction.type === 'shell_exec'
        ? pendingAction.params.command
        : pendingAction.type === 'tool_call'
          ? `Call ${pendingAction.params.tool || pendingAction.params.descriptor?.name || 'tool'}`
          : `Edit ${pendingAction.params.path}`;
    showInlineNotice({
      message: `Action pending: ${description} | [1] [Yes] (Enter) [2] [Yes, don't ask again] [3] [No, change something]`,
      tone: 'warning',
      kind: 'sticky',
    });
  }, [pendingAction, showInlineNotice]);

  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue, availableModels, modelMenuState.models, activeProfile?.preferred_provider]);

  useEffect(() => {
    clearModelTokenUsage();
  }, [clearModelTokenUsage]);

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
  } = useInfoPanels({ configService, mcpManager, addMessage, setConfig, setActiveProfile, setMcpServers });

  const handleTextInputChange = useTextInput({
    collapsedPaste,
    inputValueRef,
    pasteBufferRef,
    pasteCounterRef,
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

  useEffect(() => {
    const wantsModelSuggestions = inputValue.toLowerCase().startsWith('/model');
    if (!wantsModelSuggestions || availableModels.length > 0 || !modelService || prefetchingModelsRef.current) {
      return;
    }

    prefetchingModelsRef.current = true;
    const loadModels = async () => {
      try {
        const models = await modelService.listAvailableModels();
        setAvailableModels(models);
      } catch {
        // Ignore; user can still open the model menu to see any errors.
      } finally {
        prefetchingModelsRef.current = false;
      }
    };

    void loadModels();
  }, [inputValue, availableModels.length]);

  useEffect(() => {
    return () => {
      if (exitResetTimeoutRef.current) {
        clearTimeout(exitResetTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    exitConfirmationRef.current = exitConfirmation;
  }, [exitConfirmation]);

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      setTerminalSize({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    };

    stdout.on('resize', handleResize);
    return () => {
      if (typeof stdout.off === 'function') {
        stdout.off('resize', handleResize);
      } else {
        stdout.removeListener('resize', handleResize);
      }
    };
  }, [stdout]);

  useEffect(() => {
    if (stdout) {
      setTerminalSize({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    }
  }, [stdout]);

  const { recordModelUsage } = useStatusTracking({
    status,
    activeProfile,
    statusLineIndexRef,
    setStatusDetail,
    recentModelsRef,
    modelsUsedRef,
    initializeModelTokenUsage,
  });

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
    setAvailableModels,
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

  const refreshMcpServers = useCallback(async () => {
    if (!configService) return [];
    try {
      const servers = await configService.listMcpServers();
      setMcpServers(servers);
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
    setStatusStyle,
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
    setConfigWizard,
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
    closeModelMenu,
    closeSessionMenu,
    handleModelSwitch,
    handleSessionResume,
    handleSessionSearch,
    changeSessionPage,
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

  const handleCommand = async (text: string) => {
    if (!text.startsWith('/')) return false;

    const [cmd, ...args] = text.trim().split(/\s+/);
    const command = cmd.toLowerCase();

    switch (command) {
      case '/clear':
        setIsConfigMenuOpen(false);
        resetTerminalViewport();
        setIsExpandedView(false);
        replaceMessages([]);
        return true;
      case '/help':
        setIsConfigMenuOpen(false);
        addMessage({
          role: 'system',
          content:
            'Available commands:\n/model <name> - Switch AI model\n/profile <name> - Switch profile\n/resume - Resume a previous session\n/tools [action] - Manage tool permissions\n/config [prompt|menu] - Inspect or edit settings\n/copy [o] [count] - Copy chat (o = model output)\n/clear - Clear chat history\n/help - Show this help\n/exit - Exit JamCLI',
          timestamp: Date.now(),
        });
        return true;
      case '/exit':
        performExit();
        return true;
      case '/resume':
        setIsConfigMenuOpen(false);
        await openSessionMenu();
        return true;
      case '/profile':
        setIsConfigMenuOpen(false);
        addMessage({
          role: 'system',
          content: 'Profile switching not yet implemented',
          timestamp: Date.now(),
        });
        return true;
      case '/tools': {
        setIsConfigMenuOpen(false);
        const action = (args[0] || 'status').toLowerCase();
        if (['status', 'list', 'show'].includes(action)) {
          await showToolStatus();
          return true;
        }

        const targetArg = args[1];
        if (!targetArg) {
          addMessage({ role: 'system', content: TOOL_COMMAND_USAGE, timestamp: Date.now() });
          return true;
        }

        const toolName = normalizeToolIdentifier(targetArg);
        if (!toolName) {
          addMessage({ role: 'system', content: `Unknown tool: ${targetArg}`, timestamp: Date.now() });
          return true;
        }

        if (['enable', 'allow', 'on'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: true, require_approval: false }, 'enabled');
          return true;
        }

        if (['disable', 'deny', 'off'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: false, require_approval: false }, 'disabled');
          return true;
        }

        if (['require', 'approve', 'ask'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: true, require_approval: true }, 'now requires approval');
          return true;
        }

        if (['auto', 'trust'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: true, require_approval: false }, 'set to auto-approve');
          return true;
        }

        addMessage({ role: 'system', content: TOOL_COMMAND_USAGE, timestamp: Date.now() });
        return true;
      }
      case '/mcp': {
        setIsConfigMenuOpen(false);
        const action = (args[0] || 'servers').toLowerCase();
        if (['servers', 'list'].includes(action)) {
          await showMcpServers();
          return true;
        }
        if (action === 'tools') {
          await showMcpTools();
          return true;
        }
        if (action === 'add') {
          const [id, command, ...rest] = args.slice(1);
          if (!id || !command) {
            addMessage({ role: 'system', content: 'Usage: /mcp add <id> <command> [args...]', timestamp: Date.now() });
            return true;
          }
          await upsertMcpServer(id, command, rest);
          return true;
        }
        if (action === 'remove') {
          const id = args[1];
          if (!id) {
            addMessage({ role: 'system', content: 'Usage: /mcp remove <id>', timestamp: Date.now() });
            return true;
          }
          await removeMcpServer(id);
          return true;
        }
        addMessage({ role: 'system', content: MCP_COMMAND_USAGE, timestamp: Date.now() });
        return true;
      }
      case '/config': {
        const action = (args[0] || 'menu').toLowerCase();
        if (action === 'prompt') {
          const promptAction = (args[1] || 'show').toLowerCase();
          if (promptAction === 'show') {
            await showSystemPrompt();
            return true;
          }
          if (promptAction === 'set') {
            const nextPrompt = args.slice(2).join(' ').trim();
            if (!nextPrompt) {
              addMessage({ role: 'system', content: 'Usage: /config prompt set <new prompt text>', timestamp: Date.now() });
              return true;
            }
            await updateSystemPromptSetting(nextPrompt);
            return true;
          }
          addMessage({ role: 'system', content: 'Supported prompt commands: show, set', timestamp: Date.now() });
          return true;
        }
        if (action === 'style' || action === 'status') {
          await openStatusStyleMenu();
          return true;
        }
        if (action === 'provider') {
          const providerAction = (args[1] || 'list').toLowerCase();
          if (providerAction === 'list') {
            await showProviderSettings();
            return true;
          }
          if (providerAction === 'set') {
            const provider = normalizeProvider(args[2]);
            if (!provider) {
              addMessage({ role: 'system', content: 'Unknown provider. Supported: ollama, openrouter.', timestamp: Date.now() });
              return true;
            }
            const value = args.slice(3).join(' ').trim();
            await updateProviderSetting(provider, value);
            return true;
          }
          addMessage({ role: 'system', content: PROVIDER_COMMAND_USAGE, timestamp: Date.now() });
          return true;
        }
        await openConfigMenu();
        return true;
      }
      case '/compact': {
        setIsConfigMenuOpen(false);
        const currentMessages = messages;
        const currentConfig = config;
        const currentProfile = activeProfile;

        if (status !== 'idle') {
          addMessage({ role: 'system', content: 'Cannot compact while busy.', timestamp: Date.now() });
          return true;
        }

        addMessage({ role: 'system', content: 'Compacting conversation history...', timestamp: Date.now() });
        setStatus('thinking');

        try {
          const providerKey = currentProfile?.preferred_provider === 'openrouter' ? 'openrouter' : 'ollama';
          const providerConfig =
            providerKey === 'openrouter'
              ? currentConfig?.api_registry.openrouter || {}
              : currentConfig?.api_registry.ollama || {};

          const provider = LLMFactory.createProvider(providerKey, providerConfig);
          const modelId = currentProfile?.preferred_model || 'default';

          const result = await ContextManager.manageContext(
            currentMessages,
            currentConfig?.context_management,
            adaptLegacyProvider(provider),
            modelId,
            true
          );

          if (result.context !== currentMessages) {
            replaceMessages(result.context);
            addMessage({
              role: 'system',
              content: result.systemNotice || 'Context compacted.',
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              role: 'system',
              content: 'Context is already optimized or too short to compact.',
              timestamp: Date.now(),
            });
          }
        } catch (error: any) {
          addMessage({ role: 'system', content: `Compaction failed: ${error.message}`, timestamp: Date.now() });
        } finally {
          setStatus('idle');
        }
        return true;
      }
      case '/copy': {
        setIsConfigMenuOpen(false);
        const firstArg = args[0]?.toLowerCase();
        const onlyModel = firstArg === 'o' || firstArg === '0';
        const limitArg = onlyModel ? args[1] : args[0];

        if (limitArg) {
          const parsedLimit = parseInt(limitArg, 10);
          if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
            addMessage({
              role: 'system',
              content: 'Usage: /copy [o] [count]\nExamples: /copy, /copy o, /copy o 3',
              timestamp: Date.now(),
            });
            return true;
          }
          await copyConversation({ onlyModel, limit: parsedLimit });
          return true;
        }

        await copyConversation({ onlyModel });
        return true;
      }
      case '/model': {
        if (!modelService) {
          addMessage({
            role: 'system',
            content: 'Model service is still initializing. Try again shortly.',
            timestamp: Date.now(),
          });
          return true;
        }

        if (args.length > 0) {
          setIsConfigMenuOpen(false);
          await handleModelSwitch(args[0]);
          return true;
        }

        try {
          const models = await modelService.listAvailableModels();
          setAvailableModels(models);
          if (models.length === 0) {
            addMessage({
              role: 'system',
              content: 'No models available. Configure Ollama or add an API key to list providers.',
              timestamp: Date.now(),
            });
            return true;
          }
          setIsConfigMenuOpen(false);
          openModelMenu(models);
        } catch (error: any) {
          addMessage({
            role: 'system',
            content: `Failed to list models: ${error.message}`,
            timestamp: Date.now(),
          });
        }
        return true;
      }
      default:
        addMessage({
          role: 'system',
          content: `Unknown command: ${cmd}. Type /help for available commands.`,
          timestamp: Date.now(),
        });
        return true;
    }
  };

  const formatAtReferenceMessage = (reference: AtReference) => {
    const header =
      reference.type === 'file'
        ? `📄 Included file: ${reference.displayPath}`
        : `📂 Directory listing: ${reference.displayPath}`;
    const meta =
      reference.type === 'file'
        ? `Size: ${reference.size?.toLocaleString() ?? 'unknown'} bytes${reference.truncated ? ' (truncated)' : ''}`
        : `Entries: ${reference.listingCount ?? 'unknown'}${reference.truncated ? ' (partial)' : ''}`;
    const content = reference.content || '<empty>';
    const body = reference.type === 'file' && reference.truncated ? `${content}\n… <file truncated>` : content;
    return `${header}\n${meta}\n\n${body}`;
  };

  const formatMissingAtReferenceMessage = (missing: MissingAtReference) =>
    `⚠️ Unable to include ${missing.raw} (${missing.absolutePath}): ${missing.reason}`;

  const handleInputSubmit = async (rawValue: string) => {
    if (collapsedPaste) {
      setInputValue(collapsedPaste.content);
      setCollapsedPaste(null);
      clearInlineNotice();
      return;
    }

    const text = rawValue.trim();
    if (!text) {
      setInputValue('');
      return;
    }

    // If config menu is open, only allow slash commands
    if (isConfigMenuOpen && !text.startsWith('/')) {
      setInputValue('');
      return;
    }

    setInputValue('');
    if (await handleCommand(text)) {
      return;
    }

    const referenceOperations = await resolveAtReferences(text, projectRoot);
    for (const operation of referenceOperations) {
      const timestamp = Date.now();
      if (operation.kind === 'missing') {
        addMessage({
          role: 'system',
          content: formatMissingAtReferenceMessage(operation.missing),
          timestamp,
        });
        continue;
      }
      addMessage({
        role: 'system',
        content: formatAtReferenceMessage(operation.reference),
        timestamp,
      });
    }

    addMessage({ role: 'user', content: text, timestamp: Date.now() });
    // Short-circuit simple MCP tool visibility questions to avoid unnecessary tool calls.
    if (isMcpToolQuery(text)) {
      await showMcpTools();
      return;
    }

    setStatus('thinking');

    const baseMessages = messages;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    cancelReasonRef.current = null;

    try {
      const providerKey = activeProfile?.preferred_provider === 'openrouter' ? 'openrouter' : 'ollama';
      const providerConfig =
        providerKey === 'openrouter'
          ? config?.api_registry.openrouter || {}
          : config?.api_registry.ollama || {};

      const provider = LLMFactory.createProvider(providerKey as 'ollama' | 'openrouter', providerConfig);
      const modelId = activeProfile?.preferred_model || 'default';

      const managed = await ContextManager.manageContext(
        baseMessages,
        config?.context_management,
        adaptLegacyProvider(provider),
        modelId,
        false
      );
      const contextNotice = managed.systemNotice?.trim();
      const contextForModel = managed.context;

      if (contextNotice) {
        showInlineNotice({
          message: contextNotice,
          tone: contextNotice.startsWith('⚠') ? 'warning' : 'info',
          kind: 'sticky',
        });
      }

      if (managed.context !== baseMessages) {
        replaceMessages(managed.context);
      }

      const conversationProvider = activeProfile?.preferred_provider || providerKey;
      const conversationModelName = activeProfile?.preferred_model || 'unknown-model';
      const modelUsageKey = `${conversationProvider}:${conversationModelName}`;
      modelsUsedRef.current.add(modelUsageKey);
      initializeModelTokenUsage(modelUsageKey);

      const needsTools = userQueryNeedsTools(text);
      const canUseTools = providerKey === 'openrouter' && needsTools;
      if (canUseTools) {
        const handled = await runToolEnabledConversation({
          provider,
          contextForModel,
          modelUsageKey,
          modelName: activeProfile?.preferred_model,
          signal: controller.signal,
          userText: text,
        });
        if (handled) {
          return;
        }
      }

      addMessage({
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        model: activeProfile?.preferred_model,
        modelName: activeProfile?.preferred_model,
        streaming: true,
      });

      const systemPromptMessage: Message = {
        role: 'system',
        content: buildSystemPrompt(activeProfile),
        timestamp: Date.now(),
      };
      const streamMessages =
        contextForModel[0]?.role === 'system' ? contextForModel : [systemPromptMessage, ...contextForModel];

      let fullContent = '';
      let fullReasoning = '';
      let buffer = '';
      let reasoningBuffer = '';
      const BUFFER_SIZE = 50;
      let hasContent = false;
      let finalUsage: TokenUsage | undefined;
      let hasStartedStreaming = false;

      const streamSession = createSession(projectRoot, 'tui-stream');
      const streamAgent = new CoreAgent({
        provider: adaptLegacyProvider(provider),
        model: activeProfile?.preferred_model,
        temperature: activeProfile?.temperature,
        modelUsageKey,
        signal: controller.signal,
      });
      streamSession.messages.push(...streamMessages.map((m) => ({ ...m })));
      const streamResult = await streamAgent.run(streamSession, '', (event) => {
        if (event.type === 'text' && event.delta) {
          if (!hasStartedStreaming) {
            setStatus('streaming');
            hasStartedStreaming = true;
          }
          buffer += event.delta;
          hasContent = true;
        }
        if (event.type === 'reasoning' && event.delta) {
          if (!hasStartedStreaming) {
            setStatus('streaming');
            hasStartedStreaming = true;
          }
          reasoningBuffer += event.delta;
        }
        if (event.type === 'usage') {
          finalUsage = event.usage;
        }
        if (buffer.length >= BUFFER_SIZE || reasoningBuffer.length >= BUFFER_SIZE) {
          fullContent += buffer;
          fullReasoning += reasoningBuffer;
          updateLastMessage(fullContent, undefined, { reasoning: fullReasoning });
          buffer = '';
          reasoningBuffer = '';
        }
      });
      void streamResult;
      if (buffer.length > 0) {
        fullContent += buffer;
      }
      if (reasoningBuffer.length > 0) {
        fullReasoning += reasoningBuffer;
      }

      if (!hasContent) {
        updateLastMessage(
          (() => {
            const modelName = activeProfile?.preferred_model || 'selected model';
            const base = `No content returned from ${modelName} yet.`;
            const hint =
              providerKey === 'ollama'
                ? ` The model may still be warming up or pulling. If this repeats, try: ollama pull ${modelName}.`
                : ' If this keeps happening, check your API key or network settings.';
            return base + hint;
          })(),
          undefined,
          { streaming: false }
        );
      } else {
        updateLastMessage(fullContent, finalUsage, { streaming: false, reasoning: fullReasoning });
        // Persist the conversation turn to history
        await persistTurn();
        if (finalUsage) {
          incrementModelTokenUsage(modelUsageKey, finalUsage);
        }
      }

    } catch (error: any) {
      if (error?.name === 'AbortError') {
        const reason = cancelReasonRef.current;
        const cancelledMessage = reason === 'escape' ? '⏸️ Request cancelled by user.' : '⛔ Request cancelled.';
        const latestMessages = messages;
        const last = latestMessages[latestMessages.length - 1];
        if (last?.role === 'assistant') {
          const content = last.content ? `${last.content}\n\n${cancelledMessage}` : cancelledMessage;
          updateLastMessage(content, undefined, { streaming: false });
        } else {
          addMessage({ role: 'system', content: cancelledMessage, timestamp: Date.now() });
        }
        return;
      }

      const errorMsg = `❌ Error: ${error.message}\n\nPossible causes:\n- Provider is not running\n- Model not available (download with: ollama pull ${
        activeProfile?.preferred_model || 'llama3'
      })`;
      updateLastMessage(errorMsg, undefined, { streaming: false });
    } finally {
      abortControllerRef.current = null;
      cancelReasonRef.current = null;
      setStatus('idle');
    }
  };

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

  const isProcessing = status === 'thinking' || status === 'streaming';

  useInput((input, key) => {
    const isCtrlC = input === '\u0003' || (key.ctrl && input?.toLowerCase() === 'c');
    // Ctrl+R typically sends \u0012 in raw mode
    const isCtrlR = key.ctrl && (input?.toLowerCase() === 'r' || key.raw === '\u0012');

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

    if (isProcessing && key.escape) {
      cancelCurrentRequest('escape');
      return;
    }

    if (isCtrlR) {
      const previousValue = inputValue; // Capture current value
      setIsExpandedView((prev) => !prev);

      // Restore input value in next tick to overwrite any "r" or control char that TextInput might have captured
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

  return (
    <Box flexDirection="column" paddingX={layoutPaddingX} paddingY={layoutPaddingY} gap={layoutGap}>
      <Header mode={headerMode} statusStyle={statusStyle} />
      <ChatViewport
        isExpanded={isExpandedView}
        reservedLineBoost={modelMenuReservedLines}
        status={status}
        statusDetail={statusDetail}
        statusStyle={statusStyle}
      />
      {modelMenuState.open && (
        <ModelSelectorModal
          visible={modelMenuState.open}
          models={filteredModelList}
          totalCount={modelMenuState.models.length}
          selectedIndex={safeModelMenuIndex}
          searchQuery={modelMenuState.searchQuery}
          onSearchChange={handleModelSearchChange}
          maxVisibleItems={modelMenuWindowSize}
          isSearchFocused={!isModelDetailOpen}
          configureEntryId={CONFIGURE_ENTRY_ID}
        />
      )}
      {modelMenuState.open && modelDetail && <ModelDetailsModal visible={true} model={modelDetail} />}
      {isConfigMenuOpen && config && (
        <ConfigMenuScreen
          visible={isConfigMenuOpen}
          config={config}
          uiConfig={uiConfig}
          currentStatusStyle={statusStyle}
          statusStyleOptions={statusStyleOptions}
          onClose={closeConfigMenu}
          onUpdateProvider={(provider) => {
            setIsConfigMenuOpen(false);
            setConfigWizard({
              mode: 'provider',
              provider,
              form: {
                endpoint: provider === 'ollama' ? config?.api_registry?.ollama?.endpoint || 'http://localhost:11434' : '',
                apiKey: '',
              },
            });
          }}
          onRemoveProvider={removeProvider}
          onSelectStatusStyle={(option, _index) => void handleStatusStyleSubmit(option)}
          onUpdateSystemPrompt={(prompt) => void updateSystemPromptSetting(prompt)}
          isCommandMode={inputValue.startsWith('/')}
          systemPrompt={activeProfile?.system_prompt_override}
          onToggleToolModelFilter={(enabled) => void updateToolModelFilterSetting(enabled)}
          mcpServers={mcpServers}
          mcpTestResults={mcpTestResults}
          mcpConfigPath={configService?.getMcpConfigPath() || defaultMcpConfigPath}
          onAddMcpServer={openAddMcpWizard}
          onEditMcpServer={openEditMcpWizard}
          onRemoveMcpServer={(server) => void removeMcpServer(server.id)}
          onTestMcpServer={handleTestMcpServer}
          onTestAllMcpServers={handleTestAllMcpServers}
          onCopyMcpConfigPath={copyMcpConfigPath}
          onOpenMcpConfig={openMcpConfigFile}
        />
      )}
      {configWizard?.mode === 'provider' && (
        <ProviderConfigModal
          visible={true}
          provider={configWizard.provider}
          value={
            configWizard.provider === 'ollama'
              ? configWizard.form.endpoint || ''
              : configWizard.form.apiKey || ''
          }
          onChange={(value) => {
            const field = configWizard.provider === 'ollama' ? 'endpoint' : 'apiKey';
            updateConfigWizardForm(field, value);
          }}
          onSubmit={handleConfigWizardSubmit}
          onCancel={cancelConfigWizard}
        />
      )}
      {configWizard?.mode === 'mcp' && (
        <McpServerModal
          visible={true}
          action={configWizard.action}
          server={configWizard.server}
          form={configWizard.form}
          onChange={(field, value) => updateConfigWizardForm(field, value)}
          onSubmit={handleMcpWizardSubmit}
          onCancel={cancelConfigWizard}
        />
      )}
      {sessionMenuState.open && (
        <SessionSelectorModal
          visible={sessionMenuState.open}
          sessions={sessionMenuState.sessions}
          selectedIndex={safeSessionMenuIndex}
          searchQuery={sessionMenuState.searchQuery}
          onSearchChange={handleSessionSearch}
          currentPage={sessionMenuState.currentPage}
          totalPages={sessionTotalPages}
          onPageChange={changeSessionPage}
        />
      )}
      {pendingAction && <ActionModal />}
      <Box flexDirection="column" gap={0}>
        {isExpandedView && messages.length > 0 && (
          <Box marginBottom={0} paddingBottom={0} paddingTop={0} marginTop={0}>
            <Text color="cyan">Expanded mode. Press Ctrl+R to return to compact view.</Text>
          </Box>
        )}
        <InputBar
          value={inputValue}
          status={status}
          statusDetail={statusDetail}
          showStatusCard={false}
          onChange={handleTextInputChange}
          onSubmit={handleInputSubmit}
          suggestions={suggestions}
          showSuggestions={showSuggestions}
          selectedSuggestion={selectedSuggestion}
          isFocused={isInputFocused}
          suggestionHint={suggestionHint || undefined}
          collapsedPasteSummary={collapsedPasteSummary}
          footer={
            exitConfirmation ? (
              <Text color="yellow">Press Ctrl+C again within 3s to exit JamCLI.</Text>
            ) : (() => {
              const PWD_MAX_LEN = 35;
              const MODEL_MAX_LEN = 30;
              const STATIC_BUFFER = 4; // InputBar padding plus spacing around the hint area
              const SECTION_GAP = 1;
              const MIN_HINT_RATIO = 0.5;
              const MIN_VISIBLE_HINT = 6;
              
              const pwdStr = displayCwd.length > PWD_MAX_LEN 
                ? `...${displayCwd.slice(-(PWD_MAX_LEN - 3))}` 
                : displayCwd;
                
              const modelStr = currentModelName.length > MODEL_MAX_LEN 
                ? `${currentModelName.slice(0, MODEL_MAX_LEN - 3)}...` 
                : currentModelName;
              
              const totalColumns = terminalSize.columns || 80;
              const availableForHints = Math.max(
                0,
                totalColumns - pwdStr.length - modelStr.length - STATIC_BUFFER
              );
              const hintSourceText = inlineNotice?.message || "Use /help · Ctrl+R toggles full view · Press Ctrl+C to exit";
              const hintLength = hintSourceText.length;
              const fullHintFits = availableForHints >= hintLength;
              const partialHintThreshold = Math.ceil(hintLength * MIN_HINT_RATIO);
              let hintStr = "";

              if (fullHintFits) {
                hintStr = hintSourceText;
              } else if (availableForHints >= Math.max(MIN_VISIBLE_HINT, partialHintThreshold)) {
                const ellipsis = '...';
                const sliceLength = Math.max(1, availableForHints - ellipsis.length);
                hintStr = `${hintSourceText.slice(0, sliceLength).trimEnd()}${ellipsis}`;
              }
              const hintColor = inlineNotice
                ? inlineNotice.tone === 'warning'
                  ? 'yellow'
                  : 'cyan'
                : 'gray';

              const pwdColor = 'cyan';

              return (
                <Box flexDirection="row" width="100%" alignItems="center">
                  <Box flexShrink={0} marginRight={SECTION_GAP}>
                    <Text color={pwdColor}>{pwdStr}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} justifyContent="center">
                    {hintStr ? <Text color={hintColor}>{hintStr}</Text> : <Text> </Text>}
                  </Box>
                  <Box flexShrink={0} marginLeft={SECTION_GAP}>
                    <Text color="gray">{modelStr}</Text>
                  </Box>
                </Box>
              );
            })()
          }
        />
      </Box>
    </Box>
  );
};
