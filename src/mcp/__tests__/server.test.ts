import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { connectMcp, type ElicitationAnswer, type ElicitationRequest, type McpConnection } from '../../core/mcp/connect.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';

const ENTRY = path.join(import.meta.dir, '..', '..', 'index.tsx');

let provider: FakeProviderServer;
let base: string;
let project: string;
let connection: McpConnection | undefined;
beforeAll(() => {
  provider = startFakeProvider();
});
afterAll(() => provider.close());
beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-mcp-serve-')));
  project = path.join(base, 'project');
  fs.mkdirSync(path.join(base, 'user'), { recursive: true });
  fs.mkdirSync(project);
  fs.writeFileSync(
    path.join(base, 'user', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: provider.ollamaBaseUrl } }, model: 'ollama:fake-model', sandbox: { enabled: false }, trust: { enabled: false } })
  );
  fs.writeFileSync(path.join(project, 'a.txt'), 'old\n');
});
afterEach(async () => {
  await connection?.client.close();
  connection = undefined;
  fs.rmSync(base, { recursive: true, force: true });
});

/** `jamcli mcp serve` in a child process, reached as an agent host reaches it. */
const serve = async (elicit?: (request: ElicitationRequest) => Promise<ElicitationAnswer>) => {
  connection = await connectMcp(
    { id: 'jamcli', command: process.execPath, args: ['--no-env-file', '--config=/dev/null', ENTRY, 'mcp', 'serve'] },
    {
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        JAMCLI_CONFIG_DIR: path.join(base, 'user'),
        JAMCLI_STATE_DIR: path.join(base, 'state'),
        JAMCLI_CACHE_DIR: path.join(base, 'cache'),
        JAMCLI_CREDENTIAL_STORE: 'file',
        JAMCLI_MODELS_DIRECTORY: 'off',
      },
      ...(elicit ? { elicit } : {}),
    }
  );
  const call = async (name: string, args: Record<string, unknown>) => {
    const result: any = await connection!.client.callTool({ name, arguments: args });
    return { text: result.content.map((part: any) => part.text).join(''), report: result.structuredContent, error: Boolean(result.isError) };
  };
  const start = async () => (await call('session_start', { cwd: project })).report.session as string;
  return { call, start };
};

test('a host delegates an edit: the session waits on its approval, the host answers, and the turn finishes', async () => {
  const { call, start } = await serve();
  const session = await start();
  provider.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'Changed it.' });
  const asked = await call('session_send', { session, text: 'change a.txt' });
  expect(asked.report).toMatchObject({ status: 'waiting', waiting: { kind: 'approval', tool: 'edit', personOnly: false } });
  expect(asked.text).toContain('Answer with session_answer');
  const done = await call('session_answer', { session, approval: 'allow_once' });
  expect(done.report).toMatchObject({ status: 'idle', ended: 'ok' });
  expect(done.text).toContain('+new');
  expect(done.text).toContain('Changed it.');
  expect(fs.readFileSync(path.join(project, 'a.txt'), 'utf8')).toBe('new\n');
}, 60_000);

test('a command runs as a person would run it, and its list is answered by the host', async () => {
  const { call, start } = await serve();
  const session = await start();
  const before = provider.completions().length;
  const context = await call('session_send', { session, text: '/context' });
  expect(context.report.status).toBe('idle');
  expect(context.text).toContain('Context:');
  expect(provider.completions().length).toBe(before);
  const offered = await call('session_send', { session, text: '/effort' });
  expect(offered.report).toMatchObject({ status: 'waiting', waiting: { kind: 'choice', personOnly: false } });
  const chosen = await call('session_answer', { session, choice: 'low' });
  expect(chosen.report.status).toBe('idle');
  expect(chosen.text).toContain('Later turns');
  expect(JSON.parse(fs.readFileSync(path.join(base, 'user', 'config.json'), 'utf8')).effort).toBe('low');
}, 60_000);

/** A project where a commit can be made, and a model that makes one. */
const commitReady = () => {
  const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: project });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('add', 'a.txt');
  provider.enqueue({ toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { message: 'feat: add a' } }] }, { text: 'Over to you.' });
  return () => new TextDecoder().decode(git('log', '--format=%s').stdout).trim();
};

test("a commit is the person's: the host cannot answer it, and the person is asked in their own host", async () => {
  const asked: ElicitationRequest[] = [];
  const { call, start } = await serve(async (request) => {
    asked.push(request);
    return { action: 'accept', content: { answer: 'allow' } };
  });
  const session = await start();
  const log = commitReady();
  const done = await call('session_send', { session, text: 'commit it' });
  expect(asked).toHaveLength(1);
  expect(asked[0].message).toContain('asks you, not the agent driving it');
  expect(done.report).toMatchObject({ status: 'idle', ended: 'ok' });
  expect(log()).toBe('feat: add a');
}, 60_000);

test("the person's no, or a host that cannot ask, is a denial the agent cannot overrule", async () => {
  const { call, start } = await serve(async () => ({ action: 'decline' }));
  const session = await start();
  const log = commitReady();
  const done = await call('session_send', { session, text: 'commit it' });
  expect(done.report.status).toBe('idle');
  expect(log()).toBe('');

  await connection!.client.close();
  const nobody = await serve();
  const second = await nobody.start();
  commitReady();
  const denied = await nobody.call('session_send', { session: second, text: 'commit it' });
  expect(denied.report.status).toBe('idle');
  expect(log()).toBe('');
}, 90_000);

test("the host is refused an answer that is the person's, and a session it does not have", async () => {
  const asked: ElicitationRequest[] = [];
  const { call, start } = await serve(async (request) => {
    asked.push(request);
    return { action: 'decline' };
  });
  const session = await start();
  const log = commitReady();
  // The call returns at once, so the commit's approval arrives with no call waiting on it.
  expect((await call('session_send', { session, text: 'commit it', wait_ms: 0 })).report.status).toBe('running');
  await Bun.sleep(1_500);
  const refused = await call('session_answer', { session, approval: 'allow_once' });
  expect(refused).toMatchObject({ error: true, text: expect.stringContaining('Only the person answers this') });
  // The next call that waits puts it to the person, whose no stands.
  const after = await call('session_state', { session, wait_ms: 30_000 });
  expect(asked).toHaveLength(1);
  expect(after.report.status).toBe('idle');
  expect(log()).toBe('');

  expect(await call('session_answer', { session: 'nope', approval: 'allow_once' })).toMatchObject({ error: true, text: expect.stringContaining('No session nope') });
  expect((await call('session_start', { cwd: 'relative/dir' })).error).toBe(true);
}, 60_000);
