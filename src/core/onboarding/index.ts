import fs from 'fs';
import os from 'os';
import type { ApiRegistry } from '../../types/config.js';
import { userConfigFile, type LoadedConfig } from '../config/load.js';
import { createChatProvider, keySource, ollamaEndpoint } from '../providers/factory.js';
import { OllamaProvider } from '../providers/ollama.js';
import { ProviderError } from '../providers/http.js';
import { isListableProvider } from '../providers/types.js';
import { resolveModel } from '../runtime/model.js';

/** A coding model Ollama can pull that calls tools, and the memory it needs with a coding session's context. */
export interface Suggestion {
  name: string;
  downloadGb: number;
  memoryGb: number;
}

/**
 * Coding models in Ollama's library that call tools, largest first. The library has no
 * API to ask, so this list is checked against it at each release. Which one is suggested
 * is decided on the machine, from its memory.
 */
export const PULL_CANDIDATES: readonly Suggestion[] = [
  // Names and sizes checked against the Ollama library on 2026-09-25 (manifest layer totals).
  { name: 'qwen3-coder:30b', downloadGb: 18.5, memoryGb: 24 },
  { name: 'devstral:24b', downloadGb: 14.3, memoryGb: 18 },
  { name: 'qwen2.5-coder:14b', downloadGb: 8.9, memoryGb: 12 },
  { name: 'qwen2.5-coder:7b', downloadGb: 4.6, memoryGb: 7 },
  { name: 'qwen2.5-coder:3b', downloadGb: 1.9, memoryGb: 4 },
];

const GB = 1024 ** 3;

/** The largest candidate that leaves a third of the machine's memory to everything else. */
export function suggestModel(memoryBytes: number): Suggestion | undefined {
  const usable = memoryBytes / GB / 1.5;
  return PULL_CANDIDATES.find((candidate) => candidate.memoryGb <= usable);
}

/** A first run: there is no user configuration, and nothing anywhere chooses a model. */
export function isFirstRun(settings: LoadedConfig): boolean {
  if (fs.existsSync(userConfigFile())) return false;
  return !resolveModel(settings.config.model, settings.profile, settings.config.api_registry).model;
}

export interface LocalModel {
  name: string;
  /** Whether it calls tools, when the server says. */
  tools?: boolean;
  contextWindow?: number;
}

export interface Survey {
  ollama: {
    endpoint: string;
    reachable: boolean;
    /** Why it could not be asked. */
    problem?: string;
    /** Whether models can be pulled through it: not when the endpoint is OpenAI-compatible. */
    pulls: boolean;
    models: LocalModel[];
  };
  /** The hosted providers whose key is already set, and where it is. */
  keys: { provider: string; detail: string }[];
  /** What to pull for this machine, when Ollama can pull. */
  suggestion?: Suggestion;
  memoryBytes: number;
}

const HOSTED = ['anthropic', 'openai', 'openrouter'] as const;

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * What a first run can offer: Ollama's models and whether it answers, the keys already
 * set for hosted providers, and a model to pull that fits this machine. It changes
 * nothing.
 */
export async function surveySetup(options: { registry: ApiRegistry; memoryBytes?: number; timeoutMs?: number }): Promise<Survey> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const memoryBytes = options.memoryBytes ?? os.totalmem();
  const endpoint = ollamaEndpoint(options.registry.ollama);
  const provider = createChatProvider('ollama', options.registry);
  const pulls = provider instanceof OllamaProvider;
  const ollama: Survey['ollama'] = { endpoint, reachable: false, pulls, models: [] };
  try {
    if (!isListableProvider(provider)) throw new Error('this Ollama endpoint cannot list its models');
    const listed = await withTimeout(provider.listModels(), timeoutMs);
    ollama.reachable = true;
    ollama.models = await Promise.all(
      listed.map(async (model): Promise<LocalModel> => {
        try {
          const facts = await provider.describeModel?.(model.id, AbortSignal.timeout(timeoutMs));
          return { name: model.id, ...(facts?.tools !== undefined ? { tools: facts.tools } : {}), ...(facts?.contextWindow ? { contextWindow: facts.contextWindow } : {}) };
        } catch {
          return { name: model.id };
        }
      })
    );
  } catch (error: any) {
    // The provider's own message carries its advice; setup gives that itself.
    ollama.problem = error instanceof ProviderError && error.detail ? error.detail : (error?.message ?? String(error));
  }
  const keys = HOSTED.map((name) => ({ provider: name, source: keySource(name, options.registry) }))
    .filter((entry) => entry.source.from !== 'none')
    .map((entry) => ({ provider: entry.provider, detail: entry.source.detail }));
  const suggestion = ollama.reachable && pulls ? suggestModel(memoryBytes) : undefined;
  return { ollama, keys, ...(suggestion ? { suggestion } : {}), memoryBytes };
}
