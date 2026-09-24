/** Prices in US dollars per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Reading a cached prompt prefix. */
  cacheRead?: number;
  /** Writing a prompt prefix to the cache: Anthropic's five-minute cache. */
  cacheWrite?: number;
}

/**
 * How a model thinks. `adaptive` decides for itself how much, steered by effort; `budget`
 * takes a token budget, which models from the 4.6 generation on no longer accept.
 */
export type ThinkingStyle = 'adaptive' | 'budget';

/** What one source knows about a model. Every field is optional: each source knows a different part. */
export interface ModelFacts {
  /** Tokens of input the model reads, including the conversation and the tool definitions. */
  contextWindow?: number;
  /** Most tokens the model writes in one response, thinking included. */
  maxOutput?: number;
  tools?: boolean;
  reasoning?: boolean;
  images?: boolean;
  thinking?: ThinkingStyle;
  /** Thinking cannot be turned off. */
  alwaysThinks?: boolean;
  /** The model takes an effort setting. */
  effort?: boolean;
  /** Absent when no source knows it: the model is unpriced, never guessed. */
  price?: ModelPrice;
}

/**
 * Where a fact came from: the `models` configuration block, the provider's own metadata,
 * the table bundled with JamCLI, the rule that local models cost nothing, or a
 * conservative default standing in for a fact no source knows.
 */
export type FactSource = 'config' | 'provider' | 'bundled' | 'local' | 'default';

export interface ModelInfo extends ModelFacts {
  provider: string;
  model: string;
  /** Always set: when no source knows it, a conservative default stands in, and `sources` says so. */
  contextWindow: number;
  sources: Partial<Record<keyof ModelFacts, FactSource>>;
}

export const FACT_NAMES = [
  'contextWindow',
  'maxOutput',
  'tools',
  'reasoning',
  'images',
  'thinking',
  'alwaysThinks',
  'effort',
  'price',
] as const satisfies readonly (keyof ModelFacts)[];
