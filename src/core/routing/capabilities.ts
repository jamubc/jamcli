import type { ApiRegistry } from '../../types/config.js';

export type ReasoningLevel = 'off' | 'on' | 'auto';

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
