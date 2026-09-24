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
  expect(await service.getActiveProfile()).toMatchObject({ name: 'Default' });
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
