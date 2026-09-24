import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';

let server: FakeProviderServer;
let root: string;
const sharedCache = process.env.JAMCLI_CACHE_DIR;

beforeEach(() => {
  server = startFakeProvider();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-claude-'));
  process.env.JAMCLI_CACHE_DIR = path.join(root, '.cache');
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  server.close();
  process.env.JAMCLI_CACHE_DIR = sharedCache;
  fs.rmSync(root, { recursive: true, force: true });
});

/** A Claude model from the bundled table, and the default profile's temperature. */
function configure(model: string, config: Record<string, unknown> = {}) {
  const dir = path.join(root, '.jamcli');
  fs.mkdirSync(path.join(dir, 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ api_registry: { anthropic: { base_url: server.anthropicBaseUrl, api_key: 'sk-ant-test-0123456789' } }, trust: { enabled: false }, ...config })
  );
  fs.writeFileSync(
    path.join(dir, 'profiles', 'default.json'),
    JSON.stringify({ name: 'Default', preferred_provider: 'anthropic', preferred_model: model, temperature: 0.7 })
  );
}

const start = () => createRuntime({ projectRoot: root, surface: 'headless', mcp: false });
const lastBody = () => server.completions().at(-1)!.body;

test("the default profile's temperature does not reach a Claude model that refuses it", async () => {
  configure('claude-opus-5-5');
  const runtime = await start();
  server.enqueue({ text: 'ok' });
  expect((await runtime.run('hi')).status).toBe('ok');
  expect(lastBody().model).toBe('claude-opus-5-5');
  expect(lastBody().temperature).toBeUndefined();

  configure('claude-haiku-4-5');
  const older = await start();
  server.enqueue({ text: 'ok' });
  await older.run('hi');
  expect(lastBody().temperature).toBe(0.7);
});
