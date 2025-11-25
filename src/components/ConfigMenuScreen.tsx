import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { MenuSurface, MenuOptionRow, MenuSectionHeader, MenuHint, MenuEmptyState } from './menu/MenuPrimitives.js';
import { StatusStylePreview } from './StatusStylePreview.js';
import type { Config, UiConfig } from '../types/config.js';
import type { StatusStyleOption } from './StatusStyleModal.js';
import { buildStatusStyle } from '../styles/statusStyles.js';
import type { StatusStyleDefinition } from '../styles/statusStyles.js';

type MenuId = 'main' | 'providers' | 'ollama' | 'openrouter' | 'style' | 'prompt';

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
  isCommandMode: boolean;
  systemPrompt?: string;
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
  isCommandMode,
  systemPrompt,
}: ConfigMenuScreenProps) => {
  const [menuStack, setMenuStack] = useState<MenuState[]>([{ id: 'main', selectedIndex: 0 }]);
  const activeMenu = menuStack[menuStack.length - 1];
  const { stdout } = useStdout();
  const availableRows = stdout?.rows ?? 24;
  const availableColumns = stdout?.columns ?? 100;
  const surfaceWidth = Math.max(60, Math.min(availableColumns - 4, 110));

  // Reset stack when visibility changes
  useEffect(() => {
    if (visible) {
      setMenuStack([{ id: 'main', selectedIndex: 0 }]);
    }
  }, [visible]);

  const getActiveStyleIndex = () => {
    const activeTextId = uiConfig?.status_text_style || uiConfig?.status_indicator_style;
    const textIdx = statusStyleOptions.findIndex((opt) => opt.kind === 'text' && opt.id === activeTextId);
    if (textIdx >= 0) return textIdx;
    const activeSpinnerId = uiConfig?.status_spinner_style || uiConfig?.status_indicator_style;
    const spinIdx = statusStyleOptions.findIndex((opt) => opt.kind === 'spinner' && opt.id === activeSpinnerId);
    return spinIdx >= 0 ? spinIdx : 0;
  };

  const buildWindow = <T,>(items: T[], selectedIndex: number, windowSize: number) => {
    const size = Math.max(1, Math.min(windowSize, Math.max(1, items.length)));
    let start = Math.max(0, selectedIndex - Math.floor(size / 2));
    if (start + size > items.length) {
      start = Math.max(0, items.length - size);
    }
    return {
      start,
      end: start + size,
      windowed: items.slice(start, start + size),
    };
  };

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

  const handleSelect = (index: number) => {
    const currentId = activeMenu.id;

    if (currentId === 'main') {
      if (index === 0) pushMenu('providers');
      if (index === 1) pushMenu('style', getActiveStyleIndex());
      if (index === 2) pushMenu('prompt');
    } else if (currentId === 'providers') {
      if (index === 0) pushMenu('ollama');
      if (index === 1) pushMenu('openrouter');
    } else if (currentId === 'ollama') {
      if (index === 0) onUpdateProvider('ollama'); // Triggers wizard in Layout
      if (index === 1) onRemoveProvider('ollama');
    } else if (currentId === 'openrouter') {
      if (index === 0) onUpdateProvider('openrouter'); // Triggers wizard in Layout
      if (index === 1) onRemoveProvider('openrouter');
    } else if (currentId === 'style') {
      onSelectStatusStyle(statusStyleOptions[index], index);
    }
  };

  const getOptions = (menuId: MenuId) => {
    switch (menuId) {
      case 'main':
        return [
          { label: 'Configure providers', description: 'Ollama, OpenRouter' },
          { label: 'Status indicator style', description: 'Spinner & shimmer effects' },
          { label: 'System prompt', description: 'View or edit prompt' },
        ];
      case 'providers':
        return [
          { label: 'Ollama', description: config.api_registry.ollama?.endpoint || 'Not configured' },
          { label: 'OpenRouter', description: config.api_registry.openrouter?.api_key ? 'Configured' : 'Not configured' },
        ];
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
      default:
        return [];
    }
  };

  const options = getOptions(activeMenu.id);
  const maxVisibleStyleItems = Math.max(3, Math.min(Math.max(availableRows - 8, 3), 12));
  const styleWindow = activeMenu.id === 'style'
    ? buildWindow(statusStyleOptions, activeMenu.selectedIndex, maxVisibleStyleItems)
    : null;

  useInput((input, key) => {
    if (!visible || isCommandMode) return;

    if (key.escape) {
      popMenu();
      return;
    }

    if (key.upArrow) {
      setMenuStack(prev => {
        const last = prev[prev.length - 1];
        const newIndex = Math.max(0, last.selectedIndex - 1);
        return [...prev.slice(0, -1), { ...last, selectedIndex: newIndex }];
      });
    }

    if (key.downArrow) {
      setMenuStack(prev => {
        const last = prev[prev.length - 1];
        const max = options.length - 1;
        const newIndex = Math.min(max, last.selectedIndex + 1);
        return [...prev.slice(0, -1), { ...last, selectedIndex: newIndex }];
      });
    }

    if (key.return) {
      handleSelect(activeMenu.selectedIndex);
    }
  });

  if (!visible) return null;

  const renderRightPanel = () => {
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
    if (activeMenu.id === 'ollama') {
        return (
            <Box flexDirection="column" gap={1}>
              <Text bold color="cyan">Ollama Configuration</Text>
              <Text>Endpoint: {config.api_registry.ollama?.endpoint || 'http://localhost:11434'}</Text>
              <Text color="gray">Ensure Ollama is running locally.</Text>
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
    if (activeMenu.id === 'style') {
      const selectedOpt = statusStyleOptions[activeMenu.selectedIndex];
      const textOptions = statusStyleOptions.filter((opt) => opt.kind === 'text');
      const spinnerOptions = statusStyleOptions.filter((opt) => opt.kind === 'spinner');
      const defaultTextOpt = textOptions[0];
      const defaultSpinnerOpt = spinnerOptions[0];
      const fallbackTextStyle = defaultTextOpt?.textStyle;
      const fallbackSpinnerStyle = defaultSpinnerOpt?.spinnerStyle;

      if (!fallbackTextStyle || !fallbackSpinnerStyle) {
        return <MenuEmptyState message="No styles are available yet. Add or reload styles." />;
      }

      const activeTextOpt =
        textOptions.find((opt) => opt.id === (uiConfig?.status_text_style || uiConfig?.status_indicator_style)) ||
        defaultTextOpt;
      const activeSpinnerOpt =
        spinnerOptions.find((opt) => opt.id === (uiConfig?.status_spinner_style || uiConfig?.status_indicator_style)) ||
        defaultSpinnerOpt;

      if (!selectedOpt) {
        return <MenuEmptyState message="No status styles found. Add one to preview it." />;
      }

      if (selectedOpt.kind === 'action') {
        return (
          <Box flexDirection="column" gap={1}>
            <Text bold color="cyan">Style actions</Text>
            <Text>{selectedOpt.label}</Text>
            {selectedOpt.description && <Text color="gray">{selectedOpt.description}</Text>}
            {selectedOpt.meta && <Text color="gray">Location: {selectedOpt.meta}</Text>}
            <MenuHint text="Press Enter to run this action." />
          </Box>
        );
      }

      const previewStyle =
        selectedOpt.kind === 'text'
          ? buildStatusStyle(selectedOpt.textStyle, activeSpinnerOpt?.spinnerStyle || fallbackSpinnerStyle)
          : buildStatusStyle(activeTextOpt?.textStyle || fallbackTextStyle, selectedOpt.spinnerStyle);
      const isActive =
        (selectedOpt.kind === 'text' &&
          (uiConfig?.status_text_style || uiConfig?.status_indicator_style) === selectedOpt.id) ||
        (selectedOpt.kind === 'spinner' &&
          (uiConfig?.status_spinner_style || uiConfig?.status_indicator_style) === selectedOpt.id);
      const activeDescription =
        activeTextOpt && activeSpinnerOpt
          ? `${activeTextOpt.label || 'text'} + ${activeSpinnerOpt.label || 'spinner'}`
          : currentStatusStyle.label;

      return (
        <Box flexDirection="column" gap={1}>
          <Text color="gray">Active: {activeDescription}</Text>
          <StatusStylePreview optionLabel={selectedOpt.label} optionSource={selectedOpt.source} path={selectedOpt.path} style={previewStyle} isActive={isActive} />
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

  return (
    <SplitMenuSurface
      title={activeMenu.id === 'main' ? 'Configuration' : `Configuration > ${activeMenu.id}`}
      width={surfaceWidth}
      leftPanel={
        <Box flexDirection="column">
            {activeMenu.id === 'prompt' ? (
              <Text color="gray">See right panel.</Text>
            ) : activeMenu.id === 'style' ? (
              <Box flexDirection="column" gap={0}>
                <MenuSectionHeader label="Text styles" />
                {styleWindow?.windowed?.filter((opt) => opt.kind === 'text').map((opt) => {
                  const globalIndex = statusStyleOptions.indexOf(opt);
                  return (
                    <MenuOptionRow
                      key={`${opt.id}-text`}
                      label={opt.label}
                      description={opt.description}
                      meta={globalIndex === activeMenu.selectedIndex ? 'selected' : opt.source}
                      isSelected={globalIndex === activeMenu.selectedIndex}
                      accentColor="magenta"
                    />
                  );
                })}
                <MenuSectionHeader label="Spinner styles" marginTop={1} />
                {styleWindow?.windowed?.filter((opt) => opt.kind === 'spinner').map((opt) => {
                  const globalIndex = statusStyleOptions.indexOf(opt);
                  return (
                    <MenuOptionRow
                      key={`${opt.id}-spinner`}
                      label={opt.label}
                      description={opt.description}
                      meta={globalIndex === activeMenu.selectedIndex ? 'selected' : opt.source}
                      isSelected={globalIndex === activeMenu.selectedIndex}
                      accentColor="cyan"
                    />
                  );
                })}
                <MenuSectionHeader label="Actions" marginTop={1} />
                {styleWindow?.windowed?.filter((opt) => opt.kind === 'action').map((opt) => {
                  const globalIndex = statusStyleOptions.indexOf(opt);
                  return (
                    <MenuOptionRow
                      key={`${opt.id}-action`}
                      label={opt.label}
                      description={opt.description}
                      meta={opt.meta}
                      isSelected={globalIndex === activeMenu.selectedIndex}
                      accentColor="yellow"
                    />
                  );
                })}
                {styleWindow && styleWindow.windowed.length < statusStyleOptions.length && (
                  <Box marginTop={1} paddingX={1}>
                    <MenuHint text={`Showing ${styleWindow.start + 1}-${styleWindow.end} of ${statusStyleOptions.length}`} />
                  </Box>
                )}
              </Box>
            ) : (
              options.map((opt, idx) => (
                <MenuOptionRow
                  key={idx}
                  label={opt.label}
                  description={opt.description}
                  isSelected={idx === activeMenu.selectedIndex}
                  accentColor="magenta"
                />
              ))
            )}
        </Box>
      }
      rightPanel={renderRightPanel()}
      footer={<MenuHint text="↑/↓ navigate · Enter select · Esc back" />}
    />
  );
};
