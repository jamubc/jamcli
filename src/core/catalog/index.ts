import type { ApiRegistry } from '../../types/config.js';
import type { ProviderFamily } from '../providers/types.js';
import { DEFAULT_OLLAMA_CONTEXT_CAP } from '../providers/ollama.js';
import { bundledFacts } from './bundled.js';
import { MetadataCache } from './cache.js';
import { parseModelsBlock } from './entries.js';
import { FACT_NAMES, type FactSource, type ModelFacts, type ModelInfo } from './types.js';

export * from './types.js';
export { BUNDLED_VERIFIED, bundledFacts, bundledModels, bundledProblems } from './bundled.js';
export { METADATA_TTL_MS, MetadataCache } from './cache.js';
export { parseEntry, parseModelsBlock, splitModelKey } from './entries.js';

/**
 * The context window assumed when no source knows it. It is small on purpose: a window
 * guessed too small compacts early, and one guessed too large fails the request.
 */
export const DEFAULT_CONTEXT_WINDOW = 8_192;

/**
 * Output tokens asked for per reply when configuration does not say. The request reserves
 * this much of the context window, so asking for a model's whole limit on every turn would
 * leave less room for the conversation than most replies need.
 */
export const DEFAULT_OUTPUT_REQUEST = 32_000;

const METADATA_TIMEOUT_MS = 3_000;

/** What the catalog needs from a provider: its wire family, and a way to ask about one model. */
export interface MetadataSource {
  readonly family?: ProviderFamily;
  describeModel?(model: string, signal?: AbortSignal): Promise<ModelFacts | undefined>;
}

export interface CatalogOptions {
  /** The `models` configuration block, keyed `provider:model`. */
  models?: unknown;
  /** Where that block was read from, for the problems found in it. */
  modelsSource?: string;
  registry?: ApiRegistry;
  /** Where provider metadata is kept between sessions. `false` keeps nothing. */
  cache?: MetadataCache | false;
  /** How long to wait for a provider's metadata before going on without it. */
  timeoutMs?: number;
}

/** The endpoint a provider id is configured with, so a changed URL is asked again. */
const endpointOf = (provider: string, registry: ApiRegistry | undefined): string | undefined => {
  if (provider === 'ollama') return registry?.ollama?.base_url || registry?.ollama?.endpoint;
  if (provider === 'openai' || provider === 'anthropic' || provider === 'openrouter') return registry?.[provider]?.base_url;
  return registry?.endpoints?.find((entry) => entry.id === provider)?.base_url;
};

/**
 * What JamCLI knows about a model: its context window, output limit, capabilities, and
 * prices. Each fact comes from the first source that knows it: the `models` configuration
 * block, then the provider's own metadata, then the bundled table. A context window no
 * source knows is a conservative default, a price no source knows stays unknown, and
 * models served by Ollama cost nothing.
 */
export class ModelCatalog {
  /** What was wrong in the `models` block, each naming the setting and what happens instead. */
  readonly problems: string[];
  private readonly configured: Map<string, ModelFacts>;
  private readonly registry?: ApiRegistry;
  private readonly cache?: MetadataCache;
  private readonly timeoutMs: number;

  constructor(options: CatalogOptions = {}) {
    const parsed = parseModelsBlock(options.models, options.modelsSource ?? 'models');
    this.problems = parsed.problems;
    this.configured = parsed.entries;
    this.registry = options.registry;
    this.cache = options.cache === false ? undefined : (options.cache ?? new MetadataCache());
    this.timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS;
  }

  /** Everything known without asking the provider: configuration, the cache, the bundled table, and defaults. */
  lookup(provider: string, model: string, family?: ProviderFamily): ModelInfo {
    return this.combine(provider, model, family, this.cache?.get(this.key(provider, model)));
  }

  /**
   * The same, after asking the provider when nothing it said is cached. A provider that
   * fails or does not answer in time is left out, and asked again next time.
   */
  async resolve(provider: string, model: string, source?: MetadataSource): Promise<ModelInfo> {
    const key = this.key(provider, model);
    let reported = this.cache?.get(key);
    if (!reported && source?.describeModel) {
      reported = await this.ask(source, model);
      if (reported) this.cache?.set(key, reported);
    }
    return this.combine(provider, model, source?.family, reported);
  }

  private key(provider: string, model: string): string {
    return MetadataCache.key(provider, endpointOf(provider, this.registry), model);
  }

  private async ask(source: MetadataSource, model: string): Promise<ModelFacts | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await source.describeModel!(model, controller.signal);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private combine(provider: string, model: string, family: ProviderFamily | undefined, reported: ModelFacts | undefined): ModelInfo {
    const configured = this.configured.get(`${provider}:${model}`) ?? {};
    const layers: [FactSource, ModelFacts][] = [
      ['config', configured],
      ['provider', reported ?? {}],
      ['bundled', bundledFacts(provider, model, family) ?? {}],
    ];
    const info: ModelInfo = { provider, model, contextWindow: DEFAULT_CONTEXT_WINDOW, sources: {} };
    for (const name of FACT_NAMES) {
      const layer = layers.find(([, facts]) => facts[name] !== undefined);
      if (!layer) continue;
      (info as unknown as Record<string, unknown>)[name] = layer[1][name];
      info.sources[name] = layer[0];
    }

    if (provider === 'ollama') {
      // Ollama allocates the whole window it is asked for, so on its own API the window is
      // the one JamCLI asks for: the configured size, or the model's own limit, capped.
      if (family === 'ollama' && info.sources.contextWindow !== 'config') {
        const numCtx = this.registry?.ollama?.num_ctx;
        if (numCtx && numCtx > 0) {
          info.contextWindow = numCtx;
          info.sources.contextWindow = 'config';
        } else if (info.sources.contextWindow === 'provider') {
          info.contextWindow = Math.min(info.contextWindow, DEFAULT_OLLAMA_CONTEXT_CAP);
        }
      }
      if (!info.price) {
        info.price = { input: 0, output: 0 };
        info.sources.price = 'local';
      }
    }
    info.sources.contextWindow ??= 'default';
    return info;
  }
}

/**
 * Output tokens to ask for per reply: the configured amount, or the default, and never
 * more than the model's own limit. Undefined when neither the model's limit nor a
 * configured amount is known, so the server's own default applies.
 */
export function requestedOutputTokens(info: ModelInfo, configured?: number): number | undefined {
  const wanted = configured && configured > 0 ? Math.floor(configured) : undefined;
  if (info.maxOutput) return Math.min(info.maxOutput, wanted ?? DEFAULT_OUTPUT_REQUEST);
  return wanted;
}
