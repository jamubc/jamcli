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

const delegate = (id: string, prompt: string, background = false) => ({
  id,
  name: 'task',
  arguments: { category: 'quick', prompt, ...(background ? { background: true } : {}) },
});

test('what a delegated session spends is counted by the session that delegated, apart from its context', async () => {
  configure({ categories: { quick: [{ model: 'anthropic:claude-x' }] } });
  const parent = await start({ allowTools: ['task'] });
  server.enqueue(
    { toolCalls: [delegate('t1', 'look around')], usage: { prompt: 1_000, completion: 20 } },
    { text: 'child done', usage: { prompt: 500, completion: 50 } },
    { text: 'parent done', usage: { prompt: 1_200, completion: 10 } }
  );
  const made: string[] = [];
  const result = await parent.run('delegate', (event) => {
    if (event.type === 'usage') made.push(event.delegatedSession ? 'child' : 'own');
  });
  expect(result.response).toBe('parent done');
  expect(made).toEqual(['own', 'child', 'own']);

  const spend = parent.spend();
  expect(spend.requests).toBe(3);
  expect(spend.delegated.requests).toBe(1);
  expect(spend.delegated.cost).toBeCloseTo((500 * 3 + 50 * 15) / 1e6, 12);
  // The conversation's own usage leaves the child's out.
  expect(result.usage.prompt_tokens).toBe(2_200);

  // The parent's log names the session that made the request, and a continued session agrees.
  const logged = SessionLog.open(root, parent.sessionId).events().flatMap((event) => (event.type === 'usage' ? [event.delegated ?? 'own'] : []));
  expect(logged[0]).toBe('own');
  expect(logged[1]).not.toBe('own');
  expect(SessionLog.exists(root, logged[1])).toBe(true);
  const resumed = await start({ sessionId: parent.sessionId });
  expect(resumed.spend().delegated).toEqual(spend.delegated);
  expect(resumed.session.usage.prompt_tokens).toBe(2_200);
});

test('a background child that finishes after the turn is still counted and recorded', async () => {
  configure({
    categories: { quick: [{ model: 'anthropic:claude-y' }] },
    models: { 'anthropic:claude-x': { price: PRICE }, 'anthropic:claude-y': { price: PRICE } },
  });
  const parent = await start({ allowTools: ['task'] });
  server.enqueue(
    { toolCalls: [delegate('t1', 'take your time', true)], usage: { prompt: 1_000, completion: 20 }, forModel: 'claude-x' },
    { text: 'parent done', usage: { prompt: 1_100, completion: 10 }, forModel: 'claude-x' },
    // The child answers well after the parent's turn is over.
    { text: 'child done', usage: { prompt: 400, completion: 40 }, delayMs: 500, forModel: 'claude-y' }
  );
  const result = await parent.run('start it in the background');
  expect(result.response).toBe('parent done');
  expect(parent.spend().delegated.requests).toBe(0);

  for (let waited = 0; parent.spend().delegated.requests === 0 && waited < 3_000; waited += 25) await Bun.sleep(25);
  expect(parent.spend().delegated.requests).toBe(1);
  const delegated = SessionLog.open(root, parent.sessionId).events().filter((event) => event.type === 'usage' && event.delegated);
  expect(delegated).toMatchObject([{ model: 'anthropic:claude-y', usage: { prompt_tokens: 400 } }]);
});

test("a grandchild's request is attributed to the grandchild, all the way up", async () => {
  configure({
    categories: { quick: [{ model: 'anthropic:claude-y' }] },
    models: { 'anthropic:claude-x': { price: PRICE }, 'anthropic:claude-y': { price: PRICE } },
  });
  const parent = await start({ allowTools: ['task'] });
  server.enqueue(
    { toolCalls: [delegate('t1', 'delegate further')], usage: { prompt: 100, completion: 1 }, forModel: 'claude-x' },
    { toolCalls: [delegate('t2', 'do the work')], usage: { prompt: 200, completion: 2 }, forModel: 'claude-y' },
    { text: 'grandchild done', usage: { prompt: 300, completion: 3 }, forModel: 'claude-y' },
    { text: 'child done', usage: { prompt: 400, completion: 4 }, forModel: 'claude-y' },
    { text: 'parent done', usage: { prompt: 500, completion: 5 }, forModel: 'claude-x' }
  );
  const result = await parent.run('go');
  expect(result.response).toBe('parent done');
  const byPrompt = new Map(
    SessionLog.open(root, parent.sessionId)
      .events()
      .flatMap((event) => (event.type === 'usage' ? [[event.usage.prompt_tokens, event.delegated ?? 'own'] as const] : []))
  );
  const child = byPrompt.get(200)!;
  const grandchild = byPrompt.get(300)!;
  expect([byPrompt.get(100), byPrompt.get(500)]).toEqual(['own', 'own']);
  expect(byPrompt.get(400)).toBe(child);
  expect(grandchild).not.toBe(child);
  expect(SessionLog.open(root, grandchild).events()[0]).toMatchObject({ delegatedBy: child });
  expect(parent.spend().delegated.requests).toBe(3);
});

test('a request whose server reports no counts is still counted, and priced only when the model is free', async () => {
  configure({}, { preferred_provider: 'ollama', preferred_model: 'fake-model' });
  const free = await start();
  const events: AgentEvent[] = [];
  server.enqueue({ text: 'No counts.' });
  await free.run('hi', (event) => events.push(event));
  expect(events.find((event) => event.type === 'usage')).toMatchObject({ unreported: true, cost: 0 });
  expect(free.spend()).toMatchObject({ requests: 1, unpriced: 0, cost: 0 });
  await free.close();

  configure({ models: { 'ollama:fake-model': { price: { input: 1, output: 2 } } } }, { preferred_provider: 'ollama', preferred_model: 'fake-model' });
  const priced = await start();
  server.enqueue({ text: 'No counts either.' });
  await priced.run('hi');
  // Tokens were spent but not reported, so the cost is unknown, not nothing.
  expect(priced.spend()).toMatchObject({ requests: 1, unpriced: 1, cost: 0 });
  await priced.close();
});
