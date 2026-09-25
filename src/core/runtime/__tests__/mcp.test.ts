import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent, ToolResult } from '../../types.js';

const FIXTURE = path.join(import.meta.dir, '../../../testing/modernMcpServer.ts');

let server: FakeProviderServer;
let root: string;
let saved: Record<string, string | undefined>;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-mcp-')));
  saved = { JAMCLI_STATE_DIR: process.env.JAMCLI_STATE_DIR, JAMCLI_CONFIG_DIR: process.env.JAMCLI_CONFIG_DIR };
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  process.env.JAMCLI_CONFIG_DIR = path.join(root, '.user');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, '.jamcli', 'mcp.json'), JSON.stringify({ servers: [{ id: 'modern', command: 'bun', args: [FIXTURE], enabled: true }] }));
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const start = (options: Partial<RuntimeOptions>) => createRuntime({ projectRoot: root, surface: 'headless', allowTools: ['modern__deploy'], ...options });
const deploy = { id: 'd1', name: 'modern__deploy', arguments: {} };

test('in the interface, a server\'s request for input reaches the person, and their answer reaches the server', async () => {
  const runtime = await start({ surface: 'tui' });
  try {
    expect(runtime.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['modern__echo', 'modern__peek', 'modern__deploy']));
    server.enqueue({ toolCalls: [deploy] }, { text: 'done' });
    const asked: Extract<AgentEvent, { type: 'elicitation_request' }>[] = [];
    const results: ToolResult[] = [];
    await runtime.run('deploy it', (event) => {
      if (event.type === 'elicitation_request') {
        asked.push(event);
        event.respond({ action: 'accept', content: { env: 'production' } });
      }
      if (event.type === 'tool_result') results.push(event.result);
    });
    expect(asked).toHaveLength(1);
    expect(asked[0].request).toMatchObject({ mode: 'form', server: 'modern', message: 'Deploy where?' });
    expect(results[0].output).toBe('deployed to production');
  } finally {
    await runtime.close();
  }
}, 30_000);

test('stopping the turn answers a waiting request "cancel", so the call ends', async () => {
  const runtime = await start({ surface: 'tui' });
  try {
    // No reply after the call: a stopped turn asks for none.
    server.enqueue({ toolCalls: [deploy] });
    const results: ToolResult[] = [];
    const turn = runtime.run('deploy it', (event) => {
      if (event.type === 'elicitation_request') setTimeout(() => runtime.cancel(), 10);
      if (event.type === 'tool_result') results.push(event.result);
    });
    const outcome = await Promise.race([turn, Bun.sleep(10_000).then(() => 'hung' as const)]);
    expect(outcome).not.toBe('hung');
    expect(results[0]?.output ?? '').not.toContain('deployed to');
  } finally {
    await runtime.close();
  }
}, 30_000);

test('elsewhere, the request is declined and the person is told', async () => {
  const runtime = await start({ surface: 'headless' });
  try {
    server.enqueue({ toolCalls: [deploy] }, { text: 'done' });
    const notices: string[] = [];
    const results: ToolResult[] = [];
    await runtime.run('deploy it', (event) => {
      if (event.type === 'notice') notices.push(event.message);
      if (event.type === 'tool_result') results.push(event.result);
    });
    expect(results[0].output).toBe('not deployed: decline');
    expect(notices).toContain('MCP server modern asked for input ("Deploy where?"), which this surface cannot give, so it was declined.');
  } finally {
    await runtime.close();
  }
}, 30_000);

test('a server\'s error reaches the model as a failed call', async () => {
  const runtime = await start({ allowTools: ['modern__fail'] });
  try {
    server.enqueue({ toolCalls: [{ id: 'f1', name: 'modern__fail', arguments: {} }] }, { text: 'noted' });
    const results: ToolResult[] = [];
    await runtime.run('try it', (event) => event.type === 'tool_result' && results.push(event.result));
    expect(results[0]).toMatchObject({ status: 'error', output: 'The server reported an error: boom' });
  } finally {
    await runtime.close();
  }
}, 30_000);

test('a signed-in HTTP server is reached with its stored tokens; without them the session says how to sign in', async () => {
  const { startFakeOAuthMcp } = await import('../../../testing/fakeOAuthMcp.js');
  const { mcpLogin } = await import('../../mcp/oauth.js');
  const { fileStore } = await import('../../config/credentials.js');
  const fake = startFakeOAuthMcp();
  try {
    fs.writeFileSync(path.join(root, '.jamcli', 'mcp.json'), JSON.stringify({ servers: [{ id: 'remote', command: '', transport: 'http', url: fake.url, enabled: true }] }));
    const env = { ...process.env, JAMCLI_CREDENTIAL_STORE: 'file' };
    const before = await start({ env });
    expect(before.notices.join('\n')).toContain('MCP server remote is unavailable: MCP server remote needs you to sign in. Run jamcli mcp login remote.');
    await before.close();

    const browser = async (url: URL) => {
      const answer = await fetch(url, { redirect: 'manual' });
      await fetch(answer.headers.get('location')!);
    };
    await mcpLogin({ id: 'remote', command: '', transport: 'http', url: fake.url }, { store: fileStore(), open: browser });
    const after = await start({ env });
    try {
      expect(after.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['remote__echo', 'remote__deploy']));
      expect(fake.seen.bearer.length).toBeGreaterThan(0);
    } finally {
      await after.close();
    }
  } finally {
    fake.stop();
  }
}, 30_000);
