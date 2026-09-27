import type { ApiRegistry, Config, Profile, SearchSettings } from '../../types/config.js';
import { SUPPORTED_PROVIDERS, createChatProvider, resolveApiKey } from '../providers/factory.js';
import type { ChatProvider } from '../providers/types.js';
import { chatClassifier, type Classifier } from '../trust/index.js';
import { jevClassifier } from '../trust/jev.js';

export interface ModelChoice {
  provider: string;
  model: string;
}

/** TypeSafe answers judgments, not chat, so it is a provider only where a classifier is chosen. */
export const JUDGMENT_PROVIDER = 'typesafe';

const knownProvider = (name: string, registry: ApiRegistry | undefined) =>
  (SUPPORTED_PROVIDERS as readonly string[]).includes(name) || name === JUDGMENT_PROVIDER || Boolean(registry?.endpoints?.some((entry) => entry.id === name));

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

/**
 * The model the trust gate runs on: `trust.model`, as `provider:model` on any configured
 * provider, or a bare model name on Ollama. Nothing is chosen for the user: the classifier
 * reads every tool result in auto mode, so which model does that is theirs to decide.
 */
export function trustModelRef(config: Config): string | undefined {
  if (config.trust?.enabled === false) return undefined;
  return config.trust?.model?.trim() || undefined;
}

export interface TrustChoice {
  classifier?: Classifier;
  /** The chat provider behind the classifier, when it is a chat model, so it can be observed and asked about. */
  provider?: ChatProvider;
  choice?: ModelChoice;
  note?: string;
}

/**
 * The classifier `trust.model` names: a chat model on any configured provider, or Jev on
 * TypeSafe. `wrap` observes a chat provider before the classifier is built on it.
 */
export function trustClassifier(config: Config, wrap: (provider: ChatProvider, name: string) => ChatProvider = (provider) => provider): TrustChoice {
  const ref = trustModelRef(config);
  if (!ref) return {};
  const choice = resolveModel(ref, { preferred_provider: 'ollama' } as Profile, config.api_registry);
  if (choice.provider === JUDGMENT_PROVIDER) {
    const entry = config.api_registry?.typesafe;
    const apiKey = resolveApiKey(entry, 'TYPESAFE_API_KEY', JUDGMENT_PROVIDER);
    if (!apiKey) {
      return { note: 'The trust gate is off: TypeSafe is not configured. Store a key with jamcli auth set typesafe, set TYPESAFE_API_KEY, or name the variable in api_registry.typesafe.key_env_var.' };
    }
    return { classifier: jevClassifier({ apiKey, baseUrl: entry?.base_url, model: choice.model }), choice };
  }
  try {
    const provider = wrap(createChatProvider(choice.provider, config.api_registry), choice.provider);
    return { classifier: chatClassifier(provider, choice.model), provider, choice };
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
    ['typesafe', registry?.typesafe],
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
    registry?.typesafe,
    ...(registry?.endpoints ?? []),
    ...Object.values(search?.providers ?? {}),
  ];
  return [...new Set(entries.flatMap((entry) => (entry?.key_env_var ? [entry.key_env_var] : [])))];
}
