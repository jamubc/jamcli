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

test('a server\'s prompts and resources are listed, a prompt is rendered, and @server:uri puts a resource in the prompt', async () => {
  const runtime = await start({});
  try {
    expect(await runtime.mcpPrompts()).toEqual([expect.objectContaining({ serverId: 'modern', name: 'review', arguments: [expect.objectContaining({ name: 'file', required: true }), expect.objectContaining({ name: 'focus' })] })]);
    expect(await runtime.mcpPrompt('modern', 'review', { file: 'a.ts' })).toContain('Review a.ts');
    expect(await runtime.mcpResources()).toEqual(expect.arrayContaining([expect.objectContaining({ serverId: 'modern', uri: 'docs://readme' })]));

    server.enqueue({ text: 'read it' });
    const notices: string[] = [];
    await runtime.run('summarize @modern:docs://readme and @nobody:x://y', (event) => event.type === 'notice' && notices.push(event.message));
    const sent = JSON.stringify(server.completions().at(-1)!.body.messages);
    expect(sent).toContain('Resource docs://readme from MCP server modern');
    expect(sent).toContain('README: build with bun.');
    // A name that is not a server stays a path, and says it could not be read.
    expect(notices.some((notice) => notice.includes('@nobody:x://y'))).toBe(true);
  } finally {
    await runtime.close();
  }
}, 30_000);

test('an unknown server name reads as a path, with the path resolver\'s exact notice', async () => {
  const runtime = await start({});
  try {
    server.enqueue({ text: 'noted' });
    const notices: string[] = [];
    await runtime.run('open @nobody:x://y', (event) => event.type === 'notice' && notices.push(event.message));
    // The exact reason the path resolver gives, which a resource read would replace.
    const reason = await fs.promises.stat(path.join(root, 'nobody:x://y')).then(
      () => 'unexpectedly found',
      (error: Error) => error.message
    );
    expect(notices.filter((notice) => notice.includes('@nobody:x://y'))).toEqual([`Could not include @nobody:x://y: ${reason}`]);
  } finally {
    await runtime.close();
  }
}, 30_000);

test('a valid resource leaves no notice at all', async () => {
  const runtime = await start({});
  try {
    server.enqueue({ text: 'noted' });
    const notices: string[] = [];
    await runtime.run('summarize @modern:docs://readme', (event) => event.type === 'notice' && notices.push(event.message));
    expect(notices).toEqual([]);
    expect(JSON.stringify(server.completions().at(-1)!.body.messages)).toContain('Resource docs://readme from MCP server modern');
  } finally {
    await runtime.close();
  }
}, 30_000);

test('resource text is redacted like file content', async () => {
  const secret = 'probe-secret-value-1234';
  const savedSecret = process.env.JAMCLI_PROBE_SECRET;
  process.env.JAMCLI_PROBE_SECRET = secret;
  fs.writeFileSync(
    path.join(root, '.jamcli', 'mcp.json'),
    JSON.stringify({ servers: [{ id: 'modern', command: 'bun', args: [FIXTURE], enabled: true, env: { JAMCLI_PROBE_SECRET: secret } }] })
  );
  const runtime = await start({ env: { ...process.env, JAMCLI_PROBE_SECRET: secret } });
  try {
    server.enqueue({ text: 'noted' });
    await runtime.run('read @modern:probe://secret', () => {});
    const sent = JSON.stringify(server.completions().at(-1)!.body.messages);
    expect(sent).toContain('[redacted:JAMCLI_PROBE_SECRET]');
    expect(sent).not.toContain(secret);
  } finally {
    await runtime.close();
    if (savedSecret === undefined) delete process.env.JAMCLI_PROBE_SECRET;
    else process.env.JAMCLI_PROBE_SECRET = savedSecret;
  }
}, 30_000);

test('the same resource referenced twice is included once', async () => {
  const runtime = await start({});
  try {
    server.enqueue({ text: 'noted' });
    await runtime.run('read @modern:docs://readme and @modern:docs://readme', () => {});
    const sent = JSON.stringify(server.completions().at(-1)!.body.messages);
    expect(sent.split('README: build with bun.').length - 1).toBe(1);
  } finally {
    await runtime.close();
  }
}, 30_000);

test('a resource that fails to read becomes a notice, not a thrown error', async () => {
  const runtime = await start({});
  try {
    server.enqueue({ text: 'noted' });
    const notices: string[] = [];
    await runtime.run('read @modern:probe://broken', (event) => event.type === 'notice' && notices.push(event.message));
    const relevant = notices.filter((notice) => notice.includes('@modern:probe://broken'));
    expect(relevant).toHaveLength(1);
    expect(relevant[0]).toContain('Could not include @modern:probe://broken');
  } finally {
    await runtime.close();
  }
}, 30_000);

test('a resource with text and binary parts returns both, the binary part by description', async () => {
  const runtime = await start({});
  try {
    server.enqueue({ text: 'noted' });
    await runtime.run('read @modern:probe://mixed', () => {});
    const sent = JSON.stringify(server.completions().at(-1)!.body.messages);
    expect(sent).toContain('first part');
    expect(sent).toContain('image/png content of 12 bytes of base64');
  } finally {
    await runtime.close();
  }
}, 30_000);

test('a server that will not start does not hide another server\'s prompts and resources', async () => {
  fs.writeFileSync(
    path.join(root, '.jamcli', 'mcp.json'),
    JSON.stringify({
      servers: [
        { id: 'modern', command: 'bun', args: [FIXTURE], enabled: true },
        { id: 'broken', command: 'bun', args: ['--version'], enabled: true },
      ],
    })
  );
  const runtime = await start({});
  try {
    expect((await runtime.mcpPrompts()).map((entry) => `${entry.serverId}:${entry.name}`)).toContain('modern:review');
    expect((await runtime.mcpResources()).map((entry) => `${entry.serverId}:${entry.uri}`)).toContain('modern:docs://readme');
  } finally {
    await runtime.close();
  }
}, 30_000);

test('past the threshold, MCP tools are found with search_tools and offered from the next step', async () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, '.jamcli', 'config.json'), 'utf8'));
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ ...config, tool_search: { threshold: 2 } }));
  const runtime = await start({ allowTools: ['modern__echo'] });
  try {
    server.enqueue(
      { toolCalls: [{ id: 's1', name: 'search_tools', arguments: { query: 'echo' } }] },
      { toolCalls: [{ id: 'e1', name: 'modern__echo', arguments: { text: 'hi' } }] },
      { text: 'done' }
    );
    const results: ToolResult[] = [];
    await runtime.run('say hi', (event) => event.type === 'tool_result' && results.push(event.result));
    const names = (body: any) => (body.tools ?? []).map((tool: any) => tool.function.name);
    const [first, second] = server.completions().slice(-3);
    expect(names(first.body)).toContain('search_tools');
    expect(names(first.body).filter((name: string) => name.startsWith('modern__'))).toEqual([]);
    expect(names(second.body)).toContain('modern__echo');
    expect(names(second.body)).not.toContain('modern__deploy');
    expect(results.map((result) => result.output)).toEqual([expect.stringContaining('- modern__echo (MCP server modern)'), 'echo:hi']);
  } finally {
    await runtime.close();
  }
}, 30_000);
