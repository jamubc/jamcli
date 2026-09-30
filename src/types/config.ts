import type { ConfigFile } from '../core/config/schema.js';

export type ApiRegistry = Config['api_registry'];

export type EndpointConfig = NonNullable<ApiRegistry['endpoints']>[number];

export type SearchProviderConfig = NonNullable<SearchSettings['providers']>[string];

export type SearchSettings = NonNullable<Config['search']>;

export type CategoryEntry = NonNullable<Config['categories']>[string][number];

export type CategoryChain = CategoryEntry[];

export interface DelegationConfig {
  max_depth: number;
  max_concurrent: number;
  max_turns_per_child: number;
  /** The agent a `task` call that names none runs on. */
  default_agent?: string;
}

export const DEFAULT_DELEGATION_CONFIG: DelegationConfig = {
  max_depth: 2,
  max_concurrent: 5,
  max_turns_per_child: 16,
};

/**
 * What configuration says about one model, overriding the provider's metadata and the
 * bundled table. Prices are US dollars per million tokens.
 */
export type ModelSettings = NonNullable<Config['models']>[string];

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

/** The configuration a session reads: every layer merged over the defaults, in the shape the schema validates. */
export type Config = ConfigFile & Required<Pick<ConfigFile, 'api_registry' | 'active_profile' | 'telemetry'>>;

export type ThemeName = 'dark' | 'light' | 'high-contrast' | 'monochrome';

export type GitSettings = NonNullable<Config['git']>;

export type UiSettings = NonNullable<Config['ui']>;

export type ContextSettings = NonNullable<Config['context']>;

/** `subtle` is the Ink interface's name for glow, and still accepted. */
export type StatusTextStyleId = 'glow' | 'mono' | 'aurora' | 'rainbow' | 'minimal' | 'whimsy' | 'subtle' | `custom:${string}`;

/**
 * The phases a word style may give words of its own: thinking, writing (`streaming`), and
 * running a tool (`tool`). Retrying and compacting keep their own words.
 */
export const STATUS_WORD_PHASES = ['thinking', 'streaming', 'tool'] as const;
export type StatusWordPhase = (typeof STATUS_WORD_PHASES)[number];

/** Words shown in place of a phase's own, one picked each time the phase begins. */
export type StatusWords = Partial<Record<StatusWordPhase, string[]>>;
/** The `big_` ids are the Ink interface's tall spinners, and still accepted as the spinner each stood on. */
export type StatusSpinnerStyleId =
  | 'pulse'
  | 'bloom'
  | 'orbit'
  | 'quad'
  | 'classic'
  | 'big_classic'
  | 'big_orbit'
  | 'big_pulse'
  | `custom:${string}`;
export type StatusIndicatorStyleId = StatusTextStyleId | StatusSpinnerStyleId;

export interface StatusIndicatorCustomDefinition {
  label?: string;
  shimmerColors?: string[];
  words?: StatusWords;
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

export interface Profile {
  name: string;
  system_prompt_override?: string;
  preferred_model?: string;
  preferred_provider?: 'ollama' | 'openai' | 'anthropic' | 'openrouter';
  temperature?: number;
}

