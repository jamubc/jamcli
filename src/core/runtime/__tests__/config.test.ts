import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent } from '../../types.js';

let server: FakeProviderServer;
let root: string;
let userDir: string;
const shared = { config: process.env.JAMCLI_CONFIG_DIR, cache: process.env.JAMCLI_CACHE_DIR };

beforeEach(() => {
  server = startFakeProvider();
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-config-')));
  root = path.join(base, 'project');
  userDir = path.join(base, 'user');
  fs.mkdirSync(root);
  process.env.JAMCLI_CONFIG_DIR = userDir;
  process.env.JAMCLI_CACHE_DIR = path.join(base, 'cache');
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  server.close();
  process.env.JAMCLI_CONFIG_DIR = shared.config;
  process.env.JAMCLI_CACHE_DIR = shared.cache;
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

const write = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const userConfig = (value: unknown) => write(path.join(userDir, 'config.json'), value);
const start = (options: Partial<Parameters<typeof createRuntime>[0]> = {}) =>
  createRuntime({ projectRoot: root, surface: 'headless', mcp: false, env: {}, ...options });
const lastModel = () => server.completions().at(-1)!.body.model;

test("the user's configuration serves a project that has none of its own", async () => {
  userConfig({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model' });
  const runtime = await start();
  expect(runtime.notices).toEqual([]);
  expect(runtime.model).toEqual({ provider: 'ollama', model: 'fake-model' });
  server.enqueue({ text: 'ok' });
  expect((await runtime.run('hi')).response).toBe('ok');
  expect(lastModel()).toBe('fake-model');
});

test('the project overrides the user, JAMCLI_MODEL overrides both, and --model overrides that', async () => {
  userConfig({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:user-model' });
  write(path.join(root, '.jamcli', 'config.json'), { model: 'ollama:project-model' });
  expect((await start()).model.model).toBe('project-model');
  expect((await start({ env: { JAMCLI_MODEL: 'ollama:env-model' } })).model.model).toBe('env-model');
  expect((await start({ env: { JAMCLI_MODEL: 'ollama:env-model' }, model: 'ollama:flag-model' })).model.model).toBe('flag-model');
});

test("a deny rule in the user's configuration holds in every project, and bad values are reported once", async () => {
  userConfig({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model', permissions: { deny: ['write_file'] } });
  write(path.join(root, '.jamcli', 'config.json'), { permissions: { allow: ['write_file'] }, agent_loop: { max_steps: 'many' } });
  write(path.join(root, '.jamcli', 'config.local.json'), '{ broken');
  const runtime = await start({ allowTools: ['write_file'] });
  expect(runtime.notices).toHaveLength(2);
  expect(runtime.notices[0]).toBe('.jamcli/config.json agent_loop.max_steps should be a whole number above zero, so it is ignored.');
  expect(runtime.notices[1]).toStartWith('.jamcli/config.local.json is not valid JSON, so it is ignored:');

  server.enqueue({ toolCalls: [{ id: 'w1', name: 'write_file', arguments: { path: 'x.txt', content: 'x' } }] }, { text: 'stopped' });
  const results: AgentEvent[] = [];
  await runtime.run('write it', (event) => {
    if (event.type === 'tool_result') results.push(event);
  });
  expect(results).toHaveLength(1);
  expect((results[0] as Extract<AgentEvent, { type: 'tool_result' }>).result.status).toBe('denied');
  expect(fs.existsSync(path.join(root, 'x.txt'))).toBe(false);
});
