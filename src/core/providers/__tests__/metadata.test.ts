import { afterEach, expect, test } from 'bun:test';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { AnthropicProvider } from '../anthropic.js';
import { OllamaProvider } from '../ollama.js';
import { OpenAICompatProvider } from '../openai-compat.js';
import { ProviderError } from '../http.js';

let server: FakeProviderServer | undefined;
afterEach(() => server?.close());

test('Ollama reports the context length under the model architecture, and its capabilities', async () => {
  server = startFakeProvider({
    models: [
      { id: 'coder:7b', contextLength: 131072, capabilities: ['completion', 'tools', 'thinking'] },
      { id: 'looker', contextLength: 4096, capabilities: ['completion', 'vision'] },
    ],
  });
  const provider = new OllamaProvider({ endpoint: server.ollamaBaseUrl });
  expect(await provider.describeModel('coder:7b')).toEqual({ contextWindow: 131072, tools: true, reasoning: true, images: false });
  expect(await provider.describeModel('looker')).toEqual({ contextWindow: 4096, tools: false, reasoning: false, images: true });
  // A model Ollama does not have is not listed, as the provider contract says, rather than an error.
  expect(await provider.describeModel('absent')).toBeUndefined();
});

test('metadata is asked for once, even when the failure is one a chat request would retry', async () => {
  let hits = 0;
  const busy = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => {
      hits += 1;
      return new Response('busy', { status: 503 });
    },
  });
  try {
    const url = `http://127.0.0.1:${busy.port}`;
    const providers = [
      new OllamaProvider({ endpoint: url }),
      new OpenAICompatProvider({ baseUrl: `${url}/v1` }),
      new AnthropicProvider({ baseUrl: url }),
    ];
    for (const provider of providers) {
      const before = hits;
      const error = (await provider.describeModel('m').catch((caught) => caught)) as ProviderError;
      expect(error.status).toBe(503);
      expect(hits - before).toBe(1);
    }
  } finally {
    busy.stop(true);
  }
});

test('an OpenRouter entry gives limits, capabilities, and prices per million tokens', async () => {
  server = startFakeProvider({
    models: [
      {
        id: 'vendor/model',
        metadata: {
          context_length: 200000,
          top_provider: { context_length: 200000, max_completion_tokens: 64000 },
          architecture: { input_modalities: ['text', 'image'] },
          supported_parameters: ['tools', 'tool_choice', 'reasoning', 'max_tokens'],
          pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.00000375' },
        },
      },
      { id: 'vendor/free', metadata: { context_length: 32768, pricing: { prompt: '0', completion: '0' } } },
      { id: 'vendor/cheap', metadata: { pricing: { prompt: '0.0000001', completion: '0.00000045' } } },
      { id: 'openrouter/auto', metadata: { context_length: 2000000, pricing: { prompt: '-1', completion: '-1' } } },
    ],
  });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl, name: 'openrouter' });
  expect(await provider.describeModel('vendor/model')).toEqual({
    contextWindow: 200000,
    maxOutput: 64000,
    tools: true,
    reasoning: true,
    images: true,
    price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  });
  // Free is a price; a price that varies by route is not.
  expect((await provider.describeModel('vendor/free'))?.price).toEqual({ input: 0, output: 0 });
  // Per-token prices convert without floating-point noise: 0.45, not 0.44999999999999996.
  expect((await provider.describeModel('vendor/cheap'))?.price).toEqual({ input: 0.1, output: 0.45 });
  expect(await provider.describeModel('openrouter/auto')).toEqual({ contextWindow: 2000000 });
  expect(await provider.describeModel('not/listed')).toBeUndefined();
});

test('servers that name the context window differently are all read', async () => {
  server = startFakeProvider({
    models: [
      { id: 'groq', metadata: { context_window: 131072, max_completion_tokens: 32768 } },
      { id: 'mistral', metadata: { max_context_length: 128000 } },
      { id: 'vllm', metadata: { max_model_len: 65536 } },
      { id: 'openai', metadata: { object: 'model', owned_by: 'openai' } },
    ],
  });
  const provider = new OpenAICompatProvider({ baseUrl: server.openaiBaseUrl });
  expect(await provider.describeModel('groq')).toEqual({ contextWindow: 131072, maxOutput: 32768 });
  expect(await provider.describeModel('mistral')).toEqual({ contextWindow: 128000 });
  expect(await provider.describeModel('vllm')).toEqual({ contextWindow: 65536 });
  // OpenAI's own models route lists ids and owners, and nothing the catalog can use.
  expect(await provider.describeModel('openai')).toEqual({});
});

test('the Anthropic Models API gives limits and thinking style, and a zero limit means unknown', async () => {
  const capabilities = (adaptive: boolean, enabled: boolean) => ({
    image_input: { supported: true },
    thinking: { supported: adaptive || enabled, types: { adaptive: { supported: adaptive }, enabled: { supported: enabled } } },
    effort: { supported: adaptive },
  });
  server = startFakeProvider({
    models: [
      { id: 'claude-new', metadata: { max_input_tokens: 1000000, max_tokens: 128000, capabilities: capabilities(true, true) } },
      { id: 'claude-old', metadata: { max_input_tokens: 200000, max_tokens: 64000, capabilities: capabilities(false, true) } },
      { id: 'claude-blank', metadata: { max_input_tokens: 0, max_tokens: null, capabilities: null } },
    ],
  });
  const provider = new AnthropicProvider({ baseUrl: server.anthropicBaseUrl, apiKey: 'sk-ant-test-key-123456' });
  expect(await provider.describeModel('claude-new')).toEqual({
    contextWindow: 1000000,
    maxOutput: 128000,
    images: true,
    reasoning: true,
    thinking: 'adaptive',
    effort: true,
  });
  expect(await provider.describeModel('claude-old')).toMatchObject({ contextWindow: 200000, maxOutput: 64000, thinking: 'budget', effort: false });
  expect(await provider.describeModel('claude-blank')).toEqual({});
  const request = server.requests.find((entry) => entry.path === '/v1/models/claude-new')!;
  expect(request.headers['x-api-key']).toBe('sk-ant-test-key-123456');
  expect(request.headers['anthropic-version']).toBeDefined();
  expect(await provider.describeModel('claude-absent')).toBeUndefined();
});

test('a describe that is cancelled stops at once', async () => {
  server = startFakeProvider();
  const controller = new AbortController();
  controller.abort();
  const provider = new OllamaProvider({ endpoint: server.ollamaBaseUrl });
  await expect(provider.describeModel('fake-model', controller.signal)).rejects.toThrow();
});
