import type { McpServerConfig } from './mcp.js';

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
}

/** Sized for multi-step work: reading, editing, and testing within one turn. */
export const DEFAULT_AGENT_LOOP_CONFIG: AgentLoopConfig = {
  max_steps: 50,
  max_tool_calls_per_turn: 0,
  tool_result_max_chars: 30_000,
  command_timeout_ms: 120_000,
};

export interface Config {
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
