import type { Config, ToolPermission } from '../types/config.js';
import { ALL_TOOL_NAMES, TOOL_DEFINITIONS } from '../types/tools.js';
import type { ToolName } from '../types/tools.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import type { ProviderSlug } from './layoutState.js';

export const TOOL_ALIAS_MAP: Record<string, ToolName> = {
  shell: 'run_command',
  run: 'run_command',
  command: 'run_command',
  bash: 'run_command',
  apply: 'apply_patch',
  patch: 'apply_patch',
  edit: 'apply_patch',
  files: 'list_files',
  list: 'list_files',
  ls: 'list_files',
  read: 'read_file',
  cat: 'read_file',
  search: 'search_code',
  rg: 'search_code',
};

export const normalizeToolIdentifier = (input?: string): ToolName | null => {
  if (!input) return null;
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const exact = ALL_TOOL_NAMES.find((name) => name === normalized);
  if (exact) return exact;
  return TOOL_ALIAS_MAP[normalized] ?? null;
};

export const formatToolStatusTable = (permissions: Record<ToolName, ToolPermission>) => {
  const header = 'Tool            Status   Mode   Description';
  const lines = ALL_TOOL_NAMES.map((name) => {
    const perm = permissions[name];
    const meta = TOOL_DEFINITIONS[name];
    const status = perm.allowed ? 'on ' : 'off';
    const mode = perm.allowed ? (perm.require_approval ? 'ask ' : 'auto') : 'off';
    return `${name.padEnd(15)} ${status.padEnd(7)} ${mode.padEnd(5)} ${meta.description}`;
  });
  return ['Tool permissions:', header, ...lines, '', 'Use /tools enable|disable|require|auto <tool_name> to update.'].join('\n');
};

export const describeToolMode = (perm: ToolPermission) => {
  if (!perm.allowed) return 'disabled';
  return perm.require_approval ? 'enabled (ask)' : 'enabled (auto)';
};

export const PROVIDER_ALIAS_MAP: Record<string, ProviderSlug> = {
  ollama: 'ollama',
  local: 'ollama',
  openrouter: 'openrouter',
  router: 'openrouter',
  or: 'openrouter',
};

export const normalizeProvider = (value?: string): ProviderSlug | null => {
  if (!value) return null;
  return PROVIDER_ALIAS_MAP[value.trim().toLowerCase()] ?? null;
};

export const maskKey = (value?: string) => {
  if (!value) return '(not set)';
  if (value.length <= 6) return `${value.slice(0, 2)}****`;
  return `${value.slice(0, 4)}****${value.slice(-2)}`;
};

export const formatProviderSummary = (cfg: Config | null) => {
  const ollamaEndpoint = cfg?.api_registry?.ollama?.endpoint || 'http://localhost:11434 (default)';
  const openrouterKey = cfg?.api_registry?.openrouter?.api_key;
  const lines = [
    'Providers:',
    `- Ollama endpoint: ${ollamaEndpoint}`,
    `- OpenRouter: ${openrouterKey ? `configured (${maskKey(openrouterKey)})` : 'not configured'}`,
    '',
    'Commands:',
    '/config provider list',
    '/config provider set ollama <http://host:port>',
    '/config provider set openrouter <api_key>',
  ];
  return lines.join('\n');
};

export const truncateOutput = (text: string, limit: number = DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars) => {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}\n… <truncated>` : text;
};
