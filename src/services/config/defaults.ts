import type { Config, ContextManagementConfig, McpConfig, ToolPermission } from '../../types/config.js';
import type { ToolName } from '../../types/tools.js';
import { ALL_TOOL_NAMES, TOOL_DEFINITIONS } from '../../types/tools.js';

export const JAMCLI_DIR = '.jamcli';
export const MCP_FILE = 'mcp.json';

export const TOOL_DEFAULTS = Object.fromEntries(
  ALL_TOOL_NAMES.map((name) => [
    name,
    {
      allowed: TOOL_DEFINITIONS[name].defaultAllowed,
      require_approval: TOOL_DEFINITIONS[name].defaultRequireApproval ?? false,
    } satisfies ToolPermission,
  ])
) as Record<ToolName, ToolPermission>;

export const DEFAULT_CONTEXT_MANAGEMENT: ContextManagementConfig = {
  enabled: false,
  max_tokens: 8000,
  compression_threshold: 0.9,
  strategy: 'summarize',
};

export const DEFAULT_CONFIG: Config = {
  api_registry: {
    ollama: { endpoint: 'http://localhost:11434' },
  },
  active_profile: 'default',
  telemetry: false,
  general: {
    show_tool_calling_models_only: false,
  },
  context_management: DEFAULT_CONTEXT_MANAGEMENT,
};

export const DEFAULT_MCP: McpConfig = {
  context_window_limit: 16000,
  ignore_patterns: ['node_modules/**', 'dist/**', '*.lock'],
  tools: {
    ...TOOL_DEFAULTS,
    git_ops: true,
  },
  servers: [],
};
