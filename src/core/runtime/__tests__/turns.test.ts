import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent } from '../../types.js';

const ENTRY = path.join(import.meta.dir, '../../../index.tsx');

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-turns-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});
afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const edit = { id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } };
const offered = (body: any) => (body.tools ?? []).map((tool: any) => tool.function.name).sort();

test('a turn narrowed to some tools is offered only those and refused the rest, then the session has them all again', async () => {
  const runtime = await start({ allowTools: ['edit'] });
  server.enqueue({ toolCalls: [edit, { id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } }] }, { text: 'narrowed' }, { text: 'wide' });
  const events: AgentEvent[] = [];
  await runtime.run('review', (event) => events.push(event), { allowedTools: ['read_file', 'grep'], label: '/review' });

  const [first] = server.completions().slice(-2);
  expect(offered(first.body)).toEqual(['grep', 'read_file']);
  // The edit was allowed by the run's flag, and the narrowing still refused it.
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  const results = events.flatMap((event) => (event.type === 'tool_result' ? [event.result] : []));
  expect(results.map((result) => [result.tool, result.status])).toEqual([
    ['edit', 'denied'],
    ['read_file', 'ok'],
  ]);
  expect(results[0].output).toBe('Not run: /review allows only read_file, grep.');

  await runtime.run('next');
  expect(offered(server.completions().at(-1)!.body)).toContain('edit');
  expect(offered(server.completions().at(-1)!.body)).toContain('run_command');
  await runtime.close();
});

test('narrowing never allows: a tool it names still asks as it would have', async () => {
  const runtime = await start();
  server.enqueue({ toolCalls: [edit] }, { text: 'asked' });
  const asked: string[] = [];
  await runtime.run('edit', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event.call.name);
    event.decide({ allow: false, feedback: 'no' });
  }, { allowedTools: ['edit'] });
  expect(asked).toEqual(['edit']);
  await runtime.close();
});

test('a turn on another model returns to the session\'s, and a model that cannot be used is said so', async () => {
  const runtime = await start({ env: {} });
  server.enqueue({ text: 'on the command model' }, { text: 'back' });
  await runtime.run('one', undefined, { model: 'ollama:command-model', label: '/review' });
  await runtime.run('two');
  expect(server.completions().slice(-2).map((request) => request.body.model)).toEqual(['command-model', 'fake-model']);
  expect(runtime.model).toMatchObject({ provider: 'ollama', model: 'fake-model' });

  server.enqueue({ text: 'still here' });
  const notices: string[] = [];
  await runtime.run('three', (event) => event.type === 'notice' && notices.push(event.message), { model: 'anthropic:claude-x', label: '/review' });
  expect(server.completions().at(-1)!.body.model).toBe('fake-model');
  expect(notices.join('\n')).toContain('/review asks for anthropic:claude-x, which cannot be used here');
  await runtime.close();
});

test('jamcli -p runs a custom command by name, and other text starting with a slash is sent as written', async () => {
  fs.mkdirSync(path.join(root, '.jamcli', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'commands', 'shout.md'), '---\nallowed-tools: read_file\n---\nSay $1 loudly.\n');
  const jam = async (prompt: string) => {
    const child = Bun.spawn(['bun', ENTRY, '-p', prompt, '--cwd', root], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, JAMCLI_STATE_DIR: path.join(root, '.state') } });
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return { out, code };
  };
  server.enqueue({ text: 'HELLO' }, { text: 'noted' });
  expect(await jam('/shout hello')).toEqual({ out: 'HELLO\n', code: 0 });
  const command = server.completions().at(-1)!;
  expect(command.body.messages.at(-1).content).toBe('Say hello loudly.');
  expect(offered(command.body)).toEqual(['read_file']);
  expect(await jam('/tmp is full')).toEqual({ out: 'noted\n', code: 0 });
  expect(server.completions().at(-1)!.body.messages.at(-1).content).toBe('/tmp is full');
}, 20_000);

test('a command typed after ! runs under the session\'s permissions without the model, and the next turn reads its output', async () => {
  const runtime = await start({ allowTools: ['run_command'] });
  const before = server.completions().length;
  const events: AgentEvent[] = [];
  const ran = await runtime.run('echo hello from the shell', (event) => events.push(event), { shell: true });
  expect(ran.status).toBe('ok');
  expect(server.completions().length).toBe(before);
  const results = events.flatMap((event) => (event.type === 'tool_result' ? [event.result] : []));
  expect(results.map((result) => [result.tool, result.status])).toEqual([['run_command', 'ok']]);

  server.enqueue({ text: 'seen' });
  await runtime.run('what did it print?');
  expect(JSON.stringify(server.completions().at(-1)!.body.messages)).toContain('hello from the shell');
  await runtime.close();

  // Without a grant, the person is asked like for any command, and a no leaves it unrun.
  const asking = await start();
  const denied = await asking.run('touch made.txt', (event) => event.type === 'approval_request' && event.decide({ allow: false }), { shell: true });
  expect(denied).toMatchObject({ status: 'refused', error: 'The command was not run.' });
  expect(fs.existsSync(path.join(root, 'made.txt'))).toBe(false);
  await asking.close();
});
