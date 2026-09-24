import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { renderChecks, runChecks, type Check } from '../doctor.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';
import { parseArgs } from '../../cli.js';

let server: FakeProviderServer;
let root: string;
let bin: string;
const saved = { config: process.env.JAMCLI_CONFIG_DIR, key: process.env.ANTHROPIC_API_KEY };

beforeEach(() => {
  server = startFakeProvider({ models: [{ id: 'fake-model', contextLength: 32768 }] });
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-doctor-')));
  root = path.join(base, 'project');
  bin = path.join(base, 'bin');
  fs.mkdirSync(root);
  fs.mkdirSync(bin);
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  server.close();
  process.env.JAMCLI_CONFIG_DIR = saved.config;
  if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

const configure = (config: Record<string, unknown>, name = 'config.json') => {
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', name), typeof config === 'string' ? config : JSON.stringify(config));
};
/** A PATH holding only the named programs, each answering --version. */
const tools = (...names: string[]) => {
  for (const name of names) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} 9.9.9"\n`, { mode: 0o755 });
  return { PATH: bin, JAMCLI_CREDENTIAL_STORE: 'file' };
};
const find = (checks: Check[], name: string) => checks.filter((check) => check.name === name);

test('a working local setup passes, naming what it found', async () => {
  configure({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model', sandbox: { enabled: false } });
  const checks = await runChecks({ projectRoot: root, env: tools('rg', 'git', 'gh', 'gopls') });
  expect(find(checks, 'model (session model)')).toEqual([{ name: 'model (session model)', status: 'ok', detail: 'ollama:fake-model answers, a 32,768-token window' }]);
  expect(find(checks, 'ripgrep')[0]).toMatchObject({ status: 'ok', detail: 'rg 9.9.9' });
  expect(find(checks, 'gh')[0]).toMatchObject({ status: 'ok' });
  expect(find(checks, 'language servers')[0].detail).toBe('JamCLI does not use language servers yet; found gopls');
  expect(find(checks, 'telemetry')[0]).toMatchObject({ status: 'ok', detail: 'off; nothing is sent anywhere' });
  expect(checks.filter((check) => check.status === 'fail')).toEqual([]);
});

test('each problem is named with a fix', async () => {
  configure({
    api_registry: { ollama: { endpoint: server.ollamaBaseUrl }, anthropic: { api_key: 'sk-ant-in-a-file-0000' } },
    model: 'ollama:missing-model',
    categories: { quick: [{ model: 'openrouter:some-model' }] },
    trust: { enabled: false },
    agent_loop: { max_steps: 0 },
    sandbox: { enabled: false },
    otel: { enabled: true, endpoint: 'http://127.0.0.1:9/v1/traces' },
  });
  const checks = await runChecks({ projectRoot: root, env: tools(), timeoutMs: 2_000 });
  // Rendered first: the matchers below leave their marks on what they match.
  const text = renderChecks(checks, root);
  expect(find(checks, 'model (session model)')[0]).toEqual({ name: 'model (session model)', status: 'fail', detail: 'Ollama does not have missing-model.', fix: 'ollama pull missing-model' });
  expect(find(checks, 'model (category quick)')[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('Provider "openrouter" is not configured.') });
  expect(find(checks, 'configuration')[1]).toMatchObject({ status: 'warn', detail: '.jamcli/config.json agent_loop.max_steps should be a whole number above zero, so it is ignored.' });
  expect(find(checks, 'keys')[0]).toMatchObject({
    status: 'warn',
    detail: '.jamcli/config.json holds a key at api_registry.anthropic.api_key.',
    fix: 'Store it with jamcli auth set anthropic, then remove it with jamcli config unset api_registry.anthropic.api_key --scope project.',
  });
  expect(find(checks, 'ripgrep')[0]).toMatchObject({ status: 'warn', fix: 'Install ripgrep (rg).' });
  expect(find(checks, 'git')[0]).toMatchObject({ status: 'warn' });
  expect(find(checks, 'sandbox')[0]).toMatchObject({ status: 'warn', detail: expect.stringContaining('sandbox.enabled') });
  expect(find(checks, 'telemetry')[0]).toMatchObject({ status: 'fail', fix: 'Start the collector, or set otel.endpoint.' });
  expect(find(checks, 'project directory')[0]).toMatchObject({ status: 'warn', detail: '.jamcli/ has no .gitignore, so its history could be committed.' });
  // The key itself is never shown.
  expect(JSON.stringify(checks)).not.toContain('sk-ant-in-a-file');

  expect(text).toMatch(/\nfail  model \(session model\) +Ollama does not have missing-model\.\n +fix: ollama pull missing-model\n/);
  expect(text.trim().split('\n').at(-1)).toMatch(/^\d+ problems, \d+ warnings\.$/);
});

test('an Ollama that is not running, a refused key, and a store others can read are failures', async () => {
  const refusing = http.createServer((_request, response) => response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"message":"invalid x-api-key"}}'));
  await new Promise<void>((resolve) => refusing.listen(0, '127.0.0.1', resolve));
  try {
    const port = (refusing.address() as AddressInfo).port;
    configure({
      api_registry: { ollama: { endpoint: 'http://127.0.0.1:9' }, anthropic: { base_url: `http://127.0.0.1:${port}`, key_env_var: 'DOCTOR_KEY' } },
      model: 'ollama:fake-model',
      categories: { deep: [{ model: 'anthropic:claude-x' }] },
      trust: { enabled: false },
    });
    process.env.DOCTOR_KEY = 'sk-ant-refused-0000';
    const store = path.join(process.env.JAMCLI_CONFIG_DIR!, 'credentials.json');
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, '{"version":1,"keys":{}}', { mode: 0o644 });
    const checks = await runChecks({ projectRoot: root, env: tools(), timeoutMs: 2_000 });
    expect(find(checks, 'model (session model)')[0]).toMatchObject({ status: 'fail', detail: expect.stringMatching(/^Ollama is not answering at http:\/\/127\.0\.0\.1:9: /), fix: 'Start it with ollama serve, or set api_registry.ollama.endpoint.' });
    expect(find(checks, 'model (category deep)')[0]).toMatchObject({ status: 'fail', detail: 'anthropic:claude-x: the provider refused the key (401).', fix: 'Store a working key with jamcli auth set anthropic.' });
    expect(find(checks, 'key store')[0]).toMatchObject({ status: 'fail', fix: `chmod 600 ${store}` });
  } finally {
    delete process.env.DOCTOR_KEY;
    refusing.close();
  }
  expect(parseArgs(['doctor', '--json']).doctor).toEqual(['--json']);
});

test('a collector that answers is checked by its answer', async () => {
  let status = 503;
  const collector = http.createServer((_request, response) => response.writeHead(status).end());
  await new Promise<void>((resolve) => collector.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(collector.address() as AddressInfo).port}/v1/traces`;
    configure({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model', otel: { enabled: true, endpoint: url } });
    const refused = find(await runChecks({ projectRoot: root, env: tools(), skipMcp: true }), 'telemetry')[0];
    expect(refused.status).toBe('fail');
    expect(refused.detail).toEndWith('the collector answered 503');
    status = 200;
    expect(find(await runChecks({ projectRoot: root, env: tools(), skipMcp: true }), 'telemetry')[0]).toEqual({ name: 'telemetry', status: 'ok', detail: `traces go to ${url}` });
  } finally {
    collector.close();
  }
});

test('each enabled MCP server is started and asked for its tools', async () => {
  configure({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model' });
  configure(
    {
      servers: [
        { id: 'envcheck', command: process.execPath, args: [path.join(import.meta.dir, '../../testing/envMcpServer.ts')] },
        { id: 'broken', command: path.join(bin, 'no-such-server') },
        { id: 'off', command: 'whatever', enabled: false },
      ],
    },
    'mcp.json'
  );
  const checks = await runChecks({ projectRoot: root, env: { ...process.env, JAMCLI_CREDENTIAL_STORE: 'file' } });
  expect(find(checks, 'MCP envcheck')[0].status).toBe('ok');
  expect(find(checks, 'MCP broken')[0]).toMatchObject({ status: 'fail', fix: 'Check the entry in .jamcli/mcp.json, then run jamcli mcp test broken.' });
  expect(find(checks, 'MCP off')).toEqual([]);
});
