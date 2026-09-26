import type { ApiRegistry, Config, Profile, SearchSettings } from '../../types/config.js';
import { SUPPORTED_PROVIDERS, createChatProvider } from '../providers/factory.js';
import type { ChatProvider } from '../providers/types.js';
import type { Agent } from '../ext/agents.js';

export interface ModelChoice {
  provider: string;
  model: string;
}

const knownProvider = (name: string, registry: ApiRegistry | undefined) =>
  (SUPPORTED_PROVIDERS as readonly string[]).includes(name) || Boolean(registry?.endpoints?.some((entry) => entry.id === name));

/**
 * Which provider and model a session uses. `provider:model` names both; anything else is
 * a model on the profile's provider, so a model id with its own colon, such as
 * `qwen2.5-coder:7b`, stays whole. No model is invented when none is configured.
 */
export function resolveModel(ref: string | undefined, profile: Profile | undefined, registry?: ApiRegistry): ModelChoice {
  const fallbackProvider = profile?.preferred_provider || 'ollama';
  const requested = ref?.trim();
  if (requested) {
    const colon = requested.indexOf(':');
    if (colon > 0 && knownProvider(requested.slice(0, colon), registry)) {
      return { provider: requested.slice(0, colon), model: requested.slice(colon + 1) };
    }
    return { provider: fallbackProvider, model: requested };
  }
  return { provider: fallbackProvider, model: profile?.preferred_model?.trim() || '' };
}

/** The trust gate's classifier, when one is configured and enabled. */
/**
 * The model the trust gate runs on: its own, or a configured quick agent's first model.
 * The built-in quick does not count, so the gate stays off until someone chooses a model.
 */
export function trustModelRef(config: Config, agents: Record<string, Agent>): string | undefined {
  if (config.trust?.enabled === false) return undefined;
  const quick = agents.quick?.source.kind === 'builtin' ? undefined : agents.quick;
  return config.trust?.model ?? quick?.chain[0]?.model;
}

export function trustClassifier(config: Config, agents: Record<string, Agent>): { provider?: ChatProvider; model?: string; choice?: ModelChoice; note?: string } {
  const ref = trustModelRef(config, agents);
  if (!ref) return {};
  const choice = resolveModel(ref, { preferred_provider: 'ollama' } as Profile, config.api_registry);
  try {
    return { provider: createChatProvider(choice.provider, config.api_registry), model: choice.model, choice };
  } catch (error: any) {
    return { note: `The trust gate is off: ${error?.message ?? error}` };
  }
}

/**
 * Credentials a session knows about beyond the environment's naming convention: keys and
 * headers stored in configuration, and variables named by `key_env_var`, for redaction.
 */
export function configuredSecrets(
  registry: ApiRegistry | undefined,
  env: Record<string, string | undefined>,
  search?: SearchSettings
): { name: string; value: string }[] {
  type Keyed = { api_key?: string; key_env_var?: string; headers?: Record<string, string> };
  const entries: [string, Keyed | undefined][] = [
    ['openrouter', registry?.openrouter],
    ['openai', registry?.openai],
    ['anthropic', registry?.anthropic],
    ...(registry?.endpoints ?? []).map((entry): [string, Keyed] => [entry.id, entry]),
    ...Object.entries(search?.providers ?? {}).map(([name, entry]): [string, Keyed] => [`search.${name}`, entry]),
  ];
  const secrets: { name: string; value: string }[] = [];
  for (const [name, entry] of entries) {
    if (!entry) continue;
    if (entry.api_key) secrets.push({ name: `config:${name}`, value: entry.api_key });
    const value = entry.key_env_var ? env[entry.key_env_var] : undefined;
    if (entry.key_env_var && value) secrets.push({ name: entry.key_env_var, value });
    for (const [header, headerValue] of Object.entries(entry.headers ?? {})) {
      secrets.push({ name: `config:${name}.headers.${header}`, value: headerValue.replace(/^Bearer\s+/i, '') });
    }
  }
  return secrets;
}

/** The variables configuration names as holding provider keys, which no subprocess gets. */
export function keyVariables(registry: ApiRegistry | undefined, search?: SearchSettings): string[] {
  const entries = [
    registry?.openrouter,
    registry?.openai,
    registry?.anthropic,
    ...(registry?.endpoints ?? []),
    ...Object.values(search?.providers ?? {}),
  ];
  return [...new Set(entries.flatMap((entry) => (entry?.key_env_var ? [entry.key_env_var] : [])))];
}
