import fs from 'fs';
import path from 'path';
import { userCacheDir } from '../../utils/paths.js';
import { EFFORT_LEVELS } from '../routing/capabilities.js';
import type { ModelFacts } from './types.js';

/** models.dev: the open directory of providers' models, limits, and prices that other tools read too. */
export const DIRECTORY_URL = 'https://models.dev/api.json';
/** Prices and limits change often, so the directory is read again after an hour. */
export const DIRECTORY_TTL_MS = 60 * 60 * 1000;

interface DirectoryProvider {
  /** The provider's API base URL, which matches a custom endpoint to it. */
  api?: string;
  models: Record<string, ModelFacts>;
}

/** Bumped when what is kept from an entry changes, so an older copy is read again. */
const FORMAT = 2;

interface DirectoryFile {
  version: typeof FORMAT;
  fetchedAt: number;
  providers: Record<string, DirectoryProvider>;
}

export interface ModelDirectoryOptions {
  /** Defaults to `models` under the cache directory. */
  dir?: string;
  /** Defaults to JAMCLI_MODELS_DIRECTORY, then models.dev. `off` turns the directory off. */
  url?: string;
  now?: () => number;
  ttlMs?: number;
  fetch?: typeof fetch;
}

const number = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined);
const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** What one models.dev entry says, in the catalog's terms. Only what it states is kept. */
export function directoryFacts(entry: any): ModelFacts {
  const facts: ModelFacts = {};
  const context = number(entry?.limit?.context);
  const output = number(entry?.limit?.output);
  if (context) facts.contextWindow = context;
  if (output) facts.maxOutput = output;
  if (typeof entry?.tool_call === 'boolean') facts.tools = entry.tool_call;
  if (typeof entry?.reasoning === 'boolean') facts.reasoning = entry.reasoning;
  if (Array.isArray(entry?.modalities?.input)) facts.images = entry.modalities.input.includes('image');
  const options: any[] = Array.isArray(entry?.reasoning_options) ? entry.reasoning_options : [];
  // A thinking model that lists how it thinks but no way to switch it off always thinks.
  if (entry?.reasoning === true && options.length) facts.alwaysThinks = !options.some((option) => option?.type === 'toggle' || option?.type === 'budget_tokens');
  const effort = options.find((option) => option?.type === 'effort');
  if (effort) {
    facts.effort = true;
    const levels = Array.isArray(effort.values) ? EFFORT_LEVELS.filter((level) => effort.values.includes(level)) : [];
    if (levels.length) facts.efforts = levels;
  } else if (options.length) {
    facts.effort = false;
  }
  const input = number(entry?.cost?.input);
  const out = number(entry?.cost?.output);
  if (input !== undefined && out !== undefined) {
    facts.price = { input, output: out };
    const read = number(entry.cost.cache_read);
    const write = number(entry.cost.cache_write);
    if (read !== undefined) facts.price.cacheRead = read;
    if (write !== undefined) facts.price.cacheWrite = write;
  }
  return facts;
}

/**
 * The models.dev directory, kept as a trimmed copy for an hour. It is read without the
 * network, and refreshed when stale; a refresh that fails keeps the copy there is, so a
 * session offline goes on with what it has, then the bundled table.
 */
export class ModelDirectory {
  readonly file: string;
  readonly url: string | undefined;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly fetcher: typeof fetch;
  private loaded?: DirectoryFile;
  /** One refresh at a time, and one failed attempt per session, so offline turns do not each wait. */
  private refreshing?: Promise<void>;
  private failed = false;

  constructor(options: ModelDirectoryOptions = {}) {
    this.file = path.join(options.dir ?? path.join(userCacheDir(), 'models'), 'directory.json');
    const url = options.url ?? process.env.JAMCLI_MODELS_DIRECTORY ?? DIRECTORY_URL;
    this.url = url && url !== 'off' ? url : undefined;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DIRECTORY_TTL_MS;
    this.fetcher = options.fetch ?? fetch;
  }

  /** What the directory says about a model: by the provider's id, else by its endpoint's URL. */
  facts(provider: string, endpoint: string | undefined, model: string): ModelFacts | undefined {
    if (!this.url) return undefined;
    const providers = this.read()?.providers;
    if (!providers) return undefined;
    const byId = providers[provider];
    const byUrl = endpoint ? Object.values(providers).find((entry) => entry.api && trimSlash(entry.api) === trimSlash(endpoint)) : undefined;
    return byId?.models[model] ?? byUrl?.models[model];
  }

  /** The copy is missing or older than an hour, and has not already failed to refresh this session. */
  stale(): boolean {
    if (!this.url || this.failed) return false;
    const fetchedAt = this.read()?.fetchedAt;
    if (fetchedAt === undefined) return true;
    const age = this.now() - fetchedAt;
    return age < 0 || age >= this.ttlMs;
  }

  refresh(signal?: AbortSignal): Promise<void> {
    if (!this.url) return Promise.resolve();
    this.refreshing ??= this.download(signal).finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async download(signal?: AbortSignal): Promise<void> {
    try {
      const response = await this.fetcher(this.url!, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw: any = await response.json();
      const providers: Record<string, DirectoryProvider> = {};
      for (const [id, entry] of Object.entries<any>(raw ?? {})) {
        if (!entry?.models || typeof entry.models !== 'object') continue;
        const models: Record<string, ModelFacts> = {};
        for (const [modelId, model] of Object.entries<any>(entry.models)) models[modelId] = directoryFacts(model);
        providers[id] = { ...(typeof entry.api === 'string' ? { api: entry.api } : {}), models };
      }
      const data: DirectoryFile = { version: FORMAT, fetchedAt: this.now(), providers };
      this.loaded = data;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(data));
      fs.renameSync(temporary, this.file);
    } catch {
      // Unreachable or unreadable: keep the copy there is, and do not ask again this session.
      this.failed = true;
    }
  }

  private read(): DirectoryFile | undefined {
    if (this.loaded) return this.loaded;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data?.version === FORMAT && typeof data.fetchedAt === 'number' && data.providers && typeof data.providers === 'object') this.loaded = data;
    } catch {
      // Missing or unreadable: nothing is known until a refresh.
    }
    return this.loaded;
  }
}
