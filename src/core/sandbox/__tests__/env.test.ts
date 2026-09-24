import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { subprocessEnv } from '../env.js';
import { McpManager } from '../../../services/McpManager.js';
import { createRuntime } from '../../runtime/index.js';
import { unsandboxed } from '../detect.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { McpServerConfig } from '../../../types/mcp.js';

const parent = {
  PATH: '/usr/bin',
  HOME: '/home/me',
  LANG: 'C.UTF-8',
  LC_ALL: 'C',
  JAVA_HOME: '/opt/java',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  OPENROUTER_API_KEY: 'sk-or-secret',
  GITHUB_TOKEN: 'ghp_secret',
  DB_PASSWORD: 'hunter2',
  AWS_ACCESS_KEY_ID: 'AKIA0000',
  MY_ROUTER: 'custom-key-var-secret',
  NPM_PAT: 'npm-secret',
};

test('the default passes the environment without anything that looks like a credential', () => {
  const env = subprocessEnv(parent, { withheld: ['MY_ROUTER'] });
  expect(Object.keys(env).sort()).toEqual(['HOME', 'JAVA_HOME', 'LANG', 'LC_ALL', 'PATH', 'SSH_AUTH_SOCK']);
});

test('the minimal policy passes only what a shell needs', () => {
  expect(Object.keys(subprocessEnv(parent, { policy: 'minimal' })).sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'PATH']);
});

test('a named variable passes, and declared values are added last', () => {
  const env = subprocessEnv(parent, { passthrough: ['GITHUB_TOKEN'], withheld: ['GITHUB_TOKEN'], extra: { MODE: 'test', PATH: '/custom' } });
  expect(env.GITHUB_TOKEN).toBe('ghp_secret');
  expect(env.MODE).toBe('test');
  expect(env.PATH).toBe('/custom');
  expect(env.OPENROUTER_API_KEY).toBeUndefined();
});

const fixture = path.join(import.meta.dir, '../../../testing/envMcpServer.ts');
const namesFrom = async (server: McpServerConfig) => {
  const manager = new McpManager({ configService: { listMcpServers: async () => [server] } as any });
  try {
    const [tool] = await manager.listServerTools(server);
    return JSON.parse((await manager.callServerTool(tool, {})).output) as string[];
  } finally {
    await manager.close();
  }
};

test('an MCP server does not receive a provider key unless its entry names it (F23)', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-in-the-parent';
  try {
    const base: McpServerConfig = { id: 'envcheck', command: process.execPath, args: [fixture] };
    const plain = await namesFrom(base);
    expect(plain).toContain('PATH');
    expect(plain).not.toContain('OPENROUTER_API_KEY');
    expect(await namesFrom({ ...base, env_passthrough: ['OPENROUTER_API_KEY'] })).toContain('OPENROUTER_API_KEY');
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

let server: FakeProviderServer;
let root: string;
beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-env-'));
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl }, openrouter: { key_env_var: 'MY_ROUTER' } }, sandbox: { env_passthrough: ['NPM_PAT'] } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('a command does not receive a provider key, even under a custom name (F11)', async () => {
  const runtime = await createRuntime({ projectRoot: root, surface: 'headless', mcp: false, allowTools: ['run_command'], env: { ...process.env, ...parent }, sandbox: unsandboxed('not needed here') });
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'env' } }] }, { text: 'ok' });
  await runtime.run('show the environment');
  const output: string = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool').content;
  const names = output.split('\n').map((line) => line.split('=')[0]);
  for (const hidden of ['OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'MY_ROUTER', 'DB_PASSWORD']) expect(names).not.toContain(hidden);
  expect(names).toContain('JAVA_HOME');
  expect(names).toContain('NPM_PAT');
});
