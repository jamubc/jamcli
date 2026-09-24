import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let server: FakeProviderServer;
let base: string;
let root: string;
let hanging: ReturnType<typeof Bun.serve> | undefined;
const shared = process.env.JAMCLI_CONFIG_DIR;
const sharedCache = process.env.JAMCLI_CACHE_DIR;

beforeEach(() => {
  server = startFakeProvider({
    models: [
      { id: 'fake-model', contextLength: 32768, capabilities: ['completion', 'tools'] },
      { id: 'other-model', capabilities: ['completion'] },
    ],
  });
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-models-')));
  root = path.join(base, 'project');
  fs.mkdirSync(root);
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
  process.env.JAMCLI_CACHE_DIR = path.join(base, 'cache');
  fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR);
});
afterEach(() => {
  server.close();
  hanging?.stop(true);
  hanging = undefined;
  process.env.JAMCLI_CONFIG_DIR = shared;
  if (sharedCache === undefined) delete process.env.JAMCLI_CACHE_DIR;
  else process.env.JAMCLI_CACHE_DIR = sharedCache;
  fs.rmSync(base, { recursive: true, force: true });
});

const configure = (value: object) => fs.writeFileSync(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json'), JSON.stringify(value));

test('every configured provider lists its models, each with what the catalog knows, and one that cannot be asked is named', async () => {
  configure({
    model: 'ollama:fake-model',
    api_registry: {
      ollama: { endpoint: server.ollamaBaseUrl },
      endpoints: [
        { id: 'lab', base_url: server.openaiBaseUrl, key_env_var: 'LAB_KEY' },
        { id: 'down', base_url: 'http://127.0.0.1:9/v1' },
      ],
    },
    models: { 'lab:fake-model': { price: { input: 1, output: 2 } } },
  });
  const runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false, env: { LAB_KEY: 'k' } });
  try {
    const { models, problems } = await runtime.listModels(2_000);
    const names = models.map((model) => `${model.provider}:${model.model}`).sort();
    expect(names).toEqual(['lab:fake-model', 'lab:other-model', 'ollama:fake-model', 'ollama:other-model']);
    // Local models cost nothing; a price from the models block is used; nothing else is guessed.
    expect(models.find((model) => model.provider === 'ollama')!.price).toEqual({ input: 0, output: 0 });
    const lab = models.find((model) => model.provider === 'lab' && model.model === 'fake-model')!;
    expect(lab.price).toEqual({ input: 1, output: 2 });
    expect(lab.sources.price).toBe('config');
    expect(models.find((model) => model.provider === 'lab' && model.model === 'other-model')!.price).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toStartWith('down: ');
  } finally {
    await runtime.close();
  }
});

test('a provider that does not answer in time is left out, and the rest still arrive', async () => {
  hanging = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => undefined) });
  configure({
    model: 'ollama:fake-model',
    api_registry: { ollama: { endpoint: server.ollamaBaseUrl }, endpoints: [{ id: 'slow', base_url: `http://127.0.0.1:${hanging.port}/v1` }] },
  });
  const runtime = await createRuntime({ projectRoot: root, surface: 'tui', mcp: false, env: {} });
  try {
    const started = Date.now();
    const { models, problems } = await runtime.listModels(300);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(models.map((model) => model.provider)).toEqual(['ollama', 'ollama']);
    expect(problems).toEqual(['slow: did not answer within 0.3 s']);
  } finally {
    await runtime.close();
  }
});
