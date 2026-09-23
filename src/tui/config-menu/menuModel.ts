import type { Config, UiConfig } from '../../types/config.js';
import type { McpServerConfig } from '../../types/mcp.js';
import type { StatusStyleOption } from '../StatusStyleModal.js';

export type MenuId = 'main' | 'providers' | 'general' | 'ollama' | 'openrouter' | 'style' | 'prompt' | 'context' | 'telemetry' | 'mcp';
export type FocusArea = 'left' | 'right';

export const MENU_LABELS: Record<MenuId, string> = {
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

export interface MenuState {
  id: MenuId;
  selectedIndex: number;
}

export interface MenuOptionsContext {
  config: Config;
  uiConfig: UiConfig | null;
  statusStyleOptions: StatusStyleOption[];
  mcpServers: McpServerConfig[];
}

export interface ActiveStyleIndexInput {
  textOptions: StatusStyleOption[];
  spinnerOptions: StatusStyleOption[];
  filteredStyleOptions: StatusStyleOption[];
  activeTextId: string | undefined;
  activeSpinnerId: string | undefined;
}

export const matchesStyleQuery = (option: StatusStyleOption, filterQuery: string): boolean => {
  if (!filterQuery) return true;
  const haystack = `${option.label} ${option.description || ''} ${option.id}`.toLowerCase();
  return haystack.includes(filterQuery);
};

export const getActiveStyleIndex = ({
  textOptions,
  spinnerOptions,
  filteredStyleOptions,
  activeTextId,
  activeSpinnerId,
}: ActiveStyleIndexInput) => {
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
};

export const getMenuOptions = (
  menuId: MenuId,
  { config, uiConfig, statusStyleOptions, mcpServers }: MenuOptionsContext
) => {
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
