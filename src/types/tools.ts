import type { Delegate, NestedApproval } from '../core/delegation/types.js';
import type { ToolResult as CoreToolResult } from '../core/types.js';
import type { ElicitationAnswer, ElicitationRequest } from '../core/mcp/connect.js';
import type { PermissionMode } from '../core/permissions/modes.js';
import type { DelegationConfig } from './config.js';

/**
 * The five tool names of the original interface. Kept only for the legacy per-tool
 * permission file and the Ink interface; the registry is the source of truth for tools.
 */
export type ToolName = 'list_files' | 'read_file' | 'search_code' | 'apply_patch' | 'run_command';

export type ToolPolicyClass = 'read' | 'write' | 'execute';

/** What a registered tool can do, which decides its default in each permission mode. */
export type RegisteredToolClass = ToolPolicyClass | 'network' | 'delegate' | 'state';

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

/**
 * A program `run_command` runs in the editor's terminal: exactly this program, which already
 * carries the sandbox and the environment JamCLI gives every command.
 */
export interface EditorTerminalRun {
  /** The tool call the terminal is shown under. */
  callId?: string;
  file: string;
  args: string[];
  cwd: string;
  /** Bytes of output the editor keeps, from the end. */
  outputByteLimit: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** How a program run in the editor's terminal ended, and what it printed. */
export interface EditorTerminalResult {
  terminalId: string;
  output: string;
  /** The editor dropped the start of the output to stay within the limit. */
  truncated: boolean;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
}

/**
 * What an editor lends the tools over ACP, each part only when the editor offers it:
 * reads that see unsaved changes, writes that land in open buffers, and a terminal the
 * person watches. Paths are absolute.
 */
export interface EditorBridge {
  readText?(path: string): Promise<string>;
  writeText?(path: string, content: string): Promise<void>;
  /** Rejects only when the editor could not start the program, so the caller may run it itself. */
  terminal?(run: EditorTerminalRun): Promise<EditorTerminalResult>;
}

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
  /** Added to a failed command's result when it ran in a sandbox. */
  sandboxNote?: string;
  /** Further directories tools may reach besides the project root. */
  additionalRoots?: string[];
  /** Force a search backend; `auto` uses ripgrep when it is on PATH. */
  searchBackend?: 'auto' | 'ripgrep' | 'builtin';
  /** Starts a child run for the task tool. Supplied by the runtime. */
  delegate?: Delegate;
  /** How many delegations deep this session is; 0 at the top. */
  delegationDepth?: number;
  delegationConfig?: DelegationConfig;
  /** Ask whoever answers this call's approvals about a nested call, such as a child run's. */
  requestApproval?: NestedApproval;
  /** Report what a nested call that was asked about went on to do. */
  onNestedResult?: (result: CoreToolResult) => void;
  /** The tool call this context runs, so what the tool starts can be shown under it. */
  callId?: string;
  /** The editor's files and terminal, when the session runs in an ACP editor that lends them. */
  editor?: EditorBridge;
  /** Ask the person one question, as an MCP server would. Absent where no one can answer. */
  elicit?: (request: ElicitationRequest) => Promise<ElicitationAnswer>;
  /**
   * Leave plan mode for the mode held before it, from the next turn. Returns that mode,
   * or why the switch was refused. Supplied by the runtime.
   */
  exitPlanMode?: () => { mode: string } | { refusal: string };
}

export type ToolRunner = (args: Record<string, any>, ctx: ToolContext) => Promise<ToolRunPayload>;

export interface RegisteredTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  policy: RegisteredToolClass;
  runner: ToolRunner;
  /** Registered and callable, but not advertised to the model. */
  hidden?: boolean;
  /** The canonical tool this one stands in for, so rules and grants for either apply to both. */
  aliasOf?: string;
  /** Asks every time: no rule, grant, or mode allows it ahead, and a deny still stops it. */
  alwaysAsks?: boolean;
  /** Offered only in these permission modes; a tool that means nothing elsewhere costs no context there. */
  modes?: PermissionMode[];
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
