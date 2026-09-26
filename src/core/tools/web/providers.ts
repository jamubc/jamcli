import { resolveApiKey } from '../../providers/factory.js';
import type { SearchProviderConfig, SearchSettings } from '../../../types/config.js';

export const LANGSEARCH_ENDPOINT = 'https://api.langsearch.com/v1/web-search';
export const LANGSEARCH_KEY_VAR = 'LANGSEARCH_API_KEY';

export const FRESHNESS_VALUES = ['noLimit', 'oneDay', 'oneWeek', 'oneMonth', 'oneYear'] as const;
export type Freshness = (typeof FRESHNESS_VALUES)[number];

export const FRESHNESS_PROPERTY = {
  type: 'string',
  enum: [...FRESHNESS_VALUES],
  description:
    'How recent the results must be. Use `oneDay` or `oneWeek` for prices, news, scores, ' +
    'releases or anything else that changes; `oneMonth` or `oneYear` for evolving topics; ' +
    '`noLimit` (the default) for definitions, history and reference material.',
} as const;

export interface SearchResult {
  url: string;
  title?: string;
  content?: string;
  time: { published?: number };
}

interface RawPage {
  url?: unknown;
  name?: unknown;
  text?: unknown;
  snippet?: unknown;
  datePublished?: unknown;
}

const clamp = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const parsePublished = (value: unknown): number | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function searchLangSearch(
  query: string,
  options: {
    apiKey: string;
    endpoint?: string;
    count?: number;
    freshness?: Freshness;
    includeDomains?: string[];
    excludeDomains?: string[];
    text?: boolean | { maxCharacters?: number };
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<SearchResult[]> {
  const body: Record<string, unknown> = {
    query,
    count: clamp(options.count ?? 8, 1, 50, 8),
    freshness: options.freshness ?? 'noLimit',
  };
  if (options.includeDomains?.length) body.includeDomains = options.includeDomains;
  if (options.excludeDomains?.length) body.excludeDomains = options.excludeDomains;
  const text = options.text ?? true;
  if (text === true) body.contents = { text: true };
  else if (text !== false) body.contents = { text: { maxCharacters: text.maxCharacters ?? 5000 } };

  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(options.endpoint ?? LANGSEARCH_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error: any) {
    const reason = timeout.aborted
      ? `it took longer than ${timeoutMs / 1000} seconds`
      : error?.cause?.code ?? error?.message ?? String(error);
    throw new Error(`LangSearch request failed: ${reason}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LangSearch request failed: HTTP ${response.status}${detail ? ` ${detail.slice(0, 500)}` : ''}`);
  }
  let json: any;
  try {
    json = await response.json();
  } catch {
    throw new Error('LangSearch returned a body that is not JSON.');
  }
  const items: RawPage[] = json?.data?.webPages?.value ?? [];
  return items
    .filter((item) => typeof item.url === 'string' && item.url.length > 0)
    .map((item) => {
      const url = item.url as string;
      const published = parsePublished(item.datePublished);
      return {
        url,
        title: typeof item.name === 'string' && item.name ? item.name : url,
        content: typeof item.text === 'string' ? item.text : typeof item.snippet === 'string' ? item.snippet : '',
        time: published === undefined ? {} : { published },
      };
    });
}

const TRACKING = /^(utm_|sc_lid$|ref$|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|source$)/i;

export const canonicalizeUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const kept = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING.test(key))
      .sort(([a], [b]) => a.localeCompare(b));
    parsed.search = '';
    for (const [key, value] of kept) parsed.searchParams.append(key, value);
    const path = parsed.pathname
      .replace(/\/print$/i, '')
      .replace(/\/amp$/i, '')
      .replace(/\/index\.html$/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    return `${parsed.hostname.replace(/^www\./i, '').toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
};

const SHINGLE_SIZE = 5;

export const shingles = (text: string, size = SHINGLE_SIZE): Set<string> => {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) set.add(words.slice(i, i + size).join(' '));
  return set;
};

export const containment = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let found = 0;
  for (const item of small) if (large.has(item)) found += 1;
  return found / small.size;
};

const MIN_SHINGLES = 10;
const DEFAULT_MIN_CONTAINMENT = 0.8;

export function dedupeResults(results: SearchResult[], minContainment = DEFAULT_MIN_CONTAINMENT): SearchResult[] {
  const kept: SearchResult[] = [];
  const urls = new Set<string>();
  const bodies: Set<string>[] = [];
  const bodyText: string[] = [];
  for (const result of results) {
    const canonical = canonicalizeUrl(result.url);
    if (urls.has(canonical)) continue;
    const normalized = (result.content ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized && bodyText.includes(normalized)) continue;
    const set = shingles(result.content ?? '');
    if (set.size >= MIN_SHINGLES && bodies.some((seen) => containment(set, seen) >= minContainment)) continue;
    urls.add(canonical);
    bodyText.push(normalized);
    bodies.push(set);
    kept.push(result);
  }
  return kept;
}

export function withDateline(results: SearchResult[]): SearchResult[] {
  return results.map((result) => {
    const published = result.time?.published;
    if (published === undefined || !Number.isFinite(published)) return result;
    const date = new Date(published);
    if (Number.isNaN(date.getTime())) return result;
    const stamp = date.toISOString().slice(0, 10);
    const content = result.content ?? '';
    if (content.startsWith(`Published: ${stamp}`)) return result;
    return { ...result, content: `Published: ${stamp}\n\n${content}` };
  });
}

interface ProviderDefinition {
  name: string;
  endpoint: string;
  config?: SearchProviderConfig;
}

const DEFAULT_PROVIDERS: Record<string, { endpoint: string }> = {
  langsearch: { endpoint: LANGSEARCH_ENDPOINT },
};

export class SearchProviders {
  private readonly definitions: ProviderDefinition[];

  constructor(settings: SearchSettings | undefined) {
    const merged = { ...DEFAULT_PROVIDERS, ...(settings?.providers ?? {}) };
    this.definitions = Object.entries(merged).map(([name, entry]) => ({
      name,
      endpoint: entry.endpoint ?? DEFAULT_PROVIDERS[name]?.endpoint ?? LANGSEARCH_ENDPOINT,
      config: settings?.providers?.[name],
    }));
  }

  /** Names whose key resolves, which is what "available" means here. */
  get available(): string[] {
    return this.definitions.filter((definition) => this.keyFor(definition)).map((definition) => definition.name);
  }

  /** The host rules name, for the single available provider. */
  get host(): string | undefined {
    const definition = this.definitions.find((entry) => this.available.includes(entry.name));
    if (!definition) return undefined;
    try {
      return new URL(definition.endpoint).hostname;
    } catch {
      return undefined;
    }
  }

  private keyFor(definition: ProviderDefinition): string | undefined {
    return resolveApiKey(definition.config, definition.name === 'langsearch' ? LANGSEARCH_KEY_VAR : undefined);
  }

  async run(
    query: string,
    options: { count?: number; freshness?: Freshness; signal?: AbortSignal } = {}
  ): Promise<SearchResult[]> {
    const definition = this.definitions.find((entry) => this.available.includes(entry.name));
    if (!definition) throw new Error('No search provider key resolves.');
    const key = this.keyFor(definition)!;
    const results = await searchLangSearch(query, { ...options, apiKey: key, endpoint: definition.endpoint });
    return withDateline(dedupeResults(results));
  }
}
