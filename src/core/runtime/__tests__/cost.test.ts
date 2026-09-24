import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { SessionLog } from '../../transcript/index.js';
import type { AgentEvent } from '../../types.js';

let server: FakeProviderServer;
let root: string;
const sharedCache = process.env.JAMCLI_CACHE_DIR;

beforeAll(() => {
  server = startFakeProvider({
    models: [
      { id: 'fake-model', contextLength: 32768, capabilities: ['completion', 'tools'] },
      { id: 'claude-x', metadata: { max_input_tokens: 500_000, max_tokens: 20_000 } },
    ],
  });
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-cost-'));
  process.env.JAMCLI_CACHE_DIR = path.join(root, '.cache');
  fs.writeFileSync(path.join(root, 'a.txt'), 'hello\n');
});
afterEach(() => {
  process.env.JAMCLI_CACHE_DIR = sharedCache;
  fs.rmSync(root, { recursive: true, force: true });
});

const PRICE = { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 };

function configure(config: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
  const dir = path.join(root, '.jamcli');
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      api_registry: {
        ollama: { endpoint: server.ollamaBaseUrl },
        anthropic: { base_url: server.anthropicBaseUrl, api_key: 'sk-ant-test-0123456789' },
        openai: { base_url: server.openaiBaseUrl, api_key: 'sk-test-0123456789abcdef' },
      },
      models: { 'anthropic:claude-x': { price: PRICE } },
      trust: { enabled: false },
      ...config,
    })
  );
  fs.writeFileSync(
    path.join(dir, 'profiles', 'default.json'),
    JSON.stringify({ name: 'Default', preferred_provider: 'anthropic', preferred_model: 'claude-x', ...profile })
  );
}

const start = (options: Partial<Parameters<typeof createRuntime>[0]> = {}) =>
  createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });

const usageEvents = () => {
  const events: Extract<AgentEvent, { type: 'usage' }>[] = [];
  return { events, onEvent: (event: AgentEvent) => event.type === 'usage' && events.push(event) };
};

test('each request is priced as it is made, cache parts included, and the log keeps the price', async () => {
  configure();
  const runtime = await start();
  server.enqueue({ text: 'ok', usage: { prompt: 1_500, completion: 100, cacheRead: 200, cacheWrite: 300 } });
  const { events, onEvent } = usageEvents();
  await runtime.run('hi', onEvent);

  const expected = (1_000 * 3 + 200 * 0.3 + 300 * 3.75 + 100 * 15) / 1e6;
  expect(events).toHaveLength(1);
  expect(events[0].model).toBe('anthropic:claude-x');
  expect(events[0].cost).toBeCloseTo(expected, 12);
  expect(runtime.spend()).toMatchObject({ requests: 1, unpriced: 0 });
  expect(runtime.spend().cost).toBeCloseTo(expected, 12);
  expect(runtime.spend().models[0].usage).toMatchObject({ prompt_tokens: 1_500, cached_tokens: 200, cache_write_tokens: 300 });

  const logged = SessionLog.open(root, runtime.sessionId).events().find((event) => event.type === 'usage');
  expect(logged).toMatchObject({ model: 'anthropic:claude-x', usage: { prompt_tokens: 1_500 } });
  expect((logged as { cost: number }).cost).toBeCloseTo(expected, 12);
});

test('a continued session keeps its spend, priced as it was, and adds to it', async () => {
  configure();
  const first = await start();
  server.enqueue({ text: 'ok', usage: { prompt: 1_000, completion: 0 } });
  await first.run('hi');

  // The price changes between sessions; what was spent does not.
  configure({ models: { 'anthropic:claude-x': { price: { input: 30, output: 150 } } } });
  const second = await start({ sessionId: first.sessionId });
  expect(second.spend().cost).toBeCloseTo(0.003, 12);
  server.enqueue({ text: 'ok', usage: { prompt: 1_000, completion: 0 } });
  await second.run('again');
  expect(second.spend().cost).toBeCloseTo(0.003 + 0.03, 12);
  expect(second.spend().requests).toBe(2);
});

test('local models cost nothing, an unknown price is counted apart, and each model keeps its own', async () => {
  configure({}, { preferred_provider: 'ollama', preferred_model: 'fake-model' });
  const runtime = await start();
  server.enqueue({ text: 'ok', usage: { prompt: 100, completion: 10 } });
  await runtime.run('local');

  runtime.setModel('openai:mystery');
  server.enqueue({ text: 'ok', usage: { prompt: 100, completion: 10 } });
  await runtime.run('unknown');

  runtime.setModel('anthropic:claude-x');
  server.enqueue({ text: 'ok', usage: { prompt: 1_000, completion: 0 } });
  await runtime.run('priced');

  const spend = runtime.spend();
  expect(spend.models.map((model) => [model.model, model.requests, model.unpriced])).toEqual([
    ['ollama:fake-model', 1, 0],
    ['openai:mystery', 1, 1],
    ['anthropic:claude-x', 1, 0],
  ]);
  expect(spend.cost).toBeCloseTo(0.003, 12);
  expect(spend.unpriced).toBe(1);
});

test("the trust gate's requests are counted under its own model", async () => {
  configure({ trust: { model: 'ollama:fake-model' } });
  const runtime = await start();
  server.enqueue(
    { toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: 'a.txt' } }], usage: { prompt: 1_000, completion: 20 } },
    // The classifier's verdict.
    { text: '{"index":0,"relevance":1,"injection":false}', usage: { prompt: 300, completion: 5 } },
    { text: 'It says hello.', usage: { prompt: 1_100, completion: 10 } }
  );
  const result = await runtime.run('what does a.txt say?');
  expect(result.response).toBe('It says hello.');
  const spend = runtime.spend();
  expect(spend.models.map((model) => [model.model, model.requests])).toEqual([
    ['anthropic:claude-x', 2],
    ['ollama:fake-model', 1],
  ]);
  expect(spend.models[1]).toMatchObject({ cost: 0, unpriced: 0, usage: { prompt_tokens: 300 } });
  expect(result.usage.prompt_tokens).toBe(2_400);
  // The log attributes each request the same way, so a continued session agrees.
  const resumed = await start({ sessionId: runtime.sessionId });
  expect(resumed.spend().models.map((model) => [model.model, model.requests])).toEqual([
    ['anthropic:claude-x', 2],
    ['ollama:fake-model', 1],
  ]);
});
