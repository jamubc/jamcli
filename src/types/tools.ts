export type ToolName = 'list_files' | 'read_file' | 'search_code' | 'apply_patch' | 'run_command';

export type ToolPolicyClass = 'read' | 'write' | 'execute';

export interface ToolDefinition {
  label: string;
  description: string;
  policy: ToolPolicyClass;
  category: 'safe' | 'elevated';
  defaultAllowed: boolean;
  defaultRequireApproval?: boolean;
}

const defineTool = (definition: Omit<ToolDefinition, 'category'>): ToolDefinition => ({
  ...definition,
  category: definition.policy === 'read' ? 'safe' : 'elevated',
});

export const TOOL_DEFINITIONS: Record<ToolName, ToolDefinition> = {
  list_files: defineTool({
    label: 'List Files',
    description: 'List project files with optional glob filters',
    policy: 'read',
    defaultAllowed: true,
  }),
  read_file: defineTool({
    label: 'Read File',
    description: 'Read file content with optional line range',
    policy: 'read',
    defaultAllowed: true,
  }),
  search_code: defineTool({
    label: 'Search Code',
    description: 'Search codebase using ripgrep-compatible patterns',
    policy: 'read',
    defaultAllowed: true,
  }),
  apply_patch: defineTool({
    label: 'Apply Patch',
    description: 'Apply unified diffs to modify files',
    policy: 'write',
    defaultAllowed: true,
    defaultRequireApproval: true,
  }),
  run_command: defineTool({
    label: 'Run Command',
    description: 'Execute shell commands within the workspace',
    policy: 'execute',
    defaultAllowed: true,
    defaultRequireApproval: true,
  }),
};

export const ALL_TOOL_NAMES = Object.keys(TOOL_DEFINITIONS) as ToolName[];

export const TOOL_POLICY: Record<ToolName, ToolPolicyClass> = Object.fromEntries(
  ALL_TOOL_NAMES.map((name) => [name, TOOL_DEFINITIONS[name].policy])
) as Record<ToolName, ToolPolicyClass>;

export const SAFE_TOOL_NAMES: ToolName[] = ALL_TOOL_NAMES.filter((name) => TOOL_POLICY[name] === 'read');

export const DANGEROUS_TOOL_NAMES: ToolName[] = ALL_TOOL_NAMES.filter(
  (tool) => TOOL_DEFINITIONS[tool].category === 'elevated'
);

export type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

/**
 * The JSON Schema subset the registry validates. It is intentionally small but
 * real: object, property, required, additionalProperties, item, enum, and range
 * checks all participate in validation.
 */
export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  default?: unknown;
}

export interface ToolRunPayload {
  output: string;
  metadata?: Record<string, unknown>;
  /**
   * How the work ended when it ran but did not succeed, such as a command that exited
   * non-zero or timed out. Omitted means success.
   */
  status?: 'ok' | 'error' | 'timeout' | 'cancelled';
}

/** Rewrites a shell command to run inside a sandbox. Supplied by the runtime. */
export type CommandWrapper = (
  command: string,
  options: { cwd: string; env: Record<string, string> }
) => { file: string; args: string[] };

export interface ToolContext {
  projectRoot: string;
  signal?: AbortSignal;
  ignorePatterns?: string[];
  /** Streams partial output, such as a running command's output, to the surface. */
  onProgress?: (chunk: string) => void;
  /** Environment for processes a tool starts. Defaults to the caller's environment. */
  env?: Record<string, string>;
  /** Default command timeout in milliseconds. */
  commandTimeoutMs?: number;
  /** Characters of output kept before the middle is cut. */
  maxOutputChars?: number;
  /** Wraps commands in a sandbox when one is active. */
  wrapCommand?: CommandWrapper;
  /** Further directories tools may reach besides the project root. */
  additionalRoots?: string[];
}

export type ToolRunner = (args: Record<string, any>, ctx: ToolContext) => Promise<ToolRunPayload>;

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  policy: ToolPolicyClass;
  runner: ToolRunner;
}

export interface RegistryValidationResult {
  valid: boolean;
  errors: string[];
}

export interface RegistryToolResult {
  tool: string;
  success: boolean;
  output: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
  status?: 'ok' | 'error' | 'timeout' | 'cancelled';
}

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
