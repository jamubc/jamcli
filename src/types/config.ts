import type { LspSettings } from '../core/lsp/manager.js';
import type { HookSettings } from '../core/hooks/commands.js';
import type { McpServerConfig } from './mcp.js';
import type { PermissionSettings } from '../core/permissions/config.js';
import type { SandboxSettings } from '../core/sandbox/types.js';
import type { OtelSettings } from '../core/observe/otlp.js';

export interface ApiRegistry {
  /** `num_ctx` sets the context window Ollama allocates for every request. */
  ollama?: { endpoint?: string; base_url?: string; num_ctx?: number };
  openai?: { api_key?: string; key_env_var?: string; base_url?: string };
  anthropic?: { api_key?: string; key_env_var?: string; base_url?: string };
  openrouter?: {
    api_key?: string;
    key_env_var?: string;
    base_url?: string;
    referer?: string;
    title?: string;
  };
  endpoints?: EndpointConfig[];
}

export interface EndpointConfig {
  id: string;
  base_url: string;
  dialect?: 'openai' | 'anthropic';
  api_key?: string;
  key_env_var?: string;
  headers?: Record<string, string>;
}

export interface CategoryEntry {
  model: string;
  reasoning?: 'off' | 'on' | 'auto';
}

export type CategoryChain = CategoryEntry[];

export interface DelegationConfig {
  max_depth: number;
  max_concurrent: number;
  max_turns_per_child: number;
}

export interface TrustConfig {
  enabled?: boolean;
  model?: string;
  threshold?: number;
  dedupe?: boolean;
}

export const DEFAULT_TRUST_CONFIG: TrustConfig = {
  threshold: 0.3,
  dedupe: true,
};

export const DEFAULT_DELEGATION_CONFIG: DelegationConfig = {
  max_depth: 2,
  max_concurrent: 3,
  max_turns_per_child: 8,
};

/**
 * What configuration says about one model, overriding the provider's metadata and the
 * bundled table. Prices are US dollars per million tokens.
 */
export interface ModelSettings {
  context_window?: number;
  max_output?: number;
  tools?: boolean;
  reasoning?: boolean;
  images?: boolean;
  thinking?: 'adaptive' | 'budget';
  always_thinks?: boolean;
  effort?: boolean;
  price?: { input: number; output: number; cache_read?: number; cache_write?: number };
}

export interface ModelInfo {
  id: string;
  provider: 'ollama' | 'openai' | 'anthropic' | 'openrouter';
  name: string;
  description?: string;
  supports_tool_calling?: boolean;
}

export interface ContextManagementConfig {
  enabled: boolean;
  max_tokens: number;
  compression_threshold: number; // 0.0 - 1.0
  strategy: 'summarize' | 'truncate';
}

export interface AgentLoopConfig {
  /** Model requests per user turn before the loop stops and asks. */
  max_steps: number;
  /** Tool calls per user turn; 0 means no cap beyond the step limit. */
  max_tool_calls_per_turn: number;
  /** Characters of one tool result kept in context; the middle is cut beyond it. */
  tool_result_max_chars: number;
  /** Default timeout for a command, in milliseconds. */
  command_timeout_ms?: number;
  /** Output tokens to ask for per reply. The model's own limit caps it. Defaults to 32,000. */
  max_output_tokens?: number;
}

/** Sized for multi-step work: reading, editing, and testing within one turn. */
export const DEFAULT_AGENT_LOOP_CONFIG: AgentLoopConfig = {
  max_steps: 50,
  max_tool_calls_per_turn: 0,
  tool_result_max_chars: 30_000,
  command_timeout_ms: 120_000,
};

export interface Config {
  /** The model sessions start on, as `provider:model` or a model on the profile's provider. */
  model?: string;
  api_registry: ApiRegistry;
  active_profile: string;
  telemetry: boolean;
  available_models?: ModelInfo[];
  context_management?: ContextManagementConfig;
  agent_loop?: AgentLoopConfig;
  general?: GeneralConfig;
  categories?: Record<string, CategoryChain>;
  delegation?: DelegationConfig;
  trust?: TrustConfig;
  /** Facts about models for the model catalog, keyed `provider:model`. */
  models?: Record<string, ModelSettings>;
  /** Context management for every surface. `context_management` configures only the legacy interface. */
  context?: ContextSettings;
  permissions?: PermissionSettings;
  sandbox?: SandboxSettings;
  /** The OpenTelemetry exporter, off unless `enabled`. */
  otel?: OtelSettings;
  /** How the interface looks and moves. */
  ui?: UiSettings;
  git?: GitSettings;
  /** Commands run at lifecycle events (D17). */
  hooks?: HookSettings;
  /** When MCP tools are found through `search_tools` instead of sent with every request. */
  tool_search?: { threshold?: number };
  /** Language servers: the `lsp` tool and the errors reported after edits. */
  lsp?: LspSettings;
}

export type ThemeName = 'dark' | 'light' | 'high-contrast' | 'monochrome';

export interface GitSettings {
  /** A trailer added to every commit JamCLI makes. Off by default. */
  attribution?: string;
  /** Let bypass mode commit without asking. Off by default. */
  allow_commit_in_bypass?: boolean;
}

export interface UiSettings {
  /** Defaults to dark. `NO_COLOR` forces monochrome. */
  theme?: ThemeName;
  /** Plain labeled lines: no boxes, no marks, no animation. */
  screen_reader?: boolean;
  /** No spinner or shimmer. */
  reduced_motion?: boolean;
  /** How the working indicator's words shimmer. Defaults to subtle. */
  status_text_style?: StatusTextStyleId;
  /** The working indicator's spinner. Defaults to classic. */
  status_spinner_style?: StatusSpinnerStyleId;
  /** Styles of the person's own, by name, each read from a JSON file. */
  custom_status_styles?: Record<string, StatusIndicatorStyleRef>;
}

export interface ContextSettings {
  /** Summarize older turns on its own when a request nears the model's window. Defaults to true. */
  auto_compact?: boolean;
}

export type StatusTextStyleId = 'rainbow' | 'subtle' | 'minimal' | 'aurora' | 'mono' | `custom:${string}`;
export type StatusSpinnerStyleId =
  | 'classic'
  | 'orbit'
  | 'pulse'
  | 'big_classic'
  | 'big_orbit'
  | 'big_pulse'
  | `custom:${string}`;
export type StatusIndicatorStyleId = StatusTextStyleId | StatusSpinnerStyleId;

export interface StatusIndicatorCustomDefinition {
  label?: string;
  shimmerColors?: string[];
  spinnerFrames?: string[];
  shimmer?: boolean;
  spinnerColors?: string[];
  spinnerIntervalMs?: number;
}

export interface StatusIndicatorStyleRef {
  path: string;
  label?: string;
}

export interface UiConfig {
  status_indicator_style: StatusIndicatorStyleId;
  status_text_style?: StatusTextStyleId;
  status_spinner_style?: StatusSpinnerStyleId;
  custom_status_styles?: Record<string, StatusIndicatorStyleRef>;
}

export interface ToolPermission {
  allowed: boolean;
  require_approval?: boolean;
  description?: string;
}

export type ToolPermissionValue = boolean | ToolPermission;

export interface McpConfig {
  context_window_limit: number;
  ignore_patterns: string[];
  tools: Record<string, ToolPermissionValue>;
  servers?: McpServerConfig[];
}

export interface Profile {
  name: string;
  system_prompt_override?: string;
  preferred_model?: string;
  preferred_provider?: 'ollama' | 'openai' | 'anthropic' | 'openrouter';
  temperature?: number;
}

export interface GeneralConfig {
  show_tool_calling_models_only?: boolean;
}
