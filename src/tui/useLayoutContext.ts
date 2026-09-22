import { useMemo, useRef, useState } from 'react';
import { useApp, useStdout } from 'ink';
import { useStore } from '../store/index.js';
import { McpTestService } from '../services/McpTestService.js';
import { ToolService } from '../services/ToolService.js';
import { ConfigService } from '../services/ConfigService.js';
import { ModelService } from '../services/ModelService.js';
import { McpManager } from '../services/McpManager.js';
import { useInlineNotice } from './useInlineNotice.js';
import { initialModelMenuState, initialSessionMenuState } from './layoutState.js';
import type { CollapsedPastePreview, ConfigWizardState, ModelMenuState, SessionMenuState, StatusDetail } from './layoutState.js';
import type { McpServerConfig, McpTestResult } from '../types/mcp.js';
import type { ModelInfo } from '../types/config.js';
import type { StatusStyleDefinition, StatusSpinnerStyleDefinition, StatusTextStyleDefinition } from '../styles/statusStyles.js';
import type { StatusStyleOption } from './StatusStyleModal.js';
import { DEFAULT_STATUS_STYLE } from '../styles/statusStyles.js';
import { resolveJamcliProjectRoot } from '../utils/projectRoot.js';
import path from 'path';

export function useLayoutContext() {
  const messages = useStore((s) => s.messages);
  const pendingAction = useStore((s) => s.pendingAction);
  const status = useStore((s) => s.status);
  const config = useStore((s) => s.config);
  const activeProfile = useStore((s) => s.activeProfile);
  const addMessage = useStore((s) => s.addMessage);
  const updateLastMessage = useStore((s) => s.updateLastMessage);
  const setConfig = useStore((s) => s.setConfig);
  const setActiveProfile = useStore((s) => s.setActiveProfile);
  const setUiConfig = useStore((s) => s.setUiConfig);
  const setStatus = useStore((s) => s.setStatus);
  const setPendingAction = useStore((s) => s.setPendingAction);
  const initializeHistory = useStore((s) => s.initializeHistory);
  const persistTurn = useStore((s) => s.persistTurn);
  const replaceMessages = useStore((s) => s.replaceMessages);
  const getSessionUsage = useStore((s) => s.getSessionUsage);
  const resumeSession = useStore((s) => s.resumeSession);
  const modelTokenUsage = useStore((s) => s.modelTokenUsage);
  const incrementModelTokenUsage = useStore((s) => s.incrementModelTokenUsage);
  const initializeModelTokenUsage = useStore((s) => s.initializeModelTokenUsage);
  const clearModelTokenUsage = useStore((s) => s.clearModelTokenUsage);
  const uiConfig = useStore((s) => s.uiConfig);

  const [inputValue, setInputValue] = useState('');
  const [collapsedPaste, setCollapsedPaste] = useState<CollapsedPastePreview | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelMenuState, setModelMenuState] = useState<ModelMenuState>(initialModelMenuState);
  const [sessionMenuState, setSessionMenuState] = useState<SessionMenuState>(initialSessionMenuState);
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const [modelDetail, setModelDetail] = useState<ModelInfo | null>(null);
  const [configWizard, setConfigWizard] = useState<ConfigWizardState>(null);
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [exitConfirmation, setExitConfirmation] = useState(false);
  const [autoApproveActions, setAutoApproveActions] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, McpTestResult>>({});
  const testService = useMemo(() => new McpTestService(), []);

  const [statusDetail, setStatusDetail] = useState<StatusDetail | null>(null);
  const [statusStyle, setStatusStyle] = useState<StatusStyleDefinition>(DEFAULT_STATUS_STYLE);
  const [statusStyleOptions, setStatusStyleOptions] = useState<StatusStyleOption[]>([]);
  const { inlineNotice, showInlineNotice, clearInlineNotice } = useInlineNotice(inputValue);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelReasonRef = useRef<'escape' | 'ctrl+c' | null>(null);
  const coreApprovalRef = useRef<((ok: boolean) => void) | null>(null);
  const exitResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitConfirmationRef = useRef(false);
  const isProcessingRef = useRef(false);
  const sessionStartRef = useRef(Date.now());
  const modelsUsedRef = useRef<Set<string>>(new Set());
  const recentModelsRef = useRef<string[]>([]);
  const prefetchingModelsRef = useRef(false);
  const returnToModelMenuRef = useRef(false);
  const inputValueRef = useRef('');
  const pasteCounterRef = useRef(0);
  const pasteBufferRef = useRef<{ active: boolean; data: string }>({ active: false, data: '' });
  const prevContextEnabledRef = useRef<boolean | undefined>(undefined);
  const statusLineIndexRef = useRef(0);
  const toolServiceRef = useRef<ToolService | null>(null);
  const configServiceRef = useRef<ConfigService | null>(null);
  const modelServiceRef = useRef<ModelService | null>(null);
  const mcpManagerRef = useRef<McpManager | null>(null);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [terminalSize, setTerminalSize] = useState({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });
  const projectRoot = useMemo(() => resolveJamcliProjectRoot(), []);
  const defaultMcpConfigPath = useMemo(() => path.join(projectRoot, '.jamcli', 'mcp.json'), [projectRoot]);

  return {
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
  };
}

export type LayoutContext = ReturnType<typeof useLayoutContext>;
export type { StatusSpinnerStyleDefinition, StatusTextStyleDefinition };
