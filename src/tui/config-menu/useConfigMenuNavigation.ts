import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useInput } from 'ink';
import type { Config, UiConfig } from '../../types/config.js';
import type { McpServerConfig } from '../../types/mcp.js';
import type { StatusStyleOption } from '../StatusStyleModal.js';
import { getActiveStyleIndex, getMenuOptions, type FocusArea, type MenuId, type MenuState } from './menuModel.js';

export interface ConfigMenuNavigationOptions {
  visible: boolean;
  isCommandMode: boolean;
  config: Config;
  uiConfig: UiConfig | null;
  statusStyleOptions: StatusStyleOption[];
  textOptions: StatusStyleOption[];
  spinnerOptions: StatusStyleOption[];
  filteredStyleOptions: StatusStyleOption[];
  activeTextId: string | undefined;
  activeSpinnerId: string | undefined;
  styleFilter: string;
  setStyleFilter: Dispatch<SetStateAction<string>>;
  mcpServers: McpServerConfig[];
  onClose: () => void;
  onUpdateProvider: (provider: 'ollama' | 'openrouter', value?: string) => void;
  onRemoveProvider: (provider: 'ollama' | 'openrouter') => void;
  onSelectStatusStyle: (option: StatusStyleOption | undefined, index: number) => void;
  onToggleContext?: () => void;
  onToggleContextStrategy?: () => void;
  onEditContextLimit?: (field: 'max_tokens' | 'compression_threshold') => void;
  onToggleTelemetry?: (enabled: boolean) => void;
  onToggleToolModelFilter?: (enabled: boolean) => void;
  onAddMcpServer: () => void;
  onEditMcpServer: (server: McpServerConfig) => void;
  onRemoveMcpServer: (server: McpServerConfig) => void;
  onTestMcpServer: (server: McpServerConfig) => void;
  onTestAllMcpServers: () => void;
  onCopyMcpConfigPath: () => void;
  onOpenMcpConfig: () => void;
}

export const useConfigMenuNavigation = ({
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
}: ConfigMenuNavigationOptions) => {
  const [menuStack, setMenuStack] = useState<MenuState[]>([{ id: 'main', selectedIndex: 0 }]);
  const [focusArea, setFocusArea] = useState<FocusArea>('left');
  const activeMenu = menuStack[menuStack.length - 1];
  const filterQuery = styleFilter.trim().toLowerCase();
  const options =
    activeMenu.id === 'style'
      ? filteredStyleOptions
      : getMenuOptions(activeMenu.id, { config, uiConfig, statusStyleOptions, mcpServers });
  const selectedStyleOption = activeMenu.id === 'style' ? filteredStyleOptions[activeMenu.selectedIndex] : undefined;

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
      if (index === 1) pushMenu('general');
      if (index === 2) pushMenu('mcp');
      if (index === 3) pushMenu('context');
      if (index === 4)
        pushMenu(
          'style',
          getActiveStyleIndex({ textOptions, spinnerOptions, filteredStyleOptions, activeTextId, activeSpinnerId })
        );
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
  };

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

  return { activeMenu, options, styleFilter, focusArea, pushMenu, popMenu, handleSelect };
};
