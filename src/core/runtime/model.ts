import type { ApiRegistry, Config, Profile, SearchSettings } from '../../types/config.js';
import { SUPPORTED_PROVIDERS, createChatProvider, listConfiguredProviders, resolveApiKey } from '../providers/factory.js';
import { isListableProvider, type ChatProvider } from '../providers/types.js';
import { completeWithinCap } from '../providers/complete.js';
import { answerOutputTokens, type ModelCatalog, type ModelInfo } from '../catalog/index.js';
import { requestCost } from '../catalog/cost.js';
import type { TokenUsage } from '../types.js';
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

export interface SessionModelOptions {
  catalog: ModelCatalog;
  registry: ApiRegistry | undefined;
  profile: Profile;
  /** Sent with requests by providers that route or cache per conversation. */
  sessionId: string;
  /** `provider:model`, or a model on the profile's provider; the profile's model when absent. */
  ref: string | undefined;
  /** Serve this provider instead of building one from configuration. */
  provider?: ChatProvider;
  /** Wrap a provider before the session uses it, so its requests are timed and logged. */
  observe: (provider: ChatProvider, name: string) => ChatProvider;
}

/**
 * The model a session's turns run on: the choice, the provider serving it or why none can,
 * and what the catalog knows of it, which the provider's own answer refines once it comes.
 * A switch replaces all three at once.
 */
export class SessionModel {
  private current: ModelChoice;
  private served: ChatProvider | undefined;
  private problem: string | undefined;
  private known: ModelInfo;

  constructor(private readonly options: SessionModelOptions) {
    this.current = resolveModel(options.ref, options.profile, options.registry);
    let provider = options.provider;
    if (!provider) {
      try {
        provider = createChatProvider(this.current.provider, options.registry, { sessionId: options.sessionId });
      } catch (error: any) {
        this.problem = error?.message ?? String(error);
      }
    }
    this.served = provider ? options.observe(provider, this.current.provider) : undefined;
    this.known = options.catalog.lookup(this.current.provider, this.current.model, this.served?.family);
  }

  get choice(): ModelChoice {
    return { ...this.current };
  }

  /** The choice as `provider:model`, as the log and the prompt name it. */
  get ref(): string {
    return `${this.current.provider}:${this.current.model}`;
  }

  get provider(): ChatProvider | undefined {
    return this.served;
  }

  /** Why no provider serves the session, when none does. */
  get providerError(): string | undefined {
    return this.problem;
  }

  get info(): ModelInfo {
    return this.known;
  }

  /** Whether the window is known rather than guessed; Ollama's is the one JamCLI asks for, so it always is. */
  get windowKnown(): boolean {
    return this.known.sources.contextWindow !== 'default' || this.known.provider === 'ollama';
  }

  /** Switch to `ref`, returning the ref switched from. Throws, changing nothing, when its provider is not configured. */
  switch(ref: string): string {
    const next = resolveModel(ref, this.options.profile, this.options.registry);
    const provider = this.options.observe(createChatProvider(next.provider, this.options.registry, { sessionId: this.options.sessionId }), next.provider);
    const before = this.ref;
    this.current = next;
    this.served = provider;
    this.problem = undefined;
    this.known = this.options.catalog.lookup(next.provider, next.model, provider.family);
    return before;
  }

  /**
   * Ask the provider about the model, and keep what it says. Resolves to nothing when a
   * switch overtook the question; throws when the provider could not be asked.
   */
  async resolve(): Promise<ModelInfo | undefined> {
    const asked = this.current;
    const info = await this.options.catalog.resolve(asked.provider, asked.model, this.served);
    if (asked !== this.current) return undefined;
    this.known = info;
    return info;
  }

  /** One request outside the conversation, with its usage priced as the session's others are. */
  async complete(prompt: string, request: { maxOutputTokens?: number; signal?: AbortSignal } = {}): Promise<{ content: string; usage?: { usage: TokenUsage; model: string; cost?: number } }> {
    if (!this.served) throw new Error(this.problem ?? 'No model provider is configured for this session.');
    const cap = request.maxOutputTokens ?? 800;
    const result = await completeWithinCap(this.served, [{ role: 'user', content: prompt, timestamp: Date.now() }], {
      model: this.current.model,
      maxOutputTokens: answerOutputTokens(this.known, cap) ?? cap,
      contextLength: this.known.contextWindow,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!result.usage) return { content: result.content ?? '' };
    const cost = requestCost(result.usage, this.known.price);
    return { content: result.content ?? '', usage: { usage: result.usage, model: this.ref, ...(cost !== undefined ? { cost } : {}) } };
  }
}

/**
 * Every model the configured providers list, each with what the catalog knows of it without
 * asking further, and why any provider could not be asked. Each provider has `timeoutMs` to
 * answer, and one that does not is left out.
 */
export async function listModels(catalog: ModelCatalog, registry: ApiRegistry | undefined, redact: (text: string) => string, timeoutMs: number): Promise<{ models: ModelInfo[]; problems: string[] }> {
  const problems: string[] = [];
  await catalog.refreshDirectory();
  const lists = await Promise.all(
    listConfiguredProviders(registry).map(async (id): Promise<ModelInfo[]> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const listed = createChatProvider(id, registry);
        if (!isListableProvider(listed)) return [];
        const late = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`did not answer within ${Math.round(timeoutMs / 100) / 10} s`)), timeoutMs);
        });
        const offered = await Promise.race([listed.listModels(), late]);
        return offered.map((entry) => {
          const info = catalog.lookup(id, entry.id, listed.family, entry.contextWindow ? { contextWindow: entry.contextWindow } : undefined);
          return info.tools === undefined && entry.supports_tool_calling !== undefined ? { ...info, tools: entry.supports_tool_calling } : info;
        });
      } catch (error: any) {
        problems.push(`${id}: ${redact(error?.message ?? String(error))}`);
        return [];
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return { models: lists.flat(), problems };
}
