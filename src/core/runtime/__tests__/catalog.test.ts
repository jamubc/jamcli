import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { DEFAULT_OLLAMA_CONTEXT_CAP } from '../../providers/ollama.js';
import type { ChatProvider } from '../../providers/types.js';
import type { ModelFacts } from '../../catalog/index.js';
import type { AgentEvent } from '../../types.js';

// Keys come from the environment, as they should: a key in the project's files draws a notice.
process.env.JAMCLI_TEST_ANTHROPIC_KEY = 'sk-ant-test-0123456789';
process.env.JAMCLI_TEST_OPENAI_KEY = 'sk-test-0123456789abcdef';

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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-catalog-'));
  // Each test starts with nothing cached, so what the provider says is asked afresh.
  process.env.JAMCLI_CACHE_DIR = path.join(root, '.cache');
});
afterEach(() => {
  process.env.JAMCLI_CACHE_DIR = sharedCache;
  fs.rmSync(root, { recursive: true, force: true });
});

function configure(config: Record<string, unknown> = {}, profile: Record<string, unknown> = {}) {
  const dir = path.join(root, '.jamcli');
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  const { api_registry, ...rest } = config as { api_registry?: Record<string, unknown> };
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({
      api_registry: { ollama: { endpoint: server.ollamaBaseUrl }, anthropic: { base_url: server.anthropicBaseUrl, key_env_var: 'JAMCLI_TEST_ANTHROPIC_KEY' }, ...api_registry },
      ...rest,
    })
  );
  fs.writeFileSync(path.join(dir, 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_provider: 'ollama', preferred_model: 'fake-model', ...profile }));
}

const start = (options: Partial<Parameters<typeof createRuntime>[0]> = {}) =>
  createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });

const lastRequest = () => server.completions().at(-1)!.body;

test('Anthropic requests ask for the output the model allows, capped, from its own metadata', async () => {
  configure({}, { preferred_provider: 'anthropic', preferred_model: 'claude-x' });
  const runtime = await start();
  server.enqueue({ text: 'ok' });
  await runtime.run('hi');
  expect(lastRequest().max_tokens).toBe(20_000);
  expect(runtime.modelInfo).toMatchObject({ contextWindow: 500_000, maxOutput: 20_000 });
  expect(runtime.modelInfo.sources).toMatchObject({ contextWindow: 'provider', maxOutput: 'provider' });

  configure({ agent_loop: { max_output_tokens: 8_000 } }, { preferred_provider: 'anthropic', preferred_model: 'claude-x' });
  const capped = await start();
  server.enqueue({ text: 'ok' });
  await capped.run('hi');
  expect(lastRequest().max_tokens).toBe(8_000);
});

test('Ollama is asked for the window the catalog settles on', async () => {
  configure();
  const plain = await start();
  server.enqueue({ text: 'ok' });
  await plain.run('hi');
  expect(lastRequest().options.num_ctx).toBe(DEFAULT_OLLAMA_CONTEXT_CAP);
  expect(plain.modelInfo.price).toEqual({ input: 0, output: 0 });

  configure({ models: { 'ollama:fake-model': { context_window: 65_536 } } });
  const configured = await start();
  server.enqueue({ text: 'ok' });
  await configured.run('hi');
  expect(lastRequest().options.num_ctx).toBe(65_536);

  // The provider-wide setting still holds, now through the catalog.
  configure({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl, num_ctx: 24_576 } } });
  const sized = await start();
  server.enqueue({ text: 'ok' });
  await sized.run('hi');
  expect(lastRequest().options.num_ctx).toBe(24_576);
  expect(sized.modelInfo.contextWindow).toBe(24_576);
});

test('a model whose window no source knows is named, with the setting that fixes it', async () => {
  configure({ api_registry: { openai: { base_url: server.openaiBaseUrl, key_env_var: 'JAMCLI_TEST_OPENAI_KEY' } } }, { preferred_provider: 'openai', preferred_model: 'mystery' });
  const runtime = await start();
  server.enqueue({ text: 'ok' }, { text: 'ok' });
  const notices: string[] = [];
  const onEvent = (event: AgentEvent) => {
    if (event.type === 'notice') notices.push(event.message);
  };
  await runtime.run('hi', onEvent);
  await runtime.run('again', onEvent);
  expect(notices).toEqual([
    'JamCLI does not know the context window of openai:mystery, so it compacts the conversation only when the provider refuses it as too long. Set models["openai:mystery"].context_window in .jamcli/config.json.',
  ]);
  expect(runtime.notices).toEqual(notices);
  // Its output limit is unknown too, so the server's own default applies.
  expect(lastRequest().max_tokens).toBeUndefined();

  // Ollama's window is the one JamCLI asks for, so an unknown one is not a guess worth a notice.
  configure({}, { preferred_model: 'absent' });
  const local = await start();
  server.enqueue({ text: 'ok' });
  const localNotices: string[] = [];
  await local.run('hi', (event) => {
    if (event.type === 'notice') localNotices.push(event.message);
  });
  expect(local.modelInfo.sources.contextWindow).toBe('default');
  expect(localNotices).toEqual([]);
});

test('mistakes in the models block are reported by the first turn', async () => {
  configure({ models: { 'ollama:fake-model': { context_window: 'huge' } } });
  const runtime = await start();
  server.enqueue({ text: 'ok' });
  const notices: string[] = [];
  await runtime.run('hi', (event) => {
    if (event.type === 'notice') notices.push(event.message);
  });
  expect(notices).toEqual(['.jamcli/config.json models["ollama:fake-model"].context_window should be a whole number above zero, so it is ignored.']);
});

test('switching models sizes the next request from the new model', async () => {
  configure();
  const runtime = await start();
  runtime.setModel('anthropic:claude-x');
  // Known at once from configuration, the cache, and the bundled table; the provider's answer follows.
  expect(runtime.modelInfo.model).toBe('claude-x');
  server.enqueue({ text: 'ok' });
  await runtime.run('hi');
  expect(lastRequest().max_tokens).toBe(20_000);
  expect(runtime.modelInfo.model).toBe('claude-x');
});

test('an answer about a model the session has already left is dropped', async () => {
  configure();
  let answer!: (facts: ModelFacts) => void;
  const slow = {
    family: 'openai',
    describeModel: () => new Promise<ModelFacts>((resolve) => (answer = resolve)),
    streamChat: async function* () {},
    complete: async () => ({ content: '' }),
  } as unknown as ChatProvider;
  const runtime = await start({ provider: slow });
  runtime.setModel('ollama:fake-model');
  server.enqueue({ text: 'ok' }, { text: 'ok' });
  await runtime.run('hi');
  // The first provider answers only now, after the switch has settled.
  answer({ contextWindow: 999 });
  await Bun.sleep(10);
  await runtime.run('again');
  expect(runtime.modelInfo.contextWindow).toBe(DEFAULT_OLLAMA_CONTEXT_CAP);
  expect(lastRequest().options.num_ctx).toBe(DEFAULT_OLLAMA_CONTEXT_CAP);
});

test('a reply cut off at the output limit says so, in every wire format', async () => {
  const noticesOf = async (runtime: Awaited<ReturnType<typeof start>>) => {
    const notices: string[] = [];
    await runtime.run('write a lot', (event) => {
      if (event.type === 'notice') notices.push(event.message);
    });
    return notices;
  };
  configure({}, { preferred_provider: 'anthropic', preferred_model: 'claude-x' });
  const anthropic = await start();
  server.enqueue({ text: 'half a rep', stopReason: 'max_tokens' });
  expect(await noticesOf(anthropic)).toEqual([
    'The reply stopped at the output limit of 20,000 tokens, so it may be incomplete. Raise agent_loop.max_output_tokens, or ask the model to continue.',
  ]);

  configure();
  const ollama = await start();
  server.enqueue({ text: 'half a rep', stopReason: 'length' }, { text: 'done' });
  expect(await noticesOf(ollama)).toEqual([
    'The reply stopped at the output limit, so it may be incomplete. Raise agent_loop.max_output_tokens, or ask the model to continue.',
  ]);
  // A reply that ends on its own says nothing.
  expect(await noticesOf(ollama)).toEqual([]);

  configure(
    { api_registry: { openai: { base_url: server.openaiBaseUrl, key_env_var: 'JAMCLI_TEST_OPENAI_KEY' } }, models: { 'openai:known': { context_window: 100_000, max_output: 4_000 } } },
    { preferred_provider: 'openai', preferred_model: 'known' }
  );
  const openai = await start();
  server.enqueue({ text: 'half a rep', stopReason: 'length' });
  expect(await noticesOf(openai)).toEqual([
    'The reply stopped at the output limit of 4,000 tokens, so it may be incomplete. Raise agent_loop.max_output_tokens, or ask the model to continue.',
  ]);
  expect(lastRequest().max_tokens).toBe(4_000);
});

test('the configured effort goes out on each request, as the nearest level models.dev says the model takes, and /effort changes it', async () => {
  // A models.dev feed that lists the fake endpoint by its URL, so the custom id matches it.
  const feed = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({ lab: { api: server.openaiBaseUrl, models: { 'fake-model': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }], limit: { context: 64_000, output: 8_000 } } } } }),
  });
  const before = process.env.JAMCLI_MODELS_DIRECTORY;
  process.env.JAMCLI_MODELS_DIRECTORY = `http://127.0.0.1:${feed.port}/api.json`;
  try {
    // The custom id differs from the feed's, so only the endpoint URL can match it.
    configure({ model: 'other:fake-model', effort: 'medium', api_registry: { endpoints: [{ id: 'other', base_url: server.openaiBaseUrl, key_env_var: 'LAB_KEY' }] } });
    const runtime = await start({ env: { LAB_KEY: 'k' } });
    expect(runtime.thinking).toEqual({ effort: 'medium' });
    server.enqueue({ text: 'ok' });
    await runtime.run('hi');
    expect(runtime.modelInfo.sources.efforts).toBe('directory');
    expect(lastRequest().reasoning_effort).toBe('high');

    runtime.setThinking({ effort: 'low' });
    server.enqueue({ text: 'ok' });
    await runtime.run('again');
    expect(lastRequest().reasoning_effort).toBe('low');

    runtime.setThinking({});
    server.enqueue({ text: 'ok' });
    await runtime.run('once more');
    expect(lastRequest().reasoning_effort).toBeUndefined();
  } finally {
    process.env.JAMCLI_MODELS_DIRECTORY = before;
    feed.stop(true);
  }
});

test('notices a surface takes when the session opens are not reported again by the first turn', async () => {
  configure({ active_profile: 'nowhere' });
  const runtime = await start();
  const taken = runtime.takeNotices();
  expect(taken.some((notice) => notice.includes('names the profile "nowhere"'))).toBe(true);
  expect(runtime.notices).toEqual(expect.arrayContaining(taken));
  server.enqueue({ text: 'ok' });
  const notices: string[] = [];
  await runtime.run('hi', (event) => {
    if (event.type === 'notice') notices.push(event.message);
  });
  expect(notices.filter((notice) => taken.includes(notice))).toEqual([]);
});

test("a key in the project's files draws a notice that says how to move it", async () => {
  configure({ api_registry: { openrouter: { api_key: 'sk-or-v1-in-the-project' } } });
  const runtime = await start();
  expect(runtime.notices).toContain(
    '.jamcli/config.json holds the openrouter key, where a commit or a copy of the folder would carry it. Move it with jamcli auth set openrouter, then jamcli config unset api_registry.openrouter.api_key --scope project.'
  );
  expect(runtime.notices.join('\n')).not.toContain('sk-or-v1-in-the-project');
});
