import { test, expect, afterEach } from 'bun:test';
import { ModelService } from '../ModelService.js';
import type { ConfigService } from '../ConfigService.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const serviceFor = (config: any): ModelService =>
  new ModelService({
    getConfig: async () => config,
    getActiveProfile: async () => ({}),
  } as unknown as ConfigService);

const baseConfig = (api_registry: any, available_models?: any[]) => ({
  api_registry,
  active_profile: 'default',
  telemetry: false,
  ...(available_models ? { available_models } : {}),
});

test('merges discovered and configured models and labels where each came from', async () => {
  globalThis.fetch = (async (target: any) => {
    if (String(target).includes('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'llama3:8b' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  }) as typeof fetch;

  const service = serviceFor(
    baseConfig(
      { ollama: { endpoint: 'http://localhost:11434' } },
      [{ id: 'openrouter:custom', provider: 'openrouter', name: 'Custom' }]
    )
  );

  const models = await service.listAvailableModels();
  const discovered = models.find((model) => model.id === 'ollama:llama3:8b');
  const configured = models.find((model) => model.id === 'openrouter:custom');

  expect(discovered?.origin).toBe('discovered');
  expect(discovered?.provider).toBe('ollama');
  expect(discovered?.endpoint).toBe('ollama');
  expect(configured?.origin).toBe('configured');
});

test('a failing provider is reported and does not hide the others', async () => {
  globalThis.fetch = (async (target: any) => {
    if (String(target).includes('/api/tags')) {
      return new Response('nope', { status: 503 });
    }
    if (String(target).includes('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o', name: 'GPT-4o' }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const service = serviceFor(
    baseConfig({
      ollama: { endpoint: 'http://localhost:11434' },
      endpoints: [{ id: 'team-openai', base_url: 'https://team.test/v1', dialect: 'openai' as const }],
    })
  );

  const { models, failures } = await service.discoverModels();

  expect(failures.map((failure) => failure.provider)).toEqual(['ollama']);
  expect(models.map((model) => model.id)).toContain('team-openai:gpt-4o');
});

test('discovered models win the dedupe against a configured duplicate', async () => {
  globalThis.fetch = (async (target: any) => {
    if (String(target).includes('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o', name: 'Discovered GPT-4o' }] }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const service = serviceFor(
    baseConfig(
      { openai: { api_key: 'k' }, endpoints: [{ id: 'team-openai', base_url: 'https://team.test/v1', dialect: 'openai' as const }] },
      [{ id: 'team-openai:gpt-4o', provider: 'openai', name: 'Configured GPT-4o' }]
    )
  );

  const models = await service.listAvailableModels();
  const match = models.filter((model) => model.id === 'team-openai:gpt-4o');

  expect(match).toHaveLength(1);
  expect(match[0].origin).toBe('discovered');
  expect(match[0].name).toBe('Discovered GPT-4o');
});
