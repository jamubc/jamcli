import { test, expect, afterEach } from 'bun:test';
import {
  createChatProvider,
  listConfiguredProviders,
  resolveApiKey,
} from '../factory.js';
import { OpenAICompatProvider } from '../openai-compat.js';
import { AnthropicProvider } from '../anthropic.js';
import { OllamaProvider } from '../ollama.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.JAMCLI_OR_KEY;
  delete process.env.JAMCLI_CUSTOM_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

test('a declared key environment variable is preferred over a stored value', () => {
  process.env.JAMCLI_OR_KEY = 'from-env';
  expect(resolveApiKey({ api_key: 'stored', key_env_var: 'JAMCLI_OR_KEY' }, 'OPENROUTER_API_KEY')).toBe('from-env');
});

test('the stored key is used when the named variable is absent', () => {
  expect(resolveApiKey({ api_key: 'stored', key_env_var: 'JAMCLI_MISSING_X' }, 'OPENROUTER_API_KEY')).toBe('stored');
});

test('the provider fallback variable is used when nothing is stored', () => {
  process.env.OPENROUTER_API_KEY = 'fallback';
  expect(resolveApiKey(undefined, 'OPENROUTER_API_KEY')).toBe('fallback');
});

test('an unconfigured provider names the configuration key that would enable it', () => {
  expect(() => createChatProvider('openrouter', {})).toThrow(/api_registry\.openrouter/);
  expect(() => createChatProvider('mystery', {})).toThrow(/api_registry\.endpoints/);
});

test('a custom endpoint is resolved by id and served in its declared dialect', async () => {
  let captured: any;
  globalThis.fetch = (async (url: any, init: any) => {
    captured = { url, headers: init.headers };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
  }) as typeof fetch;

  process.env.JAMCLI_CUSTOM_KEY = 'custom-secret';
  const registry = {
    endpoints: [
      {
        id: 'team-anthropic',
        base_url: 'https://team-proxy.test',
        dialect: 'anthropic' as const,
        key_env_var: 'JAMCLI_CUSTOM_KEY',
      },
    ],
  };

  const provider = createChatProvider('team-anthropic', registry);
  expect(provider).toBeInstanceOf(AnthropicProvider);
  await provider.complete([{ role: 'user', content: 'hi', timestamp: 0 }], { model: 'm' });
  expect(captured.url).toBe('https://team-proxy.test/v1/messages');
  expect(captured.headers['x-api-key']).toBe('custom-secret');
});

test('an ollama base ending in /v1 is served by the compatible client', async () => {
  let url = '';
  globalThis.fetch = (async (target: any) => {
    url = String(target);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  }) as typeof fetch;

  const viaCompat = createChatProvider('ollama', { ollama: { base_url: 'http://localhost:11434/v1' } });
  const native = createChatProvider('ollama', { ollama: { endpoint: 'http://localhost:11434' } });

  expect(viaCompat).toBeInstanceOf(OpenAICompatProvider);
  expect(native).toBeInstanceOf(OllamaProvider);
  await viaCompat.complete([{ role: 'user', content: 'hi', timestamp: 0 }], { model: 'm' });
  expect(url).toBe('http://localhost:11434/v1/chat/completions');
});

test('ollama lists models through the native tags route', async () => {
  let url = '';
  globalThis.fetch = (async (target: any) => {
    url = String(target);
    return new Response(JSON.stringify({ models: [{ name: 'llama3:8b' }, { model: 'qwen3' }] }), { status: 200 });
  }) as typeof fetch;

  const provider = createChatProvider('ollama', { ollama: { endpoint: 'http://localhost:11434' } }) as OllamaProvider;
  const models = await provider.listModels();

  expect(url).toBe('http://localhost:11434/api/tags');
  expect(models).toEqual([
    { id: 'llama3:8b', name: 'llama3:8b' },
    { id: 'qwen3', name: 'qwen3' },
  ]);
});

test('only configured providers are enumerated for discovery', () => {
  expect(listConfiguredProviders({})).toEqual([]);
  process.env.JAMCLI_OR_KEY = 'x';
  expect(listConfiguredProviders({ openrouter: { key_env_var: 'JAMCLI_OR_KEY' }, ollama: {} })).toEqual([
    'ollama',
    'openrouter',
  ]);
});
