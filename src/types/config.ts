import type { McpServerConfig } from './mcp.js';

export interface ApiRegistry {
  ollama?: { endpoint?: string };
  openai?: { api_key?: string; key_env_var?: string };
  anthropic?: { api_key?: string; key_env_var?: string };
  openrouter?: {
    api_key?: string;
    key_env_var?: string;
    base_url?: string;
    referer?: string;
    title?: string;
  };
}

export interface ModelInfo {
  id: string;
  provider: 'ollama' | 'openai' | 'anthropic' | 'openrouter';
  name: string;
  description?: string;
}

export interface Config {
  api_registry: ApiRegistry;
  active_profile: string;
  telemetry: boolean;
  available_models?: ModelInfo[];
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
