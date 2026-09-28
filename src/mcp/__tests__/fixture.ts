import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { connectMcp, type ElicitationAnswer, type ElicitationRequest, type McpConnection } from '../../core/mcp/connect.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';

const ENTRY = path.join(import.meta.dir, '..', '..', 'index.tsx');

/**
 * `jamcli mcp serve` in a child process, reached as an agent host reaches it, on a fake
 * provider, with a project and a user configuration of its own for each test.
 */
export function serverFixture() {
  const context = { provider: undefined as unknown as FakeProviderServer, base: '', project: '', connection: undefined as McpConnection | undefined };
  beforeAll(() => {
    context.provider = startFakeProvider();
  });
  afterAll(() => context.provider.close());
  beforeEach(() => {
    // Short, since a terminal's observer socket lives under it and socket paths are short.
    context.base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jms-')));
    context.project = path.join(context.base, 'project');
    fs.mkdirSync(path.join(context.base, 'user'), { recursive: true });
    fs.mkdirSync(context.project);
    fs.writeFileSync(
      path.join(context.base, 'user', 'config.json'),
      JSON.stringify({ api_registry: { ollama: { endpoint: context.provider.ollamaBaseUrl } }, model: 'ollama:fake-model', sandbox: { enabled: false }, trust: { enabled: false } })
    );
    fs.writeFileSync(path.join(context.project, 'a.txt'), 'old\n');
  });
  afterEach(async () => {
    await context.connection?.client.close();
    context.connection = undefined;
    fs.rmSync(context.base, { recursive: true, force: true });
  });

  const serve = async (elicit?: (request: ElicitationRequest) => Promise<ElicitationAnswer>) => {
    const connection = await connectMcp(
      { id: 'jamcli', command: process.execPath, args: ['--no-env-file', '--config=/dev/null', ENTRY, 'mcp', 'serve'] },
      {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: process.env.HOME ?? '/tmp',
          JAMCLI_CONFIG_DIR: path.join(context.base, 'user'),
          JAMCLI_STATE_DIR: path.join(context.base, 's'),
          JAMCLI_CACHE_DIR: path.join(context.base, 'cache'),
          JAMCLI_CREDENTIAL_STORE: 'file',
          JAMCLI_MODELS_DIRECTORY: 'off',
        },
        ...(elicit ? { elicit } : {}),
      }
    );
    context.connection = connection;
    const call = async (name: string, args: Record<string, unknown>) => {
      const result: any = await connection.client.callTool({ name, arguments: args });
      return { text: result.content.map((part: any) => part.text).join(''), report: result.structuredContent, error: Boolean(result.isError) };
    };
    const start = async () => (await call('session_start', { cwd: context.project })).report.session as string;
    return { call, start };
  };

  /** A project where a commit can be made, and a model that makes one; returns the log's subjects. */
  const commitReady = () => {
    const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: context.project });
    git('init', '-q');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    git('add', 'a.txt');
    context.provider.enqueue({ toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { message: 'feat: add a' } }] }, { text: 'Over to you.' });
    return () => new TextDecoder().decode(git('log', '--format=%s').stdout).trim();
  };

  return { context, serve, commitReady };
}
