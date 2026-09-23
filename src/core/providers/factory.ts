import type { ApiRegistry, EndpointConfig } from '../../types/config.js';
import type { ChatProvider } from './types.js';
import { OpenAICompatProvider, type ProviderDialect } from './openai-compat.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';

export const SUPPORTED_PROVIDERS = ['ollama', 'openrouter', 'openai', 'anthropic'] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/** Every provider JamCLI can actually serve. Nothing outside this list may be offered. */
export const isSupportedProvider = (name: string): name is SupportedProvider =>
  (SUPPORTED_PROVIDERS as readonly string[]).includes(name);

interface KeyConfig {
  api_key?: string;
  key_env_var?: string;
}

const FALLBACK_ENV: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const readEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};

/**
 * Resolves a credential, preferring the declared environment variable over a
 * value stored in configuration, and falling back to the provider's well-known
 * environment variable when neither is set.
 */
export const resolveApiKey = (config: KeyConfig | undefined, fallbackEnv?: string): string | undefined => {
  if (config?.key_env_var) {
    const fromDeclaredEnv = readEnv(config.key_env_var);
    if (fromDeclaredEnv) return fromDeclaredEnv;
  }
  if (config?.api_key && config.api_key.trim()) {
    return config.api_key.trim();
  }
  return fallbackEnv ? readEnv(fallbackEnv) : undefined;
};

const unconfigured = (name: string): Error => {
  if (name === 'openrouter') {
    return new Error(
      'Provider "openrouter" is not configured. Set api_registry.openrouter.api_key, api_registry.openrouter.key_env_var, or the OPENROUTER_API_KEY environment variable.'
    );
  }
  if (name === 'openai') {
    return new Error(
      'Provider "openai" is not configured. Set api_registry.openai.base_url, api_registry.openai.api_key, api_registry.openai.key_env_var, or the OPENAI_API_KEY environment variable.'
    );
  }
  if (name === 'anthropic') {
    return new Error(
      'Provider "anthropic" is not configured. Set api_registry.anthropic.base_url, api_registry.anthropic.api_key, api_registry.anthropic.key_env_var, or the ANTHROPIC_API_KEY environment variable.'
    );
  }
  return new Error(
    `Provider "${name}" is not configured. Add an entry to api_registry.endpoints with id "${name}" and a base_url.`
  );
};

const buildOllama = (config: ApiRegistry['ollama']): ChatProvider => {
  const endpoint = (config?.base_url || config?.endpoint || 'http://localhost:11434').replace(/\/+$/, '');
  if (/\/v1$/.test(endpoint)) {
    return new OpenAICompatProvider({ baseUrl: endpoint, dialect: 'openai' });
  }
  return new OllamaProvider({ endpoint });
};

const buildOpenRouter = (config: ApiRegistry['openrouter']): ChatProvider => {
  const apiKey = resolveApiKey(config, FALLBACK_ENV.openrouter);
  if (!apiKey && !config?.base_url) throw unconfigured('openrouter');
  return new OpenAICompatProvider({
    apiKey,
    baseUrl: config?.base_url?.trim() || 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': config?.referer || 'https://github.com/jamcli',
      'X-Title': config?.title || 'jamcli',
    },
    dialect: 'openai',
    reasoningParam: 'include_reasoning',
  });
};

const buildOpenAI = (config: ApiRegistry['openai']): ChatProvider => {
  const apiKey = resolveApiKey(config, FALLBACK_ENV.openai);
  if (!apiKey && !config?.base_url) throw unconfigured('openai');
  return new OpenAICompatProvider({
    apiKey,
    baseUrl: config?.base_url?.trim() || 'https://api.openai.com/v1',
    dialect: 'openai',
  });
};

const buildAnthropic = (config: ApiRegistry['anthropic']): ChatProvider => {
  const apiKey = resolveApiKey(config, FALLBACK_ENV.anthropic);
  if (!apiKey && !config?.base_url) throw unconfigured('anthropic');
  return new AnthropicProvider({
    apiKey,
    baseUrl: config?.base_url?.trim() || 'https://api.anthropic.com',
  });
};

export const endpointDialect = (endpoint: EndpointConfig): ProviderDialect =>
  endpoint.dialect === 'anthropic' ? 'anthropic' : 'openai';

const buildEndpoint = (endpoint: EndpointConfig): ChatProvider => {
  if (!endpoint.base_url) throw unconfigured(endpoint.id);
  const apiKey = resolveApiKey(endpoint, `${endpoint.id.toUpperCase()}_API_KEY`);
  if (endpointDialect(endpoint) === 'anthropic') {
    return new AnthropicProvider({
      apiKey,
      baseUrl: endpoint.base_url.trim(),
      headers: endpoint.headers,
    });
  }
  return new OpenAICompatProvider({
    apiKey,
    baseUrl: endpoint.base_url.trim(),
    headers: endpoint.headers,
    dialect: 'openai',
  });
};

/**
 * Resolves a provider by name from the registry and builds the client that can
 * serve it. Built-in providers are ollama, openrouter, openai, and anthropic;
 * any other name is resolved as a custom entry from api_registry.endpoints.
 */
export function createChatProvider(name: string, registry: ApiRegistry = {}): ChatProvider {
  switch (name) {
    case 'ollama':
      return buildOllama(registry.ollama);
    case 'openrouter':
      return buildOpenRouter(registry.openrouter);
    case 'openai':
      return buildOpenAI(registry.openai);
    case 'anthropic':
      return buildAnthropic(registry.anthropic);
    default: {
      const endpoint = registry.endpoints?.find((entry) => entry.id === name);
      if (endpoint) return buildEndpoint(endpoint);
      throw unconfigured(name);
    }
  }
}

/**
 * The provider ids that are configured enough to attempt model discovery for.
 * A reachable failure for one of these is reported without stopping the others.
 */
export function listConfiguredProviders(registry: ApiRegistry = {}): string[] {
  const ids: string[] = [];
  if (registry.ollama) ids.push('ollama');
  if (registry.openrouter && (resolveApiKey(registry.openrouter, FALLBACK_ENV.openrouter) || registry.openrouter.base_url)) {
    ids.push('openrouter');
  }
  if (registry.openai && (resolveApiKey(registry.openai, FALLBACK_ENV.openai) || registry.openai.base_url)) {
    ids.push('openai');
  }
  if (registry.anthropic && (resolveApiKey(registry.anthropic, FALLBACK_ENV.anthropic) || registry.anthropic.base_url)) {
    ids.push('anthropic');
  }
  for (const endpoint of registry.endpoints || []) {
    if (endpoint.base_url) ids.push(endpoint.id);
  }
  return ids;
}
