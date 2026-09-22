import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import clipboard from 'clipboardy';
import { spawn } from 'child_process';
import path from 'path';
import { Header } from './Header.js';
import { ChatViewport } from './ChatViewport.js';
import { InputBar, SlashCommand } from './InputBar.js';
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
import { ConfigService } from '../services/ConfigService.js';
import { ModelService } from '../services/ModelService.js';
import { McpManager } from '../services/McpManager.js';
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
import { ToolService } from '../services/ToolService.js';
import { HistoryService, SessionMetadata } from '../services/HistoryService.js';
import type { Config, ModelInfo, Profile, ToolPermission, UiConfig } from '../types/config.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import type { ToolCall, ToolResult, ToolName } from '../types/tools.js';
import { ALL_TOOL_NAMES, SAFE_TOOL_NAMES, TOOL_DEFINITIONS } from '../types/tools.js';
import type { McpServerConfig, McpTestResult, McpToolDescriptor } from '../types/mcp.js';
import {
  DEFAULT_CUSTOM_STYLE,
  DEFAULT_STATUS_STYLE,
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

let configService: ConfigService;
let modelService: ModelService;
let mcpManager: McpManager;

import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  CONFIG_SUBCOMMANDS,
  CONFIGURE_ENTRY_ID,
  CONFIGURE_MODELS_ENTRY,
  initialModelMenuState,
  initialSessionMenuState,
  MCP_COMMAND_USAGE,
  normalizePastedContent,
  PROVIDER_COMMAND_USAGE,
  resetTerminalViewport,
  SESSION_PAGE_SIZE,
  SLASH_COMMANDS,
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
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [terminalSize, setTerminalSize] = useState({
    rows: stdout?.rows ?? 24,
    columns: stdout?.columns ?? 80,
  });
  const projectRoot = useMemo(() => resolveJamcliProjectRoot(), []);
  const defaultMcpConfigPath = useMemo(() => path.join(projectRoot, '.jamcli', 'mcp.json'), [projectRoot]);

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

  const showToolStatus = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Tool registry is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return false;
    }
    try {
      const permissions = await configService.getToolPermissions();
      addMessage({ role: 'system', content: formatToolStatusTable(permissions), timestamp: Date.now() });
      return true;
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load tools: ${error.message}`, timestamp: Date.now() });
      return false;
    }
  }, [addMessage, configService]);

  const showMcpServers = useCallback(async () => {
    if (!mcpManager) {
      addMessage({
        role: 'system',
        content: 'MCP manager is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const summary = await mcpManager.describeServers();
      addMessage({ role: 'system', content: summary, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load MCP servers: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage]);

  const showMcpTools = useCallback(async () => {
    if (!mcpManager) {
      addMessage({
        role: 'system',
        content: 'MCP manager is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const summary = await mcpManager.describeTools();
      addMessage({ role: 'system', content: summary, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load MCP tools: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage]);

  const upsertMcpServer = useCallback(
    async (id: string, command: string, args: string[] = [], cwd?: string) => {
      if (!mcpManager) {
        addMessage({
          role: 'system',
          content: 'MCP manager is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        await mcpManager.upsertServer({ id, command, args, cwd, enabled: true });
        addMessage({
          role: 'system',
          content: `MCP server saved: ${id} (${command}${args.length ? ' ' + args.join(' ') : ''})`,
          timestamp: Date.now(),
        });
        await showMcpServers();
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to save MCP server: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, showMcpServers]
  );

  const removeMcpServer = useCallback(
    async (id: string) => {
      if (!mcpManager) {
        addMessage({
          role: 'system',
          content: 'MCP manager is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        await mcpManager.removeServer(id);
        if (configService) {
          const servers = await configService.listMcpServers();
          setMcpServers(servers);
        }
        addMessage({ role: 'system', content: `Removed MCP server: ${id}`, timestamp: Date.now() });
        await showMcpServers();
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to remove MCP server: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, showMcpServers]
  );

  const updateToolPermissionSetting = useCallback(
    async (toolName: ToolName, updates: Partial<ToolPermission>, actionLabel: string) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Tool registry is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updated = await configService.updateToolPermission(toolName, updates);
        const description = `${TOOL_DEFINITIONS[toolName].label} ${actionLabel}. Mode: ${describeToolMode(updated)}.`;
        addMessage({ role: 'system', content: description, timestamp: Date.now() });
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to update ${toolName}: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage]
  );

  const showProviderSettings = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const cfg = await configService.getConfig();
      addMessage({ role: 'system', content: formatProviderSummary(cfg), timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load providers: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage]);

  const updateProviderSetting = useCallback(
    async (provider: ProviderSlug, value?: string) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updatedConfig = await configService.updateProvider(provider, value);
        setConfig(updatedConfig);
        const detail = provider === 'ollama'
          ? `Ollama endpoint set to ${updatedConfig.api_registry.ollama?.endpoint}`
          : 'OpenRouter API key updated.';
        addMessage({ role: 'system', content: detail, timestamp: Date.now() });
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to update provider: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, setConfig]
  );

  const showConfigMenu = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const cfg = await configService.getConfig();
      const profile = await configService.getActiveProfile();
      const summary = [
        'Configuration menu:',
        `Active profile: ${cfg.active_profile}`,
        `Preferred model: ${profile.preferred_model || 'n/a'} (${profile.preferred_provider || 'provider?'})`,
        `Telemetry: ${cfg.telemetry ? 'enabled' : 'disabled'}`,
        '',
        'System prompt (first 200 chars):',
        profile.system_prompt_override?.slice(0, 200) || '(not set)',
        '',
        'Commands:',
        '/config prompt show  – view current system prompt',
        '/config prompt set <text>  – update system prompt',
        '/tools status  – manage tool permissions',
      ].join('\n');
      addMessage({ role: 'system', content: summary, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to load config: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage]);

  const showSystemPrompt = useCallback(async () => {
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }
    try {
      const profile = await configService.getActiveProfile();
      const prompt = profile.system_prompt_override || '(not set)';
      addMessage({ role: 'system', content: `Current system prompt:\n\n${prompt}`, timestamp: Date.now() });
    } catch (error: any) {
      addMessage({ role: 'system', content: `Failed to read system prompt: ${error.message}`, timestamp: Date.now() });
    }
  }, [addMessage]);

  const updateSystemPromptSetting = useCallback(
    async (newPrompt: string) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updatedProfile = await configService.updateSystemPrompt(newPrompt);
        setActiveProfile(updatedProfile);
        addMessage({ role: 'system', content: 'System prompt updated.', timestamp: Date.now() });
      } catch (error: any) {
        addMessage({ role: 'system', content: `Failed to update prompt: ${error.message}`, timestamp: Date.now() });
      }
    },
    [addMessage, setActiveProfile]
  );

  const handleTextInputChange = useCallback(
    (nextValue: string) => {
      const previousValue = inputValueRef.current;
      const hasStart = nextValue.includes(BRACKETED_PASTE_START);
      const hasEnd = nextValue.includes(BRACKETED_PASTE_END);
      const isCapturing = pasteBufferRef.current.active || hasStart || hasEnd;

      const processPaste = (normalized: string) => {
        if (!normalized.length) {
          setCollapsedPaste(null);
          setInputValue('');
          return;
        }

        const lineCount = normalized.split('\n').length;
        const width = terminalSize.columns ?? 80;
        const shouldCollapse =
          previousValue.length === 0 && (lineCount > 1 || normalized.length >= Math.max(width - 6, 80));

        if (shouldCollapse) {
          const nextId = pasteCounterRef.current + 1;
          pasteCounterRef.current = nextId;
          setCollapsedPaste({
            id: nextId,
            content: normalized,
            lineCount,
            charCount: normalized.length,
          });
          showInlineNotice({
            message: `Pasted ${lineCount} lines (${normalized.length} chars). Enter inserts · Esc cancels.`,
            tone: 'info',
            kind: 'clear_input',
          });
          setInputValue('');
        } else {
          setCollapsedPaste(null);
          setInputValue(normalized);
        }
      };

      if (isCapturing) {
        let chunk = nextValue;

        if (hasStart) {
          pasteBufferRef.current.active = true;
          pasteBufferRef.current.data = '';
          chunk = chunk.split(BRACKETED_PASTE_START).join('');
        }

        if (hasEnd) {
          const beforeEnd = chunk.split(BRACKETED_PASTE_END)[0] || '';
          pasteBufferRef.current.data += beforeEnd;
          const normalized = normalizePastedContent(pasteBufferRef.current.data);
          pasteBufferRef.current = { active: false, data: '' };
          processPaste(normalized);
          return;
        }

        if (pasteBufferRef.current.active) {
          pasteBufferRef.current.data += chunk;
          return;
        }
      }

      if (collapsedPaste) {
        setCollapsedPaste(null);
      }

      setInputValue(nextValue);
    },
    [collapsedPaste, showInlineNotice, terminalSize.columns]
  );

  const refreshStatusStyles = useCallback(
    async (
      nextUiConfig?: UiConfig | null,
      overrides?: { textStyleId?: StatusTextStyleDefinition['id']; spinnerStyleId?: StatusSpinnerStyleDefinition['id'] }
    ) => {
      try {
        if (!configService) return;
        const cfg = nextUiConfig || uiConfig || (await configService.getUiConfig());
        setUiConfig(cfg);

        const resolved = await resolveStatusStyle({
          uiConfig: cfg,
          textStyleId: overrides?.textStyleId,
          spinnerStyleId: overrides?.spinnerStyleId,
        });
        setStatusStyle(resolved);

        const [textOptionsRaw, spinnerOptionsRaw] = await Promise.all([
          listStatusTextStyleOptions(cfg),
          listStatusSpinnerStyleOptions(cfg),
        ]);

        const [resolvedTextDefs, resolvedSpinnerDefs] = await Promise.all([
          Promise.all(textOptionsRaw.map((opt) => resolveTextStyle(opt.id, cfg))),
          Promise.all(spinnerOptionsRaw.map((opt) => resolveSpinnerStyle(opt.id, cfg))),
        ]);

        const options: StatusStyleOption[] = [
          ...textOptionsRaw.map((opt, idx) => ({
            kind: 'text' as const,
            id: opt.id,
            label: opt.label,
            description: opt.source === 'custom' ? opt.path : opt.source,
            source: opt.source,
            path: opt.path,
            textStyle: resolvedTextDefs[idx],
          })),
          ...spinnerOptionsRaw.map((opt, idx) => ({
            kind: 'spinner' as const,
            id: opt.id,
            label: opt.label,
            description: opt.source === 'custom' ? opt.path : opt.source,
            source: opt.source,
            path: opt.path,
            spinnerStyle: resolvedSpinnerDefs[idx],
          })),
          {
            kind: 'action',
            id: 'add_custom',
            label: 'Add custom style',
            description: 'Create a file in ~/.jamubc/status-styles',
          },
          {
            kind: 'action',
            id: 'manage_custom',
            label: 'Manage custom styles',
            description: 'Open the status-styles folder to edit/delete',
            meta: configService.getStatusStylesDirectory(),
          },
        ];
        setStatusStyleOptions(options);
      } catch (error: any) {
        console.error('Failed to refresh status styles', error);
        setStatusStyle(DEFAULT_STATUS_STYLE);
        setStatusStyleOptions([]);
      }
    },
    [configService, setUiConfig, uiConfig]
  );

  const applyTextStyle = useCallback(
    async (styleId: StatusTextStyleDefinition['id'], opts?: { silent?: boolean; pathHint?: string }) => {
      if (!configService) return;
      try {
        const updatedUi = await configService.setStatusTextStyle(styleId);
        await refreshStatusStyles(updatedUi, { textStyleId: styleId });
        if (!opts?.silent) {
          const active = await resolveStatusStyle({ uiConfig: updatedUi, textStyleId: styleId });
          const pathNote = opts?.pathHint ? ` Edit at ${opts.pathHint}` : '';
          addMessage({
            role: 'system',
            content: `Text style set to "${active.label}".${pathNote}`,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update text style: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, refreshStatusStyles]
  );

  const applySpinnerStyle = useCallback(
    async (styleId: StatusSpinnerStyleDefinition['id'], opts?: { silent?: boolean; pathHint?: string }) => {
      if (!configService) return;
      try {
        const updatedUi = await configService.setStatusSpinnerStyle(styleId);
        await refreshStatusStyles(updatedUi, { spinnerStyleId: styleId });
        if (!opts?.silent) {
          const active = await resolveStatusStyle({ uiConfig: updatedUi, spinnerStyleId: styleId });
          const pathNote = opts?.pathHint ? ` Edit at ${opts.pathHint}` : '';
          addMessage({
            role: 'system',
            content: `Spinner set to "${active.label}".${pathNote}`,
            timestamp: Date.now(),
          });
        }
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update spinner: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, refreshStatusStyles]
  );

  const addCustomStatusStyle = useCallback(async () => {
    if (!configService) return;
    const existing = new Set(Object.keys(uiConfig?.custom_status_styles || {}));
    let suffix = existing.size + 1;
    let name = `custom-style-${suffix}`;
    while (existing.has(name)) {
      suffix += 1;
      name = `custom-style-${suffix}`;
    }
    try {
      const { path: stylePath, uiConfig: updatedUi } = await configService.ensureCustomStatusStyle(name, {
        ...DEFAULT_CUSTOM_STYLE,
        label: `Custom: ${name}`,
      });
      await applyTextStyle(`custom:${name}`, { pathHint: stylePath, silent: true });
      await applySpinnerStyle(`custom:${name}`, { pathHint: stylePath, silent: true });
      await refreshStatusStyles(updatedUi, { textStyleId: `custom:${name}`, spinnerStyleId: `custom:${name}` });
      addMessage({
        role: 'system',
        content: `Custom style "${name}" created. Edit at ${stylePath}.`,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to create custom style: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, applySpinnerStyle, applyTextStyle, configService, refreshStatusStyles, uiConfig?.custom_status_styles]);

  const openStatusStyleFolderMessage = useCallback(() => {
    if (!configService) return;
    const folder = configService.getStatusStylesDirectory();
    addMessage({
      role: 'system',
      content: `Manage custom styles in: ${folder}\nEdit or remove JSON files to adjust shimmer/spinner colors.`,
      timestamp: Date.now(),
    });
  }, [addMessage]);

  useEffect(() => {
    resetTerminalViewport();
    const init = async () => {
      if (process.cwd() !== projectRoot) {
        try {
          process.chdir(projectRoot);
        } catch (error) {
          console.error('Failed to switch to project root:', error);
        }
      }
      configService = new ConfigService(projectRoot);
      await configService.initialize();
      const loadedConfig = await configService.getConfig();
      const profile = await configService.getActiveProfile();
      setConfig(loadedConfig);
      setActiveProfile(profile);
      toolServiceRef.current = new ToolService({ projectRoot, configService });

      modelService = new ModelService(configService);
      mcpManager = new McpManager({ configService });
      await refreshMcpServers();
      try {
        const preloadModels = await modelService.listAvailableModels();
        setAvailableModels(preloadModels);
      } catch {
        // Ignore preload failures; handled when user opens the model menu.
      }

      try {
        const uiCfg = await configService.getUiConfig();
        await refreshStatusStyles(uiCfg);
      } catch (error: any) {
        console.error('Failed to load UI config; using defaults.', error);
        setStatusStyle(DEFAULT_STATUS_STYLE);
      }

      // Initialize history service
      await initializeHistory(projectRoot);
    };

    init();
    // Run once on mount; avoid tying to callbacks that change with state.
  }, [projectRoot]);

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

      const sourceModels = (availableModels.length ? availableModels : modelMenuState.models).filter(
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
  }, [inputValue, activeProfile?.preferred_provider, availableModels, modelMenuState.models]);

  const suggestions = suggestionData.list;
  const suggestionHint = suggestionData.hint;

  useEffect(() => {
    setSelectedSuggestion(0);
  }, [suggestions.length]);

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

  const pickStatusLine = useCallback(
    (phase: 'thinking' | 'streaming') => {
      const options = phase === 'thinking' ? THINKING_STATUS_LINES : STREAMING_STATUS_LINES;
      const idx = statusLineIndexRef.current % options.length;
      statusLineIndexRef.current += 1;
      return options[idx];
    },
    []
  );

  const recordModelUsage = useCallback((provider: string, model: string) => {
    if (!provider || !model) return;
    const id = `${provider}:${model}`;
    recentModelsRef.current = [id, ...recentModelsRef.current.filter((item) => item !== id)].slice(0, 25);
    modelsUsedRef.current.add(id);
  }, []);

  useEffect(() => {
    if (activeProfile?.preferred_model) {
      const provider = activeProfile.preferred_provider || 'ollama';
      const key = `${provider}:${activeProfile.preferred_model}`;
      recordModelUsage(provider, activeProfile.preferred_model);
      initializeModelTokenUsage(key);
    }
  }, [activeProfile?.preferred_model, activeProfile?.preferred_provider, initializeModelTokenUsage, recordModelUsage]);

  useEffect(() => {
    if (status === 'idle') {
      setStatusDetail(null);
      return;
    }

    const phase: 'thinking' | 'streaming' = status === 'streaming' ? 'streaming' : 'thinking';
    setStatusDetail({
      phase,
      modelName: activeProfile?.preferred_model || 'Model',
      startedAt: Date.now(),
      message: pickStatusLine(phase),
    });
  }, [activeProfile?.preferred_model, pickStatusLine, status]);

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

  const cancelCurrentRequest = (reason: 'escape' | 'ctrl+c') => {
    if (!abortControllerRef.current) return false;
    cancelReasonRef.current = reason;
    abortControllerRef.current.abort();
    return true;
  };

  const clearExitConfirmation = useCallback(() => {
    if (exitResetTimeoutRef.current) {
      clearTimeout(exitResetTimeoutRef.current);
      exitResetTimeoutRef.current = null;
    }
    exitConfirmationRef.current = false;
    setExitConfirmation(false);
  }, []);

  const requestExitConfirmation = useCallback(() => {
    if (exitResetTimeoutRef.current) {
      clearTimeout(exitResetTimeoutRef.current);
    }
    exitConfirmationRef.current = true;
    setExitConfirmation(true);
    exitResetTimeoutRef.current = setTimeout(() => {
      exitConfirmationRef.current = false;
      setExitConfirmation(false);
      exitResetTimeoutRef.current = null;
    }, 3000);
  }, []);

  const formatDuration = useCallback((ms: number) => {
    if (ms <= 0) return '0s';
    const totalSeconds = Math.max(1, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
  }, []);

  const estimateTokens = useCallback((text: string) => {
    if (!text) return 0;
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.ceil(trimmed.length / 4));
  }, []);

  const buildSessionSummary = useCallback(() => {
    const durationMs = Date.now() - sessionStartRef.current;
    let promptTokens = 0;
    let completionTokens = 0;
    let userMessages = 0;
    let assistantMessages = 0;

    const sessionUsage = getSessionUsage();
    
    // Use actual tracked usage if available
    if (sessionUsage) {
      promptTokens = sessionUsage.promptTokens;
      completionTokens = sessionUsage.completionTokens;
    } else {
      // Fallback to estimation
      messages.forEach((message) => {
        const tokens = estimateTokens(message.content || '');
        if (message.role === 'assistant') {
          completionTokens += tokens;
          assistantMessages += 1;
        } else {
          promptTokens += tokens;
          if (message.role === 'user') {
            userMessages += 1;
          }
        }
      });
    }
    
    // Count messages
    messages.forEach((message) => {
      if (message.role === 'assistant') assistantMessages += 1;
      if (message.role === 'user') userMessages += 1;
    });

    const totalTokens = promptTokens + completionTokens;
    const modelKeys = new Set(modelsUsedRef.current);
    Object.keys(modelTokenUsage).forEach((key) => modelKeys.add(key));
    const modelUsageLines = modelKeys.size
      ? Array.from(modelKeys).map((key) => {
          const usage = modelTokenUsage[key];
          if (usage) {
            return `- ${key}: ${usage.total_tokens} tokens (prompt ${usage.prompt_tokens} · completion ${usage.completion_tokens})`;
          }
          return `- ${key}: 0 tokens recorded`;
        })
      : ['- n/a'];

    const sessionTokensLine = sessionUsage
      ? `Session tokens: ${totalTokens} (prompt ${promptTokens} · completion ${completionTokens})`
      : `Approx tokens: ${totalTokens} (prompt ${promptTokens} · completion ${completionTokens})`;

    return [
      '~goodbye 👋',
      `Session length: ${formatDuration(durationMs)}`,
      `Messages sent: ${userMessages} • Assistant replies: ${assistantMessages}`,
      'Model usage:',
      ...modelUsageLines,
      sessionTokensLine,
    ].join('\n');
  }, [activeProfile?.preferred_model, activeProfile?.preferred_provider, estimateTokens, formatDuration, messages, getSessionUsage, modelTokenUsage]);

  const performExit = useCallback(() => {
    clearExitConfirmation();
    const summary = buildSessionSummary();
    exit();
    
    // Give Ink a moment to unmount and restore terminal state if needed
    setTimeout(() => {
      process.stdout.write(`${summary}\n`);
      process.exit(0);
    }, 50);
  }, [buildSessionSummary, clearExitConfirmation, exit]);

  const handleCtrlC = useCallback(() => {
    const isProcessing = status === 'thinking' || status === 'streaming';
    if (isProcessing) {
      cancelCurrentRequest('ctrl+c');
      clearExitConfirmation();
      return;
    }

    if (exitConfirmationRef.current) {
      performExit();
      return;
    }

    requestExitConfirmation();
  }, [cancelCurrentRequest, clearExitConfirmation, performExit, requestExitConfirmation, status]);

  useEffect(() => {
    const onSigint = () => {
      handleCtrlC();
    };

    process.on('SIGINT', onSigint);
    return () => {
      process.off('SIGINT', onSigint);
    };
  }, [handleCtrlC]);

  const openModelMenu = useCallback(
    (models: ModelInfo[]) => {
      setModelDetail(null);
      const currentModel = activeProfile?.preferred_model;
      const currentProvider = activeProfile?.preferred_provider;
      const defaultId = currentModel && currentProvider ? `${currentProvider}:${currentModel}` : null;

      const filteredModels = models.filter((model) => model.id !== CONFIGURE_ENTRY_ID);
      setAvailableModels(filteredModels);
      const menuModels = [CONFIGURE_MODELS_ENTRY, ...filteredModels];

      const fallbackIndex = menuModels.length > 1 ? 1 : 0;
      let selectedIndex = defaultId ? menuModels.findIndex((model) => model.id === defaultId) : -1;
      if (selectedIndex < 0 && currentModel) {
        selectedIndex = menuModels.findIndex((model) => model.id.endsWith(`:${currentModel}`));
      }

      setModelMenuState({
        open: true,
        models: menuModels,
        selectedIndex: selectedIndex >= 0 ? selectedIndex : fallbackIndex,
        searchQuery: '',
      });
    },
    [activeProfile?.preferred_model, activeProfile?.preferred_provider, setAvailableModels]
  );

  const closeModelMenu = () => {
    setModelDetail(null);
    setModelMenuState((prev) => ({ ...prev, open: false }));
  };

  const openSessionMenu = useCallback(async () => {
    try {
      const history = new HistoryService(projectRoot);
      await history.initialize();
      const sessions = await history.listSessions(100); // Load more for search
      
      if (sessions.length === 0) {
        addMessage({
          role: 'system',
          content: 'No previous sessions found.',
          timestamp: Date.now(),
        });
        return;
      }

      setSessionMenuState({
        open: true,
        sessions,
        allSessions: sessions,
        selectedIndex: 0,
        searchQuery: '',
        currentPage: 0,
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to load sessions: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, projectRoot, setSessionMenuState]);

  const closeSessionMenu = () => setSessionMenuState(initialSessionMenuState);

  const handleSessionSearch = async (query: string) => {
    setSessionMenuState(prev => {
      if (!query.trim()) {
        return {
          ...prev,
          searchQuery: query,
          sessions: prev.allSessions,
          selectedIndex: 0,
          currentPage: 0,
        };
      }

      const filtered = prev.allSessions.filter(session => {
        const searchableText = [
          session.title || '',
          session.firstUserMessage || '',
          session.projectName,
          session.id,
        ].join(' ').toLowerCase();
        
        return searchableText.includes(query.toLowerCase());
      });

      return {
        ...prev,
        searchQuery: query,
        sessions: filtered,
        selectedIndex: 0,
        currentPage: 0,
      };
    });
  };

  const handleModelSearchChange = useCallback((query: string) => {
    setModelDetail(null);
    setModelMenuState((prev) => ({ ...prev, searchQuery: query, selectedIndex: 0 }));
  }, []);


  const changeSessionPage = (direction: 'prev' | 'next') => {
    setSessionMenuState((prev) => {
      if (!prev.sessions.length) {
        return prev;
      }

      const totalPages = Math.ceil(prev.sessions.length / SESSION_PAGE_SIZE);

      let newPage = prev.currentPage;
      if (direction === 'next' && prev.currentPage < totalPages - 1) {
        newPage = prev.currentPage + 1;
      } else if (direction === 'prev' && prev.currentPage > 0) {
        newPage = prev.currentPage - 1;
      }

      const newIndex = Math.min(newPage * SESSION_PAGE_SIZE, prev.sessions.length - 1);

      return { ...prev, currentPage: newPage, selectedIndex: newIndex };
    });
  };

  const handleSessionResume = async (sessionId: string) => {
    const success = await resumeSession(sessionId, projectRoot);
    
    if (success) {
      const updatedMessages = messages;
      addMessage({
        role: 'system',
        content: `📜 Resumed session: ${sessionId}\nLoaded ${updatedMessages.length} messages from history.`,
        timestamp: Date.now(),
      });
    } else {
      addMessage({
        role: 'system',
        content: `Failed to resume session: ${sessionId}`,
        timestamp: Date.now(),
      });
    }
  };

  const handleModelSwitch = async (modelId: string) => {
    if (!modelService) {
      addMessage({
        role: 'system',
        content: 'Model service is still initializing. Try again in a moment.',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const updatedProfile = await modelService.switchModel(modelId);
      setActiveProfile(updatedProfile);
      recordModelUsage(updatedProfile.preferred_provider || 'ollama', updatedProfile.preferred_model || modelId);
      addMessage({
        role: 'system',
        content: `Model switched to: ${updatedProfile.preferred_model} (${updatedProfile.preferred_provider || 'ollama'})`,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to switch model: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  };

  const refreshAvailableModels = useCallback(async () => {
    if (!modelService) return [];
    try {
      const models = await modelService.listAvailableModels();
      setAvailableModels(models);
      return models;
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to list models: ${error.message}`,
        timestamp: Date.now(),
      });
      return [];
    }
  }, [addMessage, setAvailableModels]);

  const updateToolModelFilterSetting = useCallback(
    async (enabled: boolean) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updatedConfig = await configService.updateGeneralSettings({
          show_tool_calling_models_only: enabled,
        });
        setConfig(updatedConfig);
        addMessage({
          role: 'system',
          content: enabled
            ? 'Showing only tool-calling OpenRouter models.'
            : 'Showing all OpenRouter models.',
          timestamp: Date.now(),
        });
        await refreshAvailableModels();
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update general settings: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, refreshAvailableModels, setConfig]
  );

  const reopenModelMenu = useCallback(async () => {
    const models = await refreshAvailableModels();
    openModelMenu(models);
  }, [openModelMenu, refreshAvailableModels]);

  const openConfigMenu = useCallback(
    async (options?: { returnToModels?: boolean }) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }

      if (typeof options?.returnToModels === 'boolean') {
        returnToModelMenuRef.current = options.returnToModels;
      }

      try {
        const cfg = await configService.getConfig();
        setConfig(cfg);
        await refreshStatusStyles(); // Ensure styles are loaded
        setIsConfigMenuOpen(true);
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to load configuration: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, setConfig, refreshStatusStyles]
  );

  const closeConfigMenu = useCallback(async () => {
    setIsConfigMenuOpen(false);
    const shouldReturn = returnToModelMenuRef.current;
    returnToModelMenuRef.current = false;
    if (shouldReturn) {
      await reopenModelMenu();
    }
  }, [reopenModelMenu]);

  const updateConfigWizardForm = useCallback((field: string, value: string) => {
    setConfigWizard((prev) => (prev ? { ...prev, form: { ...prev.form, [field]: value } } : prev));
  }, []);

  const cancelConfigWizard = useCallback(() => {
    setConfigWizard(null);
    void openConfigMenu();
  }, [openConfigMenu]);

  const removeProvider = useCallback(
    async (provider: ProviderSlug) => {
      if (!configService) {
        addMessage({
          role: 'system',
          content: 'Configuration service is still initializing. Try again shortly.',
          timestamp: Date.now(),
        });
        return;
      }
      try {
        const updated = await configService.removeProvider(provider);
        setConfig(updated);
        addMessage({
          role: 'system',
          content: `${provider === 'ollama' ? 'Ollama' : 'OpenRouter'} provider removed.`,
          timestamp: Date.now(),
        });
        await refreshAvailableModels();
        await openConfigMenu();
      } catch (error: any) {
        addMessage({
          role: 'system',
          content: `Failed to update providers: ${error.message}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, openConfigMenu, refreshAvailableModels, setConfig]
  );

  const handleConfigWizardSubmit = useCallback(async () => {
    if (!configWizard || configWizard.mode !== 'provider') return;
    if (!configService) {
      addMessage({
        role: 'system',
        content: 'Configuration service is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      if (configWizard.provider === 'ollama') {
        const endpoint = (configWizard.form.endpoint || '').trim() || 'http://localhost:11434';
        const updatedConfig = await configService.updateProvider('ollama', endpoint);
        setConfig(updatedConfig);
        addMessage({
          role: 'system',
          content: `Ollama endpoint set to ${endpoint}`,
          timestamp: Date.now(),
        });
      } else {
        const apiKey = (configWizard.form.apiKey || '').trim();
        if (!apiKey) {
          addMessage({
            role: 'system',
            content: 'Please enter an API key to continue.',
            timestamp: Date.now(),
          });
          return;
        }
        const updatedConfig = await configService.updateProvider('openrouter', apiKey);
        setConfig(updatedConfig);
        addMessage({
          role: 'system',
          content: 'OpenRouter API key saved.',
          timestamp: Date.now(),
        });
      }
      setConfigWizard(null);
      await refreshAvailableModels();
      await openConfigMenu();
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to save provider: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, configWizard, openConfigMenu, refreshAvailableModels, setConfig]);

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

  const openAddMcpWizard = useCallback(() => {
    setConfigWizard({
      mode: 'mcp',
      action: 'add',
      form: {
        id: '',
        command: '',
        args: '',
        cwd: projectRoot,
        env: '',
        transport: 'stdio',
      },
    });
  }, [projectRoot]);

  const openEditMcpWizard = useCallback(
    (server: McpServerConfig) => {
      const envEntries = server.env
        ? Object.entries(server.env)
            .map(([key, value]) => `${key}=${value}`)
            .join('\n')
        : '';
      setConfigWizard({
        mode: 'mcp',
        action: 'edit',
        server,
        form: {
          id: server.id,
          command: server.command,
          args: (server.args || []).join(' '),
          cwd: server.cwd || projectRoot,
          env: envEntries,
          transport: server.transport === 'sse' ? 'sse' : 'stdio',
        },
      });
    },
    [projectRoot]
  );

  const handleMcpWizardSubmit = useCallback(async () => {
    if (!configWizard || configWizard.mode !== 'mcp') return;
    if (!mcpManager) {
      addMessage({
        role: 'system',
        content: 'MCP manager is still initializing. Try again shortly.',
        timestamp: Date.now(),
      });
      return;
    }

    const form = configWizard.form;
    const id = form.id.trim();
    const command = form.command.trim();
    if (!id || !command) {
      addMessage({
        role: 'system',
        content: 'Provide both an ID and command for the MCP server.',
        timestamp: Date.now(),
      });
      return;
    }

    const args = form.args
      .split(/\s+/)
      .map((arg) => arg.trim())
      .filter(Boolean);
    const envLines = form.env
      .split(/[;\r?\n]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const env: Record<string, string> = {};
    envLines.forEach((line) => {
      const [key, ...rest] = line.split('=');
      if (!key) return;
      env[key.trim()] = rest.join('=').trim();
    });

    try {
      const next: McpServerConfig = {
        id,
        command,
        args,
        env: Object.keys(env).length ? env : undefined,
        cwd: form.cwd?.trim() || undefined,
        transport: form.transport === 'sse' ? 'sse' : 'stdio',
        enabled: true,
      };
      await mcpManager.upsertServer(next);
      await refreshMcpServers();
      addMessage({
        role: 'system',
        content: `${configWizard.action === 'add' ? 'Added' : 'Updated'} MCP server: ${id}`,
        timestamp: Date.now(),
      });
      setConfigWizard(null);
      await openConfigMenu();
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to save MCP server: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage, configWizard, mcpManager, refreshMcpServers, openConfigMenu]);

  const handleTestMcpServer = useCallback(
    async (server: McpServerConfig) => {
      setMcpTestResults((prev) => ({
        ...prev,
        [server.id]: {
          status: 'failed',
          message: 'Testing...',
          timestamp: Date.now(),
        },
      }));

      try {
        const result = await testService.testServer(server, projectRoot);
        setMcpTestResults((prev) => ({ ...prev, [server.id]: result }));
        addMessage({
          role: 'system',
          content: `MCP ${server.id} test: ${result.status === 'ok' ? 'OK' : 'FAILED'} - ${result.message}`,
          timestamp: Date.now(),
        });
      } catch (error: any) {
        setMcpTestResults((prev) => ({
          ...prev,
          [server.id]: {
            status: 'failed',
            message: error?.message || 'Test failed',
            timestamp: Date.now(),
          },
        }));
        addMessage({
          role: 'system',
          content: `MCP ${server.id} test failed: ${error?.message || 'Unknown error'}`,
          timestamp: Date.now(),
        });
      }
    },
    [addMessage, projectRoot, testService]
  );

  const handleTestAllMcpServers = useCallback(async () => {
    for (const server of mcpServers) {
      await handleTestMcpServer(server);
    }
  }, [handleTestMcpServer, mcpServers]);

  const copyMcpConfigPath = useCallback(async () => {
    if (!configService) return;
    try {
      clipboard.writeSync(configService.getMcpConfigPath());
      addMessage({
        role: 'system',
        content: 'MCP config path copied to clipboard.',
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to copy MCP path: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [addMessage]);

  const openMcpConfigFile = useCallback(() => {
    if (!configService) return;
    const editor = process.env.EDITOR;
    if (!editor) {
      addMessage({
        role: 'system',
        content: 'Set $EDITOR to open the MCP config file.',
        timestamp: Date.now(),
      });
      return;
    }

    const proc = spawn(editor, [configService.getMcpConfigPath()], {
      stdio: 'inherit',
    });

    proc.on('error', (error) => {
      addMessage({
        role: 'system',
        content: `Failed to open editor: ${error.message}`,
        timestamp: Date.now(),
      });
    });
  }, [addMessage]);

  const handleConfigMenuSubmit = useCallback(
    () => {
      // Legacy handler, now handled by ConfigMenuScreen
    },
    []
  );

  const handleModelMenuSubmit = useCallback(
    (model?: ModelInfo) => {
      if (!model) return;
      setModelDetail(null);
      if (model.id === CONFIGURE_ENTRY_ID) {
        void openConfigMenu({ returnToModels: true });
        return;
      }
      void handleModelSwitch(model.id);
    },
    [handleModelSwitch, openConfigMenu]
  );

  const isModelDetailOpen = Boolean(modelDetail);

  const safeModelMenuIndex =
    filteredModelList.length === 0
      ? 0
      : Math.min(modelMenuState.selectedIndex, filteredModelList.length - 1);

  const safeSessionMenuIndex =
    sessionMenuState.sessions.length === 0
      ? 0
      : Math.min(sessionMenuState.selectedIndex, sessionMenuState.sessions.length - 1);

  const sessionTotalPages = Math.ceil(sessionMenuState.sessions.length / SESSION_PAGE_SIZE);

  useMenuNavigation({
    isOpen: modelMenuState.open && !isModelDetailOpen,
    totalItems: filteredModelList.length,
    selectedIndex: safeModelMenuIndex,
    onChangeIndex: (nextIndex) => {
      setModelMenuState((prev) => ({ ...prev, selectedIndex: nextIndex }));
    },
    onSubmit: (index) => {
      const model = filteredModelList[index];
      setModelMenuState(initialModelMenuState);
      handleModelMenuSubmit(model);
    },
    onClose: closeModelMenu,
  });

  useMenuNavigation({
    isOpen: sessionMenuState.open,
    totalItems: sessionMenuState.sessions.length,
    selectedIndex: safeSessionMenuIndex,
    wrap: false,
    onChangeIndex: (nextIndex) => {
      setSessionMenuState((prev) => {
        if (!prev.sessions.length) return prev;
        const total = prev.sessions.length;
        const clamped = Math.max(0, Math.min(total - 1, nextIndex));
        const newPage = Math.floor(clamped / SESSION_PAGE_SIZE);
        return { ...prev, selectedIndex: clamped, currentPage: newPage };
      });
    },
    onSubmit: (index) => {
      const session = sessionMenuState.sessions[index];
      if (!session) return;
      closeSessionMenu();
      void handleSessionResume(session.id);
    },
    onClose: closeSessionMenu,
    paging: {
      totalPages: sessionTotalPages,
      onPageChange: (direction) => changeSessionPage(direction),
    },
  });

  const copyConversation = async ({ onlyModel, limit }: { onlyModel: boolean; limit?: number }) => {
    const allMessages = messages;
    const source = onlyModel ? allMessages.filter((msg) => msg.role === 'assistant') : allMessages;

    if (!source.length) {
      addMessage({
        role: 'system',
        content: onlyModel
          ? 'No model responses are available yet to copy.'
          : 'No conversation history available to copy yet.',
        timestamp: Date.now(),
      });
      return;
    }

    const normalizedLimit = limit && limit > 0 ? limit : undefined;
    const selection = normalizedLimit ? source.slice(-normalizedLimit) : source;

    const formatted = selection
      .map((msg, idx) => {
        const label = onlyModel ? `MODEL #${source.length - selection.length + idx + 1}` : msg.role.toUpperCase();
        const timestamp = new Date(msg.timestamp).toISOString();
        return `[${label}] ${timestamp}\n${msg.content}`;
      })
      .join('\n\n');

    try {
      await clipboard.write(formatted);
      addMessage({
        role: 'system',
        content: `Copied ${onlyModel ? 'model output' : 'conversation'} (${selection.length} block${selection.length === 1 ? '' : 's'}) to clipboard.`,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to copy text: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  };

  const performToolCall = useCallback(async (descriptor: McpToolDescriptor, args: Record<string, any>) => {
    if (descriptor.name === 'search_tools') {
      const results = await mcpManager.searchTools(String(args.query || ''), args.limit || 20);
      if (!results.length) return 'No tools matched that query.';
      return results.map((t) => `${t.name} — ${t.description || 'no description'} (${t.source})`).join('\n');
    }

    if (descriptor.source === 'server') {
      const response = await mcpManager.callServerTool(descriptor, args);
      return response.output;
    }
    const svc = toolServiceRef.current;
    if (!svc) {
      throw new Error('Tool service not initialized');
    }
    const exec = await svc.execute({ tool: descriptor.name as ToolName, params: args });
    return exec.output;
  }, []);

  const handleConfirmAction = async (pending?: Action) => {
    const action = pending || pendingAction;
    if (!action) return;

    if (action.type === 'tool_call' && coreApprovalRef.current) {
      const resolve = coreApprovalRef.current;
      coreApprovalRef.current = null;
      setPendingAction(null);
      resolve(true);
      return;
    }

    setPendingAction(null);
    let result = '';

    if (action.type === 'shell_exec') {
      const execService = new ExecutionService();
      result = await execService.runShell(action.params.command, action.params.cwd);
    } else if (action.type === 'file_edit') {
      const fsService = new FileSystemService();
      try {
        await fsService.applyEdit(action.params.path, action.params.find_string, action.params.replace_string);
        result = 'File edited successfully.';
      } catch (error: any) {
        result = 'Error editing file: ' + error.message;
      }
    } else if (action.type === 'tool_call') {
      try {
        const descriptor = action.params.descriptor as McpToolDescriptor | undefined;
        const args = action.params.args || {};
        if (!descriptor) {
          result = 'Tool descriptor missing for requested call.';
        } else {
          const output = await performToolCall(descriptor, args);
          result = `Tool ${descriptor.name} output:\n${truncateOutput(output)}`;
        }
      } catch (error: any) {
        result = `Error executing tool: ${error.message}`;
      }
    }

    addMessage({ role: 'system', content: `Action Executed:\n${result}`, timestamp: Date.now() });
  };

  const handleRejectAction = () => {
    if (coreApprovalRef.current) {
      const resolve = coreApprovalRef.current;
      coreApprovalRef.current = null;
      setPendingAction(null);
      addMessage({ role: 'system', content: 'Action Rejected by user.', timestamp: Date.now() });
      resolve(false);
      return;
    }
    setPendingAction(null);
    addMessage({ role: 'system', content: 'Action Rejected by user.', timestamp: Date.now() });
  };

  const runToolEnabledConversation = useCallback(
    async ({
      provider,
      contextForModel,
      modelUsageKey,
      modelName,
      signal,
      userText,
    }: {
      provider: ReturnType<typeof LLMFactory.createProvider>;
      contextForModel: ChatMessage[];
      modelUsageKey: string;
      modelName?: string;
      signal?: AbortSignal;
      userText: string;
    }) => {
      if (!mcpManager) return false;

      const allTools = await mcpManager.listAllTools();
      const exposedTools = selectToolsForQuery(
        allTools.filter(
          (tool) => tool.source === 'server' || SAFE_TOOL_NAMES.includes(tool.name as ToolName)
        ),
        userText
      );
      if (!exposedTools.length) {
        return false;
      }

      const toolPrompt = buildToolAvailabilityPrompt(exposedTools);
      const systemPrompt = buildSystemPrompt(activeProfile);
      const systemContent = toolPrompt ? `${systemPrompt}\n\n${toolPrompt}` : systemPrompt;

      const toolMap = new Map(exposedTools.map((tool) => [tool.name, tool]));
      const openAiTools = exposedTools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
        },
      }));

      addMessage({
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        model: modelName,
        modelName,
        streaming: true,
      });

      let finalUsage: TokenUsage | undefined;
      const toolNames: string[] = [];

      const toolSession = createSession(projectRoot, 'tui-tools');
      const toolAgent = new CoreAgent({
        provider: adaptLegacyProvider(provider),
        model: modelName,
        temperature: activeProfile?.temperature,
        modelUsageKey,
        signal,
        dispatcher: {
          listTools: () => exposedTools.map((tool) => ({ name: tool.name })),
          requiresApproval: (name: string) => {
            const descriptor = toolMap.get(name);
            if (!descriptor) return false;
            return Boolean(descriptor.annotations?.destructiveHint) && !autoApproveActions;
          },
          execute: async (call) => {
            const descriptor = toolMap.get(call.name);
            if (!descriptor) {
              return {
                tool: call.name,
                success: false,
                output: `Tool ${call.name} not found or unavailable.`,
                durationMs: 0,
              };
            }
            const started = Date.now();
            try {
              const output = await performToolCall(descriptor, call.arguments || {});
              return { tool: call.name, success: true, output, durationMs: Date.now() - started };
            } catch (error: any) {
              return {
                tool: call.name,
                success: false,
                output: `Tool ${call.name} failed: ${error.message}`,
                durationMs: Date.now() - started,
              };
            }
          },
        },
        toolDefinitions: openAiTools,
        maxSteps: config?.agent_loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps,
        maxToolCallsPerTurn:
          config?.agent_loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn,
        truncationLimit:
          config?.agent_loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars,
        systemPrompt: systemContent,
      });
      toolSession.messages.push(
        ...contextForModel
          .filter((msg) => msg.role !== 'system')
          .map((msg) => ({ ...msg }))
      );

      const toolResult = await toolAgent.run(toolSession, userText, (event) => {
        if (event.type === 'tool_call') {
          toolNames.push(event.call.name);
          updateLastMessage(`Calling tools: ${toolNames.join(', ')}`, undefined, { streaming: true });
        } else if (event.type === 'tool_result') {
          const userMessage = [
            `tool_result:${event.result.tool}`,
            `output:\n${truncateOutput(event.result.output)}`,
          ].join('\n');
          addMessage({ role: 'system', content: userMessage, timestamp: Date.now() });
        } else if (event.type === 'usage') {
          finalUsage = event.usage;
        } else if (event.type === 'approval_request') {
          const descriptor = toolMap.get(event.call.name);
          const action: Action = {
            type: 'tool_call',
            params: {
              tool: event.call.name,
              args: event.call.arguments || {},
              descriptor,
              serverId: descriptor?.serverId,
            },
            status: 'pending',
          };
          coreApprovalRef.current = event.decide;
          setPendingAction(action);
          updateLastMessage(
            `Tool ${event.call.name} requires approval. Press [1]=yes, [2]=yes (don't ask again), [3]=no.`,
            finalUsage,
            { streaming: false }
          );
          setStatus('idle');
        }
      });

      if (toolResult.status === 'ok') {
        setStatus('streaming');
        updateLastMessage(toolResult.response, finalUsage, { streaming: false });
        await persistTurn();
        if (finalUsage) {
          incrementModelTokenUsage(modelUsageKey, finalUsage);
        }
        setStatus('idle');
        return true;
      }
      if (toolResult.status === 'refused') {
        setStatus('idle');
        return true;
      }
      updateLastMessage(toolResult.response || 'Tool run ended without a final answer.', finalUsage, {
        streaming: false,
      });
      setStatus('idle');
      return true;
    },
    [
      activeProfile,
      addMessage,
      autoApproveActions,
      incrementModelTokenUsage,
      performToolCall,
      persistTurn,
      setPendingAction,
      setStatus,
      updateLastMessage,
    ]
  );

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
