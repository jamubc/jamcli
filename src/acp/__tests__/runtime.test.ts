import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'node:stream';
import { AcpServer } from '../server.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';
import { SessionLog } from '../../core/transcript/index.js';

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-acp-'));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  configure({ ollama: { endpoint: server.ollamaBaseUrl } }, { preferred_provider: 'ollama', preferred_model: 'fake-model' });
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

function configure(registry: Record<string, unknown>, profile: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: registry, active_profile: 'default' }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', ...profile }));
}

const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error('condition not met in time');
};

/** An ACP client talking to a real server whose sessions are runtimes. */
const connect = () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: any[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) messages.push(JSON.parse(line));
  });
  const acp = new AcpServer({ input, output, projectRoot: root, sessionOptions: { runtime: { mcp: false } } });
  const done = acp.start();
  let nextId = 1;
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    await waitFor(() => messages.some((message) => message.id === id && ('result' in message || 'error' in message)));
    return messages.find((message) => message.id === id);
  };
  const answer = (id: unknown, optionId: string) =>
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'selected', optionId } } })}\n`);
  const close = async () => {
    input.end();
    await done;
  };
  return { messages, request, answer, close };
};

const prompt = (sessionId: string, text: string) => ({ sessionId, prompt: [{ type: 'text', text }] });

test('the second prompt carries the first exchange, and the session is recorded (F6)', async () => {
  const client = connect();
  const created = await client.request('session/new', { cwd: root, mcpServers: [] });
  const sessionId = created.result.sessionId;
  server.enqueue({ text: 'The answer is 4.' }, { text: 'I said 4.' });
  await client.request('session/prompt', prompt(sessionId, 'what is 2+2?'));
  const second = await client.request('session/prompt', prompt(sessionId, 'what did you say?'));
  expect(second.result.stopReason).toBe('end_turn');

  const messages = server.completions().at(-1)!.body.messages;
  expect(messages.map((message: any) => [message.role, message.content]).slice(1)).toEqual([
    ['user', 'what is 2+2?'],
    ['assistant', 'The answer is 4.'],
    ['user', 'what did you say?'],
  ]);
  const log = SessionLog.open(root, sessionId);
  expect(log.events()[0]).toMatchObject({ type: 'session', surface: 'acp' });
  expect(log.messages()).toHaveLength(4);
  await client.close();
});

test('write tools are offered, asked about in the editor, and each call keeps its own id', async () => {
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue(
    {
      toolCalls: [
        { id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } },
        { id: 'r2', name: 'read_file', arguments: { path: 'missing.txt' } },
        { id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } },
      ],
    },
    { text: 'Edited.' }
  );
  const pending = client.request('session/prompt', prompt(sessionId, 'edit @a.txt'));
  await waitFor(() => client.messages.some((message) => message.method === 'session/request_permission'));
  const permission = client.messages.find((message) => message.method === 'session/request_permission');
  expect(permission.params.toolCall).toMatchObject({ toolCallId: 'e1', title: 'edit a.txt', kind: 'edit', status: 'pending', locations: [{ path: path.join(root, 'a.txt') }] });
  client.answer(permission.id, 'allow-once');
  expect((await pending).result.stopReason).toBe('end_turn');

  const offered = server.completions().at(-2)!.body.tools.map((tool: any) => tool.function.name);
  for (const name of ['edit', 'write_file', 'run_command']) expect(offered).toContain(name);
  expect(server.completions().at(-2)!.body.messages.find((message: any) => message.role === 'user').content).toContain('File a.txt');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');

  const statuses = client.messages
    .filter((message) => message.params?.update?.sessionUpdate === 'tool_call_update')
    .map((message) => [message.params.update.toolCallId, message.params.update.status])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  // Reads run concurrently, so they may finish in either order.
  expect(statuses).toEqual([
    ['e1', 'completed'],
    ['r1', 'completed'],
    ['r2', 'failed'],
  ]);
  const approval = SessionLog.open(root, sessionId).events().find((event) => event.type === 'approval');
  expect(approval).toMatchObject({ callId: 'e1', allow: true, by: 'user', surface: 'acp' });
  await client.close();
});

test('ACP uses the configured provider rather than assuming Ollama (F13)', async () => {
  configure({ openai: { base_url: server.openaiBaseUrl } }, { preferred_provider: 'openai', preferred_model: 'fake-model' });
  const client = connect();
  const created = await client.request('session/new', { cwd: root, mcpServers: [] });
  expect(created.result.configOptions[0]).toMatchObject({ id: 'model', currentValue: 'openai:fake-model' });
  server.enqueue({ text: 'hi from openai' });
  await client.request('session/prompt', prompt(created.result.sessionId, 'hi'));
  expect(server.completions().at(-1)!.dialect).toBe('openai');
  await client.close();
});
