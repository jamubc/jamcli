import type { ApiRegistry } from '../../types/config.js';

export type ReasoningLevel = 'off' | 'on' | 'auto';

/** How hard a model thinks, where it takes a level: the names Anthropic and OpenAI use. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
export const isEffortLevel = (value: unknown): value is EffortLevel => (EFFORT_LEVELS as readonly unknown[]).includes(value);

/** What a person picks for how a session thinks: thinking off, the model's default, on, or a level. */
export const THINKING_CHOICES = ['off', 'auto', 'on', ...EFFORT_LEVELS] as const;
export type ThinkingChoice = (typeof THINKING_CHOICES)[number];
export const isThinkingChoice = (value: unknown): value is ThinkingChoice => (THINKING_CHOICES as readonly unknown[]).includes(value);

/** A choice as the request settings it stands for. `auto` leaves both to the model's default. */
export function thinkingFor(choice: ThinkingChoice): { reasoning?: ReasoningLevel; effort?: EffortLevel } {
  if (choice === 'auto') return {};
  if (choice === 'off' || choice === 'on') return { reasoning: choice };
  return { effort: choice };
}

/** The choice request settings stand for: the level when there is one, else the reasoning switch. */
export const choiceOf = (thinking: { reasoning?: ReasoningLevel; effort?: EffortLevel }): ThinkingChoice => thinking.effort ?? thinking.reasoning ?? 'auto';

/**
 * The level to send for the one asked: itself when the model takes it or lists nothing,
 * else the nearest it takes, the higher on a tie. DeepSeek v4.1 Flash, for one, takes low,
 * high, and max, so medium goes as high.
 */
export function effortFor(asked: EffortLevel, takes: readonly EffortLevel[] | undefined): EffortLevel {
  if (!takes?.length || takes.includes(asked)) return asked;
  const at = EFFORT_LEVELS.indexOf(asked);
  const distance = (level: EffortLevel) => Math.abs(EFFORT_LEVELS.indexOf(level) - at) - (EFFORT_LEVELS.indexOf(level) > at ? 0.5 : 0);
  return [...takes].sort((a, b) => distance(a) - distance(b))[0]!;
}

export const reasoningSupported = (model: string): boolean =>
  /(^|[:/-])(o1|o3|o4|deepseek-r1|qwq|magistral|reasoning)/i.test(model);

export const downgradeReasoning = (
  requested: ReasoningLevel | undefined,
  model: string
): { level?: ReasoningLevel; changed: boolean; note?: string } => {
  if (!requested) return { changed: false };
  if (requested === 'off') return { level: 'off', changed: false };
  if (reasoningSupported(model)) return { level: requested, changed: false };
  return {
    level: undefined,
    changed: true,
    note: `${model} does not accept a reasoning level; the requested "${requested}" was dropped.`,
  };
};

export const providerOf = (modelId: string): string => {
  const idx = modelId.indexOf(':');
  return idx === -1 ? modelId : modelId.slice(0, idx);
};

const envKey = (name: string | undefined, fallback: string): string | undefined => {
  const key = name || fallback;
  return process.env[key];
};

export const providerConfigured = (registry: ApiRegistry | undefined, provider: string): boolean => {
  if (provider === 'ollama') return true;
  if (!registry) return false;
  if (provider === 'openrouter') {
    const cfg = registry.openrouter;
    if (!cfg) return false;
    return Boolean(cfg.api_key || envKey(cfg.key_env_var, 'OPENROUTER_API_KEY'));
  }
  if (provider === 'openai') {
    const cfg = registry.openai;
    if (!cfg) return false;
    return Boolean(cfg.api_key || cfg.base_url || envKey(cfg.key_env_var, 'OPENAI_API_KEY'));
  }
  if (provider === 'anthropic') {
    const cfg = registry.anthropic;
    if (!cfg) return false;
    return Boolean(cfg.api_key || cfg.base_url || envKey(cfg.key_env_var, 'ANTHROPIC_API_KEY'));
  }
  const endpoint = registry.endpoints?.find((item) => item.id === provider);
  if (endpoint) return Boolean(endpoint.base_url || envKey(endpoint.key_env_var, `${provider.toUpperCase()}_API_KEY`));
  return false;
};
