import type { JsonSchema, RegisteredTool, ToolContext, ToolRunPayload } from '../../../types/tools.js';
import { htmlToText } from './extract.js';
import { refineFetch, refineSearch } from './refine.js';
import { FRESHNESS_PROPERTY, type Freshness, type SearchProviders, type SearchResult } from './providers.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'JamCLI (+https://github.com/jamubc/jamcli)';
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;

type CacheEntry = { output: string; bytes: number; at: number };

/** In-process response cache, keyed by the URL after redirects. Never on disk. */
export class ResponseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private bytes = 0;

  constructor(private readonly options: { ttlMs?: number; maxBytes?: number; now?: () => number } = {}) {}

  get(url: string): string | undefined {
    const entry = this.entries.get(url);
    if (!entry) return undefined;
    if ((this.options.now ?? Date.now)() - entry.at > (this.options.ttlMs ?? CACHE_TTL_MS)) {
      this.entries.delete(url);
      this.bytes -= entry.bytes;
      return undefined;
    }
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry.output;
  }

  set(url: string, output: string): void {
    const maxBytes = this.options.maxBytes ?? CACHE_MAX_BYTES;
    const bytes = Buffer.byteLength(output);
    if (bytes > maxBytes) return;
    this.entries.set(url, { output, bytes, at: (this.options.now ?? Date.now)() });
    this.bytes += bytes;
    while (this.bytes > maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest)!;
      this.entries.delete(oldest);
      this.bytes -= entry.bytes;
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

const responseCache = new ResponseCache();

/** Clears the in-process fetch cache. */
export const clearFetchCache = (): void => responseCache.clear();

const isText = (type: string) => /^text\/|[/+](json|xml|javascript|ecmascript|yaml|x-yaml|markdown)\b/.test(type) || type === '';

const readCapped = async (response: Response): Promise<{ bytes: Uint8Array; truncated: boolean }> => {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > MAX_BYTES) {
      chunks.push(value.subarray(0, MAX_BYTES - size));
      size = MAX_BYTES;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
};

const fetchSchema: JsonSchema = {
  type: 'object',
  properties: {
    url: { type: 'string', description: 'An http or https URL.' },
    prompt: { type: 'string', description: 'What to look for on the page, carried to the refinement stage.' },
  },
  required: ['url'],
  additionalProperties: false,
};

/** The fetch runner, parameterized by its refinement stage so a test can prove the pipe is wired. */
export function webFetchWith(refine: typeof refineFetch) {
  return async function runWebFetch(args: Record<string, any>, ctx: ToolContext): Promise<ToolRunPayload> {
    let url: URL;
    try {
      url = new URL(String(args.url ?? ''));
    } catch {
      return { output: `Refused: ${String(args.url ?? '')} is not a URL.` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { output: `Refused: only http and https URLs are fetched, not ${url.protocol}` };
    url.hash = '';
    const prompt = typeof args.prompt === 'string' ? args.prompt : undefined;

    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
    let response: Response;
    let current = url;
    try {
      for (let hops = 0; ; hops += 1) {
        const cached = responseCache.get(current.href);
        if (cached) return { output: await refine(current.href, cached, prompt, ctx) };
        response = await fetch(current, {
          redirect: 'manual',
          signal,
          headers: { accept: 'text/html, text/plain, text/markdown, application/json, */*;q=0.5', 'user-agent': USER_AGENT },
        });
        const location = response.headers.get('location');
        if (response.status < 300 || response.status >= 400 || !location) break;
        const next = new URL(location, current);
        if (next.host !== url.host) {
          await response.body?.cancel().catch(() => {});
          return { output: `${current.href} redirects to ${next.href}, on another host. Fetch that URL to follow it.` };
        }
        if (hops + 1 >= MAX_REDIRECTS) {
          await response.body?.cancel().catch(() => {});
          return { output: `${url.href} redirected more than ${MAX_REDIRECTS} times; stopped at ${next.href}.` };
        }
        await response.body?.cancel().catch(() => {});
        current = next;
      }
    } catch (error: any) {
      const reason = timeout.aborted
        ? `it took longer than ${TIMEOUT_MS / 1000} seconds`
        : ctx.signal?.aborted
          ? 'it was cancelled'
          : error?.cause?.code ?? error?.message ?? String(error);
      return { output: `Could not fetch ${current.href}: ${reason}.` };
    }

    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const heading = `${current.href} (${response.status}${type ? `, ${type}` : ''})`;
    if (!isText(type)) {
      await response.body?.cancel().catch(() => {});
      return { output: `${heading}\n\nNot fetched: ${type} is not text.` };
    }
    const { bytes, truncated } = await readCapped(response);
    const raw = new TextDecoder().decode(bytes);
    const text = type === 'text/html' || type === 'application/xhtml+xml' ? htmlToText(raw, current.href) : raw;
    const output = `${heading}\n\n${text}${truncated ? `\n\n[Cut at ${MAX_BYTES / 1024 / 1024} MB.]` : ''}`;
    responseCache.set(current.href, output);
    return { output: await refine(current.href, output, prompt, ctx) };
  };
}

export const WEB_FETCH_TOOL: RegisteredTool = {
  name: 'web_fetch',
  description: 'Fetch a URL and return it as readable text. HTML is reduced to its text; other text types come back as they are.',
  inputSchema: fetchSchema,
  policy: 'network',
  runner: webFetchWith(refineFetch),
};

export interface SearchRunner {
  readonly available: string[];
  run(query: string, options?: { count?: number; freshness?: Freshness; signal?: AbortSignal }): Promise<SearchResult[]>;
}

const searchSchema: JsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'The search query.' },
    freshness: FRESHNESS_PROPERTY as unknown as JsonSchema,
  },
  required: ['query'],
  additionalProperties: false,
};

export function webSearchWith(runner: SearchRunner, refine: typeof refineSearch): RegisteredTool {
  return {
    name: 'web_search',
    description: `Search the web with the ${runner.available.join(', ') || 'configured'} provider and return ranked results with page text.`,
    inputSchema: searchSchema,
    policy: 'network',
    runner: async (args, ctx) => {
      const query = String(args.query ?? '').trim();
      if (!query) return { output: 'Refused: a query is required.' };
      const freshness = typeof args.freshness === 'string' ? (args.freshness as Freshness) : undefined;
      let results: SearchResult[];
      try {
        results = await runner.run(query, { freshness, signal: ctx.signal });
      } catch (error: any) {
        return { output: `Search failed: ${error?.message ?? String(error)}` };
      }
      const refined = await refine(query, results, ctx);
      if (!refined.length) return { output: `No results for ${JSON.stringify(query)}.` };
      return { output: refined.map((result) => [`## ${result.title ?? result.url}`, result.url, result.content ?? ''].join('\n')).join('\n\n') };
    },
  };
}

export const webSearchTool = (providers: SearchProviders) => webSearchWith(providers, refineSearch);
