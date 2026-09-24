import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ConfigService } from '../ConfigService.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-config-service-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const read = (name: string) => JSON.parse(fs.readFileSync(path.join(root, '.jamcli', name), 'utf8'));

test('reading the legacy configuration writes nothing', async () => {
  const service = new ConfigService(root);
  expect((await service.getConfig()).api_registry.ollama).toEqual({ endpoint: 'http://localhost:11434' });
  expect((await service.getMcpConfig()).servers).toEqual([]);
  expect(await service.getActiveProfile()).toEqual({ name: 'default' });
  expect(await service.getUiConfig()).toMatchObject({ status_indicator_style: 'subtle' });
  expect(fs.readdirSync(root)).toEqual([]);
});

test('a change writes only what changed into the project file, which ignores itself', async () => {
  const service = new ConfigService(root);
  await service.setTelemetry(true);
  expect(read('config.json')).toEqual({ telemetry: true });
  expect(fs.readFileSync(path.join(root, '.jamcli', '.gitignore'), 'utf8')).toContain('\n*\n');

  await service.setProviderKey('anthropic', 'sk-ant-test');
  await service.upsertMcpServer({ id: 'files', command: 'npx' });
  expect(read('config.json')).toEqual({ telemetry: true, api_registry: { anthropic: { api_key: 'sk-ant-test' } } });
  expect(read('mcp.json')).toEqual({ servers: [{ id: 'files', command: 'npx' }] });
});

test("the legacy interface reads the user's layer too, and never copies it into the project", async () => {
  const userDir = path.join(root, 'user');
  const shared = process.env.JAMCLI_CONFIG_DIR;
  process.env.JAMCLI_CONFIG_DIR = userDir;
  try {
    fs.mkdirSync(path.join(userDir, 'profiles'), { recursive: true });
    fs.writeFileSync(path.join(userDir, 'config.json'), JSON.stringify({ api_registry: { anthropic: { key_env_var: 'MY_KEY' } } }));
    fs.writeFileSync(path.join(userDir, 'profiles', 'default.json'), JSON.stringify({ preferred_model: 'qwen2.5-coder:7b' }));
    const service = new ConfigService(root);
    expect((await service.getConfig()).api_registry.anthropic).toEqual({ key_env_var: 'MY_KEY' });
    expect((await service.getActiveProfile()).preferred_model).toBe('qwen2.5-coder:7b');
    await service.setTelemetry(true);
    expect(read('config.json')).toEqual({ telemetry: true });
  } finally {
    process.env.JAMCLI_CONFIG_DIR = shared;
  }
});
