import { test, expect } from 'bun:test';
import fs from 'fs';
import { ensureDir, readJson, remove, writeJson } from '../../utils/fsx.js';
import os from 'node:os';
import path from 'node:path';
import { runMcpCommand, type McpCommandIo } from '../mcp.js';

const silentIo: McpCommandIo = { out: () => undefined, err: () => undefined };

const makeProject = async (): Promise<string> => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-mcp-'));
  await ensureDir(path.join(root, '.jamcli'));
  return root;
};

const seedConfig = async (root: string): Promise<string> => {
  const mcpPath = path.join(root, '.jamcli', 'mcp.json');
  await writeJson(
    mcpPath,
    {
      context_window_limit: 4096,
      ignore_patterns: ['node_modules/**', 'dist/**'],
      tools: { run_command: { allowed: false, require_approval: true } },
      servers: [],
      custom_extension: { keep: true },
    },
    { spaces: 2 }
  );
  return mcpPath;
};

test('mcp add writes a stdio server and preserves unrelated configuration keys', async () => {
  const root = await makeProject();
  const mcpPath = await seedConfig(root);

  const code = await runMcpCommand(
    {
      action: 'add',
      args: ['files', '--command', 'npx', '--arg', '-y', '--arg', '@modelcontextprotocol/server-filesystem', '--env', 'TOKEN=secret'],
    },
    root,
    silentIo
  );
  expect(code).toBe(0);

  const written = await readJson(mcpPath);
  expect(written.context_window_limit).toBe(4096);
  expect(written.ignore_patterns).toEqual(['node_modules/**', 'dist/**']);
  expect(written.tools.run_command).toEqual({ allowed: false, require_approval: true });
  expect(written.custom_extension).toEqual({ keep: true });
  expect(written.servers).toHaveLength(1);
  expect(written.servers[0]).toMatchObject({
    id: 'files',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: { TOKEN: 'secret' },
    transport: 'stdio',
  });
});

test('mcp add stores an http server with url and headers', async () => {
  const root = await makeProject();
  const mcpPath = await seedConfig(root);

  const code = await runMcpCommand(
    { action: 'add', args: ['remote', '--url', 'https://example.test/mcp', '--header', 'Authorization=Bearer abc'] },
    root,
    silentIo
  );
  expect(code).toBe(0);

  const written = await readJson(mcpPath);
  expect(written.custom_extension).toEqual({ keep: true });
  expect(written.servers[0]).toMatchObject({
    id: 'remote',
    transport: 'http',
    url: 'https://example.test/mcp',
    headers: { Authorization: 'Bearer abc' },
  });
});

test('mcp remove deletes only the named server and keeps every other key', async () => {
  const root = await makeProject();
  const mcpPath = await seedConfig(root);
  await runMcpCommand({ action: 'add', args: ['keepme', '--command', 'node'] }, root, silentIo);
  await runMcpCommand({ action: 'add', args: ['dropme', '--command', 'node'] }, root, silentIo);

  const code = await runMcpCommand({ action: 'remove', args: ['dropme'] }, root, silentIo);
  expect(code).toBe(0);

  const written = await readJson(mcpPath);
  expect(written.context_window_limit).toBe(4096);
  expect(written.ignore_patterns).toEqual(['node_modules/**', 'dist/**']);
  expect(written.tools.run_command).toEqual({ allowed: false, require_approval: true });
  expect(written.custom_extension).toEqual({ keep: true });
  expect(written.servers.map((server: { id: string }) => server.id)).toEqual(['keepme']);
});

test('mcp add with neither command nor url fails and writes nothing', async () => {
  const root = await makeProject();
  const mcpPath = await seedConfig(root);
  const before = await fs.promises.readFile(mcpPath, 'utf8');

  const code = await runMcpCommand({ action: 'add', args: ['broken'] }, root, silentIo);
  expect(code).toBe(2);
  expect(await fs.promises.readFile(mcpPath, 'utf8')).toBe(before);
});

test('mcp add in a project without .jamcli creates it ignoring itself', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-mcp-'));
  try {
    expect(await runMcpCommand({ action: 'add', args: ['files', '--command', 'npx'] }, root, silentIo)).toBe(0);
    expect((await readJson(path.join(root, '.jamcli', 'mcp.json'))).servers.map((server: { id: string }) => server.id)).toEqual(['files']);
    expect(await fs.promises.readFile(path.join(root, '.jamcli', '.gitignore'), 'utf8')).toContain('\n*\n');
  } finally {
    await remove(root);
  }
});

test('mcp login signs in to an HTTP server through the browser, keeps the tokens in the store, and logout forgets them', async () => {
  const { startFakeOAuthMcp } = await import('../../testing/fakeOAuthMcp.js');
  const fake = startFakeOAuthMcp();
  const root = await makeProject();
  const entries = new Map<string, string>();
  const store = { kind: 'file' as const, where: 'the test store', get: (key: string) => entries.get(key), set: (key: string, value: string) => void entries.set(key, value), remove: (key: string) => entries.delete(key) };
  const out: string[] = [];
  const io: McpCommandIo = { out: (line) => out.push(line), err: (line) => out.push(`err: ${line}`) };
  try {
    await runMcpCommand({ action: 'add', args: ['remote', '--url', fake.url] }, root, silentIo);
    const browser = async (url: URL) => {
      const answer = await fetch(url, { redirect: 'manual' });
      await fetch(answer.headers.get('location')!);
    };
    expect(await runMcpCommand({ action: 'login', args: ['remote'] }, root, io, { store, openBrowser: browser })).toBe(0);
    expect(out[0]).toStartWith('Opening your browser to sign in to remote. If it does not open, visit:\nhttp://127.0.0.1:');
    expect(out[1]).toBe('Signed in to remote; 4 tools. The tokens are kept in the test store.');
    expect([...entries.keys()].sort()).toEqual(['mcp-oauth:remote:client', 'mcp-oauth:remote:tokens']);
    // Nothing of the sign-in is written to the project.
    expect(fs.readFileSync(path.join(root, '.jamcli', 'mcp.json'), 'utf8')).not.toContain('access_token');
    expect(await runMcpCommand({ action: 'logout', args: ['remote'] }, root, io, { store })).toBe(0);
    expect(out.at(-1)).toBe('Signed out of remote; its tokens are gone from the test store.');
    expect(entries.size).toBe(0);
    expect(await runMcpCommand({ action: 'login', args: ['nope'] }, root, io, { store })).toBe(1);
  } finally {
    fake.stop();
    await remove(root);
  }
}, 20_000);
