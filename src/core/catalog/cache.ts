import fs from 'fs';
import path from 'path';
import { userCacheDir } from '../../utils/paths.js';
import type { ModelFacts } from './types.js';

export const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  facts: ModelFacts;
}

interface CacheFile {
  version: 1;
  entries: Record<string, CacheEntry>;
}

export interface MetadataCacheOptions {
  /** Defaults to `models` under the cache directory. */
  dir?: string;
  now?: () => number;
  ttlMs?: number;
}

/**
 * What providers said about their models, kept for a day so a session does not ask again.
 * It is only a cache: a missing, unreadable, or expired entry means asking the provider,
 * and a write that fails is skipped. Only answers are kept, never failures, so a provider
 * that was unreachable is asked again next time.
 */
export class MetadataCache {
  readonly file: string;
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: MetadataCacheOptions = {}) {
    this.file = path.join(options.dir ?? path.join(userCacheDir(), 'models'), 'metadata.json');
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? METADATA_TTL_MS;
  }

  /** One key per provider, endpoint, and model, so changing an endpoint's URL asks again. */
  static key(provider: string, endpoint: string | undefined, model: string): string {
    return JSON.stringify([provider, endpoint ?? '', model]);
  }

  get(key: string): ModelFacts | undefined {
    const entry = this.read().entries[key];
    if (!entry || typeof entry.fetchedAt !== 'number') return undefined;
    const age = this.now() - entry.fetchedAt;
    return age >= 0 && age < this.ttlMs ? entry.facts : undefined;
  }

  set(key: string, facts: ModelFacts): void {
    // Read again before writing, so an entry another session wrote meanwhile is kept.
    const data = this.read();
    data.entries[key] = { fetchedAt: this.now(), facts };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(data));
      fs.renameSync(temporary, this.file);
    } catch {
      // A cache that cannot be written is asked again next time.
    }
  }

  private read(): CacheFile {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data?.version === 1 && data.entries && typeof data.entries === 'object') return data;
    } catch {
      // Missing or unreadable: start empty.
    }
    return { version: 1, entries: {} };
  }
}
