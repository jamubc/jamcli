export type ToolName = 'list_files' | 'read_file' | 'search_code' | 'apply_patch' | 'run_command';

export const SAFE_TOOL_NAMES: ToolName[] = ['list_files', 'read_file', 'search_code'];

export interface ToolDefinition {
  label: string;
  description: string;
  category: 'safe' | 'elevated';
  defaultAllowed: boolean;
  defaultRequireApproval?: boolean;
}

export const TOOL_DEFINITIONS: Record<ToolName, ToolDefinition> = {
  list_files: {
    label: 'List Files',
    description: 'List project files with optional glob filters',
    category: 'safe',
    defaultAllowed: true,
  },
  read_file: {
    label: 'Read File',
    description: 'Read file content with optional line range',
    category: 'safe',
    defaultAllowed: true,
  },
  search_code: {
    label: 'Search Code',
    description: 'Search codebase using ripgrep-compatible patterns',
    category: 'safe',
    defaultAllowed: true,
  },
  apply_patch: {
    label: 'Apply Patch',
    description: 'Apply unified diffs to modify files',
    category: 'elevated',
    defaultAllowed: true,
    defaultRequireApproval: true,
  },
  run_command: {
    label: 'Run Command',
    description: 'Execute shell commands within the workspace',
    category: 'elevated',
    defaultAllowed: true,
    defaultRequireApproval: true,
  },
};

export const ALL_TOOL_NAMES = Object.keys(TOOL_DEFINITIONS) as ToolName[];
export const DANGEROUS_TOOL_NAMES: ToolName[] = ALL_TOOL_NAMES.filter(
  (tool) => TOOL_DEFINITIONS[tool].category === 'elevated'
);

export interface ToolCall {
  tool: ToolName;
  params: Record<string, any>;
  raw?: unknown;
}

export interface ToolResult {
  tool: ToolName;
  success: boolean;
  output: string;
  durationMs: number;
  metadata?: Record<string, any>;
}
