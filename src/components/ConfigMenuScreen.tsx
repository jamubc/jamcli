import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { MenuSurface, MenuOptionRow, MenuSectionHeader, MenuHint, MenuEmptyState } from './menu/MenuPrimitives.js';
import { StatusStylePreview } from './StatusStylePreview.js';
import type { Config, UiConfig } from '../types/config.js';
import type { McpServerConfig, McpTestResult } from '../types/mcp.js';
import type { StatusStyleOption } from './StatusStyleModal.js';
import { buildStatusStyle } from '../styles/statusStyles.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';

type MenuId = 'main' | 'providers' | 'general' | 'ollama' | 'openrouter' | 'style' | 'prompt' | 'context' | 'telemetry' | 'mcp';
type FocusArea = 'left' | 'right';

const MENU_LABELS: Record<MenuId, string> = {
  main: 'Configuration',
  providers: 'Providers',
  general: 'General',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  style: 'Status Indicator',
  prompt: 'System Prompt',
  context: 'Context Management',
  telemetry: 'Telemetry',
  mcp: 'MCP Servers',
};

interface MenuState {
  id: MenuId;
  selectedIndex: number;
}

interface ConfigMenuScreenProps {
  visible: boolean;
  config: Config;
  uiConfig: UiConfig | null;
  currentStatusStyle: StatusStyleDefinition;
  statusStyleOptions: StatusStyleOption[];
  onClose: () => void;
  onUpdateProvider: (provider: 'ollama' | 'openrouter', value?: string) => void;
  onRemoveProvider: (provider: 'ollama' | 'openrouter') => void;
  onSelectStatusStyle: (option: StatusStyleOption | undefined, index: number) => void;
  onUpdateSystemPrompt: (prompt: string) => void; // Placeholder for now, maybe just view
  onToggleContext?: () => void;
  onToggleContextStrategy?: () => void;
  onEditContextLimit?: (field: 'max_tokens' | 'compression_threshold') => void;
  onToggleTelemetry?: (enabled: boolean) => void;
  onToggleToolModelFilter?: (enabled: boolean) => void;
  isCommandMode: boolean;
  systemPrompt?: string;
  mcpServers: McpServerConfig[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpConfigPath: string;
  onAddMcpServer: () => void;
  onEditMcpServer: (server: McpServerConfig) => void;
  onRemoveMcpServer: (server: McpServerConfig) => void;
  onTestMcpServer: (server: McpServerConfig) => void;
  onTestAllMcpServers: () => void;
  onCopyMcpConfigPath: () => void;
  onOpenMcpConfig: () => void;
  mcpServers: McpServerConfig[];
  mcpTestResults: Record<string, McpTestResult>;
  mcpConfigPath: string;
  onAddMcpServer: () => void;
  onEditMcpServer: (server: McpServerConfig) => void;
  onRemoveMcpServer: (server: McpServerConfig) => void;
  onTestMcpServer: (server: McpServerConfig) => void;
  onTestAllMcpServers: () => void;
  onCopyMcpConfigPath: () => void;
  onOpenMcpConfig: () => void;
}

const SplitMenuSurface = ({
  title,
  subtitle,
  borderColor = 'cyan',
  leftPanel,
  rightPanel,
  footer,
  width = 100,
}: {
  title: string;
  subtitle?: string;
  borderColor?: string;
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) => {
  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      marginY={1}
      gap={1}
      width={width}
    >
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Text color={borderColor} bold>
          {title}
        </Text>
        {subtitle && <Text color="gray">{subtitle}</Text>}
      </Box>
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" width="50%">
          {leftPanel}
        </Box>
        <Box width={1} flexDirection="column">
           <Box height="100%" borderStyle="single" borderLeft={false} borderTop={false} borderBottom={false} borderRightColor="gray" />
        </Box>
        <Box flexDirection="column" width="50%" paddingLeft={1}>
          {rightPanel}
        </Box>
      </Box>
      {footer && <Box>{footer}</Box>}
    </Box>
  );
};

const StyleListItem = ({
  label,
  meta,
  isFocused,
  isActive,
  accentColor,
  hotkey,
}: {
  label: string;
  meta?: string;
  isFocused: boolean;
  isActive: boolean;
  accentColor: string;
  hotkey?: string;
}) => {
  const foreground = isFocused ? 'black' : 'white';
  const metaColor = isActive ? 'green' : isFocused ? 'black' : 'gray';
  const badgeColor = isFocused ? 'black' : 'yellow';

  return (
    <Box paddingX={1} paddingY={0} backgroundColor={isFocused ? accentColor : undefined}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={isFocused ? 'black' : 'gray'}>{isFocused ? '>' : ' '}</Text>
        <Box flexDirection="row" flexGrow={1} justifyContent="space-between">
          <Text color={foreground} bold={isFocused || isActive}>
            {isActive ? '✓ ' : ''}
            {label}
          </Text>
          {meta && (
            <Text color={metaColor} dimColor={!isFocused && !isActive}>
              {meta}
            </Text>
          )}
        </Box>
        {hotkey && <Text color={badgeColor}>{hotkey}</Text>}
      </Box>
    </Box>
  );
};

const SectionDivider = () => (
  <Box paddingX={1}>
    <Text color="gray">{'-'.repeat(36)}</Text>
  </Box>
);

const HelpBar = ({ focusArea }: { focusArea: FocusArea }) => (
  <Box paddingX={1} paddingY={0} backgroundColor="gray">
    <Text color="black">
      ↑/↓ Navigate · Enter Apply · / Search · Tab Switch Pane · Esc Cancel · Pane: {focusArea === 'left' ? 'List' : 'Preview'}
    </Text>
  </Box>
);

export const ConfigMenuScreen = ({
  visible,
  config,
  uiConfig,
  currentStatusStyle,
  statusStyleOptions,
  onClose,
  onUpdateProvider,
  onRemoveProvider,
  onSelectStatusStyle,
  onUpdateSystemPrompt,
  onToggleContext,
  onToggleContextStrategy,
  onEditContextLimit,
  onToggleTelemetry,
  onToggleToolModelFilter,
  isCommandMode,
  systemPrompt,
  mcpServers,
  mcpTestResults,
  mcpConfigPath,
  onAddMcpServer,
  onEditMcpServer,
  onRemoveMcpServer,
  onTestMcpServer,
  onTestAllMcpServers,
  onCopyMcpConfigPath,
  onOpenMcpConfig,
}: ConfigMenuScreenProps) => {
  const [menuStack, setMenuStack] = useState<MenuState[]>([{ id: 'main', selectedIndex: 0 }]);
  const [styleFilter, setStyleFilter] = useState('');
  const [focusArea, setFocusArea] = useState<FocusArea>('left');
  const activeMenu = menuStack[menuStack.length - 1];
  const { stdout } = useStdout();
  const availableColumns = stdout?.columns ?? 100;
  const surfaceWidth = Math.max(60, Math.min(availableColumns - 4, 110));
  const textOptions = useMemo(() => statusStyleOptions.filter((opt) => opt.kind === 'text'), [statusStyleOptions]);
  const spinnerOptions = useMemo(() => statusStyleOptions.filter((opt) => opt.kind === 'spinner'), [statusStyleOptions]);
  const actionOptions = useMemo(() => statusStyleOptions.filter((opt) => opt.kind === 'action'), [statusStyleOptions]);
  const activeTextId = uiConfig?.status_text_style || uiConfig?.status_indicator_style;
  const activeSpinnerId = uiConfig?.status_spinner_style || uiConfig?.status_indicator_style;
  const filterQuery = styleFilter.trim().toLowerCase();
  const matchesQuery = useCallback(
    (option: StatusStyleOption) => {
      if (!filterQuery) return true;
      const haystack = `${option.label} ${option.description || ''} ${option.id}`.toLowerCase();
      return haystack.includes(filterQuery);
    },
    [filterQuery]
  );
  const filteredTextOptions = useMemo(
    () => textOptions.filter((opt) => matchesQuery(opt)),
    [matchesQuery, textOptions]
  );
  const filteredSpinnerOptions = useMemo(
    () => spinnerOptions.filter((opt) => matchesQuery(opt)),
    [matchesQuery, spinnerOptions]
  );
  const filteredStyleOptions = useMemo(
    () => [...filteredTextOptions, ...filteredSpinnerOptions, ...actionOptions],
    [actionOptions, filteredSpinnerOptions, filteredTextOptions]
  );

  // Reset stack when visibility changes
  useEffect(() => {
    if (visible) {
      setMenuStack([{ id: 'main', selectedIndex: 0 }]);
      setStyleFilter('');
      setFocusArea('left');
    }
  }, [visible]);

  useEffect(() => {
    if (activeMenu.id !== 'style') return;
    const maxIndex = Math.max(0, filteredStyleOptions.length - 1);
    if (activeMenu.selectedIndex > maxIndex) {
      setMenuStack((prev) => {
        const last = prev[prev.length - 1];
        if (last.selectedIndex === maxIndex) return prev;
        return [...prev.slice(0, -1), { ...last, selectedIndex: maxIndex }];
      });
    }
  }, [activeMenu.id, activeMenu.selectedIndex, filteredStyleOptions.length]);

  useEffect(() => {
    if (activeMenu.id !== 'style') return;
    setMenuStack((prev) => {
      const last = prev[prev.length - 1];
      if (last.selectedIndex === 0) return prev;
      return [...prev.slice(0, -1), { ...last, selectedIndex: 0 }];
    });
  }, [activeMenu.id, filterQuery]);

  const getActiveStyleIndex = useCallback(() => {
    const textIdx = textOptions.findIndex((opt) => opt.id === activeTextId);
    if (textIdx >= 0) {
      const global = filteredStyleOptions.findIndex((opt) => opt.id === textOptions[textIdx].id);
      if (global >= 0) return global;
      return textIdx;
    }

    const spinIdx = spinnerOptions.findIndex((opt) => opt.id === activeSpinnerId);
    if (spinIdx >= 0) {
      const global = filteredStyleOptions.findIndex((opt) => opt.id === spinnerOptions[spinIdx].id);
      if (global >= 0) return global;
      return textOptions.length + spinIdx;
    }

    return 0;
  }, [activeSpinnerId, activeTextId, filteredStyleOptions, spinnerOptions, textOptions]);

  const defaultTextOpt = textOptions[0];
  const defaultSpinnerOpt = spinnerOptions[0];
  const fallbackTextStyle = defaultTextOpt?.textStyle;
  const fallbackSpinnerStyle = defaultSpinnerOpt?.spinnerStyle;
  const activeTextOpt =
    textOptions.find((opt) => opt.id === (uiConfig?.status_text_style || uiConfig?.status_indicator_style)) ||
    defaultTextOpt;
  const activeSpinnerOpt =
    spinnerOptions.find((opt) => opt.id === (uiConfig?.status_spinner_style || uiConfig?.status_indicator_style)) ||
    defaultSpinnerOpt;
  const activeStatusSummary = useMemo(() => {
    if (activeTextOpt?.label && activeSpinnerOpt?.label) {
      return `${activeTextOpt.label} + ${activeSpinnerOpt.label}`;
    }
    return currentStatusStyle.label?.replace(/\sx\s/g, ' + ') || 'Default';
  }, [activeSpinnerOpt, activeTextOpt, currentStatusStyle.label]);

  const pushMenu = (id: MenuId, selectedIndex: number = 0) => {
    setMenuStack((prev) => [...prev, { id, selectedIndex }]);
  };

  const popMenu = () => {
    setMenuStack((prev) => {
      if (prev.length <= 1) {
        onClose();
        return prev;
      }
      return prev.slice(0, -1);
    });
  };

  const handleSelect = useCallback(
    (index: number) => {
      const currentId = activeMenu.id;

      if (currentId === 'main') {
        if (index === 0) pushMenu('providers');
        if (index === 1) pushMenu('general');
        if (index === 2) pushMenu('mcp');
        if (index === 3) pushMenu('context');
        if (index === 4) pushMenu('style', getActiveStyleIndex());
        if (index === 5) pushMenu('telemetry');
        if (index === 6) pushMenu('prompt');
      } else if (currentId === 'providers') {
        if (index === 0) pushMenu('ollama');
        if (index === 1) pushMenu('openrouter');
      } else if (currentId === 'ollama') {
        if (index === 0) onUpdateProvider('ollama'); // Triggers wizard in Layout
        if (index === 1) onRemoveProvider('ollama');
      } else if (currentId === 'openrouter') {
        if (index === 0) onUpdateProvider('openrouter'); // Triggers wizard in Layout
        if (index === 1) onRemoveProvider('openrouter');
      } else if (currentId === 'general') {
        if (onToggleToolModelFilter)
          onToggleToolModelFilter(!(config.general?.show_tool_calling_models_only ?? false));
      } else if (currentId === 'style') {
        const option = filteredStyleOptions[index];
        if (!option) return;
        onSelectStatusStyle(option, index);
      } else if (currentId === 'context') {
        if (index === 0 && onToggleContext) onToggleContext();
        if (index === 1 && onEditContextLimit) onEditContextLimit('max_tokens');
        if (index === 2 && onEditContextLimit) onEditContextLimit('compression_threshold');
        if (index === 3 && onToggleContextStrategy) onToggleContextStrategy();
      } else if (currentId === 'mcp') {
        if (index === 0) {
          onAddMcpServer();
          return;
        }
        if (index === 1) {
          onTestAllMcpServers();
          return;
        }
        const selected = mcpServers[index - 2];
        if (selected) {
          onEditMcpServer(selected);
        }
      } else if (currentId === 'telemetry') {
        if (onToggleTelemetry) onToggleTelemetry(!config.telemetry);
      }
    },
    [
      activeMenu.id,
      config.telemetry,
      config.general?.show_tool_calling_models_only,
      filteredStyleOptions,
      getActiveStyleIndex,
      mcpServers,
      onAddMcpServer,
      onEditMcpServer,
      onEditContextLimit,
      onRemoveProvider,
      onSelectStatusStyle,
      onTestAllMcpServers,
      onToggleContext,
      onToggleContextStrategy,
      onToggleToolModelFilter,
      onToggleTelemetry,
      onUpdateProvider,
      pushMenu,
    ]
  );

  const getOptions = (menuId: MenuId) => {
    switch (menuId) {
      case 'main':
      return [
        { label: 'Configure providers', description: 'Ollama, OpenRouter' },
        { label: 'General settings', description: 'Global preferences' },
        { label: 'MCP servers', description: 'List, edit, and test MCP entries' },
        { label: 'Context management', description: config.context_management?.enabled ? 'Enabled' : 'Disabled' },
        { label: 'Status indicator style', description: 'Spinner & shimmer effects' },
        { label: 'Telemetry', description: config.telemetry ? 'Enabled' : 'Disabled' },
        { label: 'System prompt', description: 'View or edit prompt' },
      ];
      case 'providers':
        return [
          { label: 'Ollama', description: config.api_registry.ollama?.endpoint || 'Not configured' },
          { label: 'OpenRouter', description: config.api_registry.openrouter?.api_key ? 'Configured' : 'Not configured' },
        ];
      case 'general': {
        const toolFilterEnabled = config.general?.show_tool_calling_models_only ?? false;
        return [
          {
            label: toolFilterEnabled ? 'Show only tool-calling models (On)' : 'Show only tool-calling models (Off)',
            description: 'Filters OpenRouter list to models that advertise tool support',
          },
        ];
      }
      case 'ollama':
        return [
          { label: 'Set endpoint', description: 'Current: ' + (config.api_registry.ollama?.endpoint || 'default') },
          { label: 'Remove provider', description: 'Disable Ollama' },
        ];
      case 'openrouter':
        return [
          { label: 'Set API key', description: 'Update key' },
          { label: 'Remove provider', description: 'Disable OpenRouter' },
        ];
      case 'context': {
        const ctx = config.context_management;
        const thresholdPct = ctx ? Math.round((ctx.compression_threshold || 1) * 100) : null;
        return [
          { label: ctx?.enabled ? 'Compression: Enabled' : 'Compression: Disabled', description: 'Toggle automatic compression' },
          { label: `Max tokens: ${ctx?.max_tokens ?? '8000 (default)'}`, description: 'Edit limit before compression triggers' },
          { label: `Threshold: ${thresholdPct ? `${thresholdPct}%` : '90% (default)'}`, description: 'Fraction of limit that triggers compression' },
          { label: `Strategy: ${ctx?.strategy || 'summarize'}`, description: 'Toggle between summarize and truncate' },
        ];
      }
      case 'style':
        return statusStyleOptions.map((opt) => {
          const isActive =
            (opt.kind === 'text' && (uiConfig?.status_text_style || uiConfig?.status_indicator_style) === opt.id) ||
            (opt.kind === 'spinner' && (uiConfig?.status_spinner_style || uiConfig?.status_indicator_style) === opt.id);
          return {
            label: opt.label,
            description:
              opt.kind !== 'action'
                ? opt.description || (opt.source === 'custom' ? 'Custom style' : opt.kind === 'text' ? 'Text style' : 'Spinner style')
                : opt.description,
            meta: opt.kind !== 'action' ? (isActive ? 'active' : opt.source) : opt.meta,
          };
        });
      case 'prompt':
        return []; // Special case, maybe just text
      case 'telemetry':
        return [{ label: config.telemetry ? 'Disable telemetry' : 'Enable telemetry', description: 'Usage data is local by default' }];
      case 'mcp': {
        const rows = [
          { label: 'Add MCP server', description: 'Register a new MCP entry' },
          { label: 'Test all servers', description: 'Run health checks on each' },
        ];
        const serverRows = mcpServers.map((server) => {
          const description = [server.command, ...(server.args || [])].join(' ');
          return {
            label: server.id,
            description: description || 'Command not set',
            meta: (server.transport || 'stdio').toUpperCase(),
          };
        });
        return [...rows, ...serverRows];
      }
      default:
        return [];
    }
  };

  const options = activeMenu.id === 'style' ? filteredStyleOptions : getOptions(activeMenu.id);

  const selectedStyleOption = activeMenu.id === 'style' ? filteredStyleOptions[activeMenu.selectedIndex] : undefined;

  useInput((input, key) => {
    if (!visible || isCommandMode) return;

    const isStyleMenu = activeMenu.id === 'style';
    const isShiftTab = input === '\u001b[Z';
    const isMcpMenu = activeMenu.id === 'mcp';
    const mcpServerIndex = activeMenu.selectedIndex - 2;
    const selectedMcpServer = mcpServers[mcpServerIndex];

    if (isMcpMenu && input) {
      if (input === 'a') {
        onAddMcpServer();
        return;
      }
      if (input === 't') {
        if (activeMenu.selectedIndex === 1) {
          onTestAllMcpServers();
        } else if (selectedMcpServer) {
          onTestMcpServer(selectedMcpServer);
        }
        return;
      }
      if (input === 'e' && selectedMcpServer) {
        onEditMcpServer(selectedMcpServer);
        return;
      }
      if (input === 'd' && selectedMcpServer) {
        onRemoveMcpServer(selectedMcpServer);
        return;
      }
      if (input === 'c') {
        onCopyMcpConfigPath();
        return;
      }
      if (input === 'o') {
        onOpenMcpConfig();
        return;
      }
    }

    if (key.tab || isShiftTab) {
      setFocusArea((prev) => (key.shift || isShiftTab ? 'left' : prev === 'left' ? 'right' : 'left'));
      return;
    }

    if (key.escape) {
      if (isStyleMenu && styleFilter) {
        setStyleFilter('');
        return;
      }
      popMenu();
      return;
    }

    if (isStyleMenu && selectedStyleOption?.kind === 'action') {
      const wantsOpen = selectedStyleOption.id === 'manage_custom' && (input === 'o' || input === 'O');
      const wantsAdd = selectedStyleOption.id === 'add_custom' && (input === 'a' || input === 'A');
      if (wantsOpen || wantsAdd) {
        handleSelect(activeMenu.selectedIndex);
        return;
      }
    }

    if (isStyleMenu) {
      if (key.backspace || key.delete) {
        setStyleFilter((prev) => prev.slice(0, -1));
        setFocusArea('left');
        return;
      }
      if (input === '/' && !key.ctrl && !key.meta) {
        setFocusArea('left');
        setStyleFilter((prev) => prev);
        return;
      }
      const isNavigationKey = key.return || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab;
      if (!isNavigationKey && input && input.trim().length > 0) {
        setFocusArea('left');
        setStyleFilter((prev) => prev + input);
        return;
      }
    }

    if (key.upArrow) {
      if (isStyleMenu && focusArea === 'right') return;
      setMenuStack((prev) => {
        const last = prev[prev.length - 1];
        const newIndex = Math.max(0, last.selectedIndex - 1);
        if (newIndex === last.selectedIndex) return prev;
        return [...prev.slice(0, -1), { ...last, selectedIndex: newIndex }];
      });
      return;
    }

    if (key.downArrow) {
      if (isStyleMenu && focusArea === 'right') return;
      setMenuStack((prev) => {
        const last = prev[prev.length - 1];
        const max = Math.max(0, options.length - 1);
        const newIndex = Math.min(max, last.selectedIndex + 1);
        if (newIndex === last.selectedIndex) return prev;
        return [...prev.slice(0, -1), { ...last, selectedIndex: newIndex }];
      });
      return;
    }

    if (key.return) {
      handleSelect(activeMenu.selectedIndex);
    }
  });

  if (!visible) return null;

  const renderRightPanel = () => {
    const mcpServerIndex = activeMenu.selectedIndex - 2;
    if (activeMenu.id === 'main') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">System Status</Text>
          <Text>Active Profile: {config.active_profile}</Text>
          <Text>Telemetry: {config.telemetry ? 'Enabled' : 'Disabled'}</Text>
          <Box marginTop={1}>
             <Text color="gray">Select a category on the left to configure.</Text>
          </Box>
        </Box>
      );
    }
    if (activeMenu.id === 'providers') {
       return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">Providers</Text>
          <Text>Manage your AI model providers here.</Text>
          <Text color="gray">Ollama is for local models.</Text>
          <Text color="gray">OpenRouter provides access to cloud models.</Text>
        </Box>
        );
    }
    if (activeMenu.id === 'general') {
      const toolFilterEnabled = config.general?.show_tool_calling_models_only ?? false;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">General Settings</Text>
          <Text>Tool filter: {toolFilterEnabled ? 'Only tool-capable models' : 'All models'}</Text>
          <Box marginTop={1}>
            <Text color="gray">When enabled, OpenRouter model listings will only include models that advertise tool support.</Text>
            <Text color="gray">Useful for keeping the model picker focused on tool-calling capable options.</Text>
          </Box>
        </Box>
      );
    }
    if (activeMenu.id === 'context') {
      const ctx = config.context_management;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">Context Management</Text>
          <Text>Status: {ctx?.enabled ? 'Enabled' : 'Disabled'}</Text>
          <Text>Max tokens: {ctx?.max_tokens ?? '8000 (default)'}</Text>
          <Text>Threshold: {ctx ? `${Math.round((ctx.compression_threshold || 1) * 100)}%` : '90%'}</Text>
          <Text>Strategy: {ctx?.strategy || 'summarize'}</Text>
          <Box marginTop={1}>
            <Text color="gray">Summaries keep the system prompt and the last few messages.</Text>
            <Text color="gray">Truncate keeps the system prompt plus the most recent messages under the limit.</Text>
          </Box>
        </Box>
      );
    }
    if (activeMenu.id === 'ollama') {
        return (
            <Box flexDirection="column" gap={1}>
              <Text bold color="cyan">Ollama Configuration</Text>
              <Text>Endpoint: {config.api_registry.ollama?.endpoint || 'http://localhost:11434'}</Text>
              <Text color="gray">Ensure Ollama is running locally.</Text>
            </Box>
        );
    }
    if (activeMenu.id === 'telemetry') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">Telemetry</Text>
          <Text>{config.telemetry ? 'Telemetry is enabled.' : 'Telemetry is disabled.'}</Text>
          <Text color="gray">JamCLI only sends telemetry when enabled. Toggle to opt in or out.</Text>
        </Box>
      );
    }
    if (activeMenu.id === 'openrouter') {
        return (
            <Box flexDirection="column" gap={1}>
              <Text bold color="cyan">OpenRouter Configuration</Text>
              <Text>Key: {config.api_registry.openrouter?.api_key ? '********' : 'Not set'}</Text>
            </Box>
        );
    }
    if (activeMenu.id === 'mcp') {
      const selectedServer = mcpServers[mcpServerIndex];
      const testResult = selectedServer ? mcpTestResults[selectedServer.id] : undefined;
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold color="cyan">MCP Servers</Text>
          <Text color="gray">Config file: {mcpConfigPath}</Text>
          <Text color="gray">Hotkeys: [A]dd · [T]est · [E]dit · [D]elete · [C]opy path · [O]pen file</Text>
          {selectedServer ? (
            <>
              <SectionDivider />
              <Text>Server: {selectedServer.id}</Text>
              <Text>Command: {selectedServer.command}</Text>
              <Text>Args: {selectedServer.args?.join(' ') || '(none)'}</Text>
              <Text>Transport: {(selectedServer.transport || 'stdio').toUpperCase()}</Text>
              <Text>Working dir: {selectedServer.cwd || 'Project root'}</Text>
              {testResult ? (
                <Text color={testResult.status === 'ok' ? 'green' : 'red'}>
                  Last test: {testResult.status.toUpperCase()} · {testResult.message}
                  {testResult.latencyMs ? ` · ${testResult.latencyMs} ms` : ''}
                </Text>
              ) : (
                <Text color="gray">Run a test to see status.</Text>
              )}
            </>
          ) : (
            <Text color="gray">Select a server to view config and test results.</Text>
          )}
        </Box>
      );
    }
    if (activeMenu.id === 'style') {
      if (!fallbackTextStyle || !fallbackSpinnerStyle) {
        return <MenuEmptyState message="No styles are available yet. Add or reload styles." />;
      }

      if (!selectedStyleOption) {
        return (
          <MenuEmptyState
            message={styleFilter ? `No styles match "${styleFilter}"` : 'No status styles found. Add one to preview it.'}
          />
        );
      }

      if (selectedStyleOption.kind === 'action') {
        const buttonLabel =
          selectedStyleOption.id === 'manage_custom'
            ? '[ Open styles directory (O) ]'
            : '[ Add custom style (A) ]';
        return (
          <Box flexDirection="column" gap={1}>
            <Text color="gray" bold>
              Action
            </Text>
            <Box borderStyle="round" borderColor="yellow" paddingX={1} paddingY={0}>
              <Text color="yellow">{buttonLabel}</Text>
            </Box>
            {selectedStyleOption.description && <Text color="gray">{selectedStyleOption.description}</Text>}
            {selectedStyleOption.meta && <Text color="gray">Location: {selectedStyleOption.meta}</Text>}
            <MenuHint text="Enter to run · Hotkeys: A or O while selected" />
          </Box>
        );
      }

      const previewStyle =
        selectedStyleOption.kind === 'text'
          ? buildStatusStyle(selectedStyleOption.textStyle, activeSpinnerOpt?.spinnerStyle || fallbackSpinnerStyle)
          : buildStatusStyle(activeTextOpt?.textStyle || fallbackTextStyle, selectedStyleOption.spinnerStyle);
      const previewLabel =
        selectedStyleOption.kind === 'text'
          ? `${selectedStyleOption.label} + ${activeSpinnerOpt?.label || defaultSpinnerOpt?.label || 'Spinner'}`
          : `${activeTextOpt?.label || defaultTextOpt?.label || 'Text'} + ${selectedStyleOption.label}`;
      const isActive =
        (selectedStyleOption.kind === 'text' && selectedStyleOption.id === activeTextId) ||
        (selectedStyleOption.kind === 'spinner' && selectedStyleOption.id === activeSpinnerId);

      return (
        <Box flexDirection="column" gap={1}>
          <Text color="gray" bold>
            Preview (Not Saved)
          </Text>
          <StatusStylePreview
            optionLabel={previewLabel}
            optionSource={selectedStyleOption.source}
            path={selectedStyleOption.path}
            style={previewStyle}
            isActive={isActive}
          />
          <SectionDivider />
          <Box flexDirection="column" gap={0}>
            <Text color="gray" bold>Current Config</Text>
            <Text>Active: {activeStatusSummary}</Text>
            <Text color="gray">
              Text: {activeTextOpt?.label || defaultTextOpt?.label || 'Default'} · Spinner:{' '}
              {activeSpinnerOpt?.label || defaultSpinnerOpt?.label || 'Default'}
            </Text>
          </Box>
          {!isActive && <MenuHint text="Press Enter to apply this choice." />}
        </Box>
      );
    }
    if (activeMenu.id === 'prompt') {
        return (
            <Box flexDirection="column" gap={1}>
                <Text bold color="cyan">System Prompt</Text>
                <Text>{systemPrompt || '(default)'}</Text>
                <Box marginTop={1}>
                  <Text color="gray">Use /config prompt set &lt;text&gt; to update.</Text>
                </Box>
            </Box>
        );
    }
    return null;
  };

  const headerTitle =
    activeMenu.id === 'main'
      ? MENU_LABELS.main
      : `${MENU_LABELS.main} › ${MENU_LABELS[activeMenu.id] || activeMenu.id}`;

  return (
    <SplitMenuSurface
      title={headerTitle}
      subtitle={`Active: ${activeStatusSummary}`}
      width={surfaceWidth}
      leftPanel={
        <Box flexDirection="column">
            {activeMenu.id === 'prompt' ? (
              <Text color="gray">See right panel.</Text>
            ) : activeMenu.id === 'style' ? (
              <Box flexDirection="column" gap={1}>
                <Box paddingX={1} flexDirection="row" justifyContent="space-between">
                  <Text color="gray">Filter</Text>
                  <Text color={styleFilter ? 'white' : 'gray'}>
                    {styleFilter || 'Type or / to search'}
                  </Text>
                </Box>
                <SectionDivider />
                <MenuSectionHeader label="Text styles" />
                {filteredTextOptions.length ? (
                  filteredTextOptions.map((opt) => {
                    const globalIndex = filteredStyleOptions.indexOf(opt);
                    const isFocused = globalIndex === activeMenu.selectedIndex;
                    const isActive = opt.id === activeTextId;
                    const meta = isActive ? 'active' : opt.source === 'custom' ? 'custom' : undefined;
                    return (
                      <StyleListItem
                        key={`${opt.id}-text`}
                        label={opt.label}
                        meta={meta}
                        isFocused={isFocused}
                        isActive={isActive}
                        accentColor="magenta"
                      />
                    );
                  })
                ) : (
                  <MenuEmptyState message={styleFilter ? `No text styles match "${styleFilter}"` : 'No text styles found.'} />
                )}
                <SectionDivider />
                <MenuSectionHeader label="Spinner styles" />
                {filteredSpinnerOptions.length ? (
                  filteredSpinnerOptions.map((opt) => {
                    const globalIndex = filteredStyleOptions.indexOf(opt);
                    const isFocused = globalIndex === activeMenu.selectedIndex;
                    const isActive = opt.id === activeSpinnerId;
                    const meta = isActive ? 'active' : opt.source === 'custom' ? 'custom' : undefined;
                    return (
                      <StyleListItem
                        key={`${opt.id}-spinner`}
                        label={opt.label}
                        meta={meta}
                        isFocused={isFocused}
                        isActive={isActive}
                        accentColor="cyan"
                      />
                    );
                  })
                ) : (
                  <MenuEmptyState message={styleFilter ? `No spinner styles match "${styleFilter}"` : 'No spinner styles found.'} />
                )}
                <SectionDivider />
                <MenuSectionHeader label="Actions" />
                {actionOptions.length ? (
                  actionOptions.map((opt) => {
                    const globalIndex = filteredStyleOptions.indexOf(opt);
                    const isFocused = globalIndex === activeMenu.selectedIndex;
                    const hotkey = opt.id === 'manage_custom' ? '[O]' : opt.id === 'add_custom' ? '[A]' : undefined;
                    const label =
                      opt.id === 'manage_custom'
                        ? '[ Open styles directory ]'
                        : opt.id === 'add_custom'
                          ? '[ Add custom style ]'
                          : opt.label;
                    return (
                      <StyleListItem
                        key={`${opt.id}-action`}
                        label={label}
                        meta={undefined}
                        isFocused={isFocused}
                        isActive={false}
                        accentColor="yellow"
                        hotkey={hotkey}
                      />
                    );
                  })
                ) : (
                  <MenuEmptyState message="No actions available." />
                )}
              </Box>
            ) : (
              options.map((opt, idx) => (
                <MenuOptionRow
                  key={idx}
                  label={opt.label}
                  description={opt.description}
                  meta={opt.meta}
                  isSelected={idx === activeMenu.selectedIndex}
                  accentColor="magenta"
                />
              ))
            )}
        </Box>
      }
      rightPanel={renderRightPanel()}
      footer={<HelpBar focusArea={focusArea} />}
    />
  );
};
