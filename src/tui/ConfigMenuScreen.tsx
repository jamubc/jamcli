import { useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { MenuOptionRow, MenuSectionHeader, MenuEmptyState } from './menu/MenuPrimitives.js';
import { HelpBar, SectionDivider, SplitMenuSurface, StyleListItem } from './config-menu/ConfigMenuPrimitives.js';
import { ConfigMenuRightPanel } from './config-menu/ConfigMenuRightPanel.js';
import { useConfigMenuNavigation } from './config-menu/useConfigMenuNavigation.js';
import { MENU_LABELS, matchesStyleQuery } from './config-menu/menuModel.js';
import type { Config, UiConfig } from '../types/config.js';
import type { McpServerConfig, McpTestResult } from '../types/mcp.js';
import type { StatusStyleOption } from './StatusStyleModal.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';

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
  const [styleFilter, setStyleFilter] = useState('');
  const { stdout } = useStdout();
  const availableColumns = stdout?.columns ?? 100;
  const surfaceWidth = Math.max(60, Math.min(availableColumns - 4, 110));
  const textOptions = useMemo(() => statusStyleOptions.filter((opt) => opt.kind === 'text'), [statusStyleOptions]);
  const spinnerOptions = useMemo(() => statusStyleOptions.filter((opt) => opt.kind === 'spinner'), [statusStyleOptions]);
  const actionOptions = useMemo(() => statusStyleOptions.filter((opt) => opt.kind === 'action'), [statusStyleOptions]);
  const activeTextId = uiConfig?.status_text_style || uiConfig?.status_indicator_style;
  const activeSpinnerId = uiConfig?.status_spinner_style || uiConfig?.status_indicator_style;
  const filterQuery = styleFilter.trim().toLowerCase();
  const filteredTextOptions = useMemo(
    () => textOptions.filter((opt) => matchesStyleQuery(opt, filterQuery)),
    [filterQuery, textOptions]
  );
  const filteredSpinnerOptions = useMemo(
    () => spinnerOptions.filter((opt) => matchesStyleQuery(opt, filterQuery)),
    [filterQuery, spinnerOptions]
  );
  const filteredStyleOptions = useMemo(
    () => [...filteredTextOptions, ...filteredSpinnerOptions, ...actionOptions],
    [actionOptions, filteredSpinnerOptions, filteredTextOptions]
  );

  const { activeMenu, options, focusArea } = useConfigMenuNavigation({
    visible,
    isCommandMode,
    config,
    uiConfig,
    statusStyleOptions,
    textOptions,
    spinnerOptions,
    filteredStyleOptions,
    activeTextId,
    activeSpinnerId,
    styleFilter,
    setStyleFilter,
    mcpServers,
    onClose,
    onUpdateProvider,
    onRemoveProvider,
    onSelectStatusStyle,
    onToggleContext,
    onToggleContextStrategy,
    onEditContextLimit,
    onToggleTelemetry,
    onToggleToolModelFilter,
    onAddMcpServer,
    onEditMcpServer,
    onRemoveMcpServer,
    onTestMcpServer,
    onTestAllMcpServers,
    onCopyMcpConfigPath,
    onOpenMcpConfig,
  });

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

  const selectedStyleOption = activeMenu.id === 'style' ? filteredStyleOptions[activeMenu.selectedIndex] : undefined;

  if (!visible) return null;

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
      rightPanel={
        <ConfigMenuRightPanel
          activeMenu={activeMenu}
          config={config}
          mcpServers={mcpServers}
          mcpTestResults={mcpTestResults}
          mcpConfigPath={mcpConfigPath}
          systemPrompt={systemPrompt}
          styleFilter={styleFilter}
          fallbackTextStyle={fallbackTextStyle}
          fallbackSpinnerStyle={fallbackSpinnerStyle}
          defaultTextOpt={defaultTextOpt}
          defaultSpinnerOpt={defaultSpinnerOpt}
          activeTextOpt={activeTextOpt}
          activeSpinnerOpt={activeSpinnerOpt}
          activeTextId={activeTextId}
          activeSpinnerId={activeSpinnerId}
          activeStatusSummary={activeStatusSummary}
          selectedStyleOption={selectedStyleOption}
        />
      }
      footer={<HelpBar focusArea={focusArea} />}
    />
  );
};
