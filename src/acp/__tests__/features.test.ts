import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'node:stream';
import { AcpServer } from '../server.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';

// The SDK's own zod schemas, which its package does not export, checked against every message.
const zod: any = await import(new URL('./schema/zod.gen.js', import.meta.resolve('@agentclientprotocol/sdk')).href);
const RESPONSES: Record<string, any> = {
  initialize: zod.zInitializeResponse,
  'session/new': zod.zNewSessionResponse,
  'session/load': zod.zLoadSessionResponse,
  'session/prompt': zod.zPromptResponse,
  'session/set_mode': zod.zSetSessionModeResponse,
  'session/set_config_option': zod.zSetSessionConfigOptionResponse,
};

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-acp-features-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.mkdirSync(path.join(root, '.jamcli', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false } }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, '.jamcli', 'commands', 'review.md'), '---\ndescription: Review a file\nargument-hint: <file>\n---\nReview $1 closely.\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});
afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error('condition not met in time');
};

/** A client that records every message and checks each against the ACP schema. */
const connect = () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: any[] = [];
  const methods = new Map<number, string>();
  const problems: string[] = [];
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      messages.push(message);
      const schema =
        message.method === 'session/update'
          ? zod.zSessionNotification
          : message.method === 'session/request_permission'
            ? zod.zRequestPermissionRequest
            : 'result' in message
              ? RESPONSES[methods.get(message.id) ?? '']
              : undefined;
      const checked = schema?.safeParse(message.method ? message.params : message.result);
      if (checked && !checked.success) problems.push(`${message.method ?? methods.get(message.id)}: ${checked.error.message}`);
    }
  });
  const acp = new AcpServer({ input, output, projectRoot: root, sessionOptions: { runtime: { mcp: false } } });
  const done = acp.start();
  let nextId = 1;
  const request = async (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    methods.set(id, method);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    await waitFor(() => messages.some((message) => message.id === id && ('result' in message || 'error' in message)));
    return messages.find((message) => message.id === id);
  };
  const updates = (kind?: string) => messages.filter((message) => message.method === 'session/update' && (!kind || message.params.update.sessionUpdate === kind)).map((message) => message.params.update);
  const answer = (id: unknown, optionId: string) => input.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'selected', optionId } } })}\n`);
  const answerError = (id: unknown, message: string) => input.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } })}\n`);
  const close = async () => {
    input.end();
    await done;
  };
  return { messages, request, updates, answer, answerError, close, problems };
};

test('a session offers modes, a model setting, and its commands; a mode can be switched but bypass is not offered', async () => {
  const client = connect();
  const init = await client.request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  expect(init.result.agentCapabilities).toMatchObject({ loadSession: true, promptCapabilities: { embeddedContext: true } });
  const createdReply = await client.request('session/new', { cwd: root, mcpServers: [] });
  const created = createdReply.result;
  expect(created.modes.currentModeId).toBe('default');
  expect(created.modes.availableModes.map((mode: any) => mode.id)).toEqual(['plan', 'default', 'accept-edits', 'auto']);
  expect(created.configOptions[0]).toMatchObject({ id: 'model', type: 'select', currentValue: 'ollama:fake-model' });
  await waitFor(() => client.updates('available_commands_update').length > 0);
  const commandsMessage = client.messages.find((message) => message.method === 'session/update' && message.params.update.sessionUpdate === 'available_commands_update');
  // The list names the session, so it arrives after the reply that named it.
  expect(client.messages.indexOf(commandsMessage)).toBeGreaterThan(client.messages.indexOf(createdReply));
  expect(client.updates('available_commands_update')[0].availableCommands).toEqual([{ name: 'review', description: 'Review a file', input: { hint: '<file>' } }]);

  expect((await client.request('session/set_mode', { sessionId: created.sessionId, modeId: 'plan' })).error).toBeUndefined();
  await waitFor(() => client.updates('current_mode_update').length > 0);
  expect(client.updates('current_mode_update')[0].currentModeId).toBe('plan');
  expect((await client.request('session/set_mode', { sessionId: created.sessionId, modeId: 'bypass' })).error.message).toContain('There is no mode bypass here.');
  const switched = await client.request('session/set_config_option', { sessionId: created.sessionId, configId: 'model', value: 'ollama:other-model' });
  expect(switched.result.configOptions[0].currentValue).toBe('ollama:other-model');
  expect((await client.request('session/set_config_option', { sessionId: created.sessionId, configId: 'theme', value: 'dark' })).error.message).toContain('There is no setting theme to change.');
  expect(client.problems).toEqual([]);
  await client.close();
});

test('a turn streams a plan, a diff for an edit, and a command runs as its prompt with embedded context', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue(
    { toolCalls: [{ id: 't1', name: 'todo_write', arguments: { todos: [{ content: 'Edit a.txt', status: 'in_progress' }, { content: 'Check it' }] } }] },
    { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] },
    { text: 'Done.' }
  );
  const pendingReply = client.request('session/prompt', {
    sessionId,
    prompt: [
      { type: 'text', text: '/review a.txt' },
      { type: 'resource', resource: { uri: 'file:///notes.md', text: 'the notes', mimeType: 'text/markdown' } },
      { type: 'resource_link', uri: 'file:///guide.md', name: 'guide.md' },
    ],
  });
  await waitFor(() => client.messages.some((message) => message.method === 'session/request_permission'));
  client.answer(client.messages.find((message) => message.method === 'session/request_permission').id, 'allow-once');
  const pending = await pendingReply;
  expect(pending.result.stopReason).toBe('end_turn');
  // Every update was flushed before the reply, so none arrives after end_turn.
  expect(client.messages.filter((message, index) => message.method === 'session/update' && index > client.messages.indexOf(pending))).toEqual([]);

  expect(client.updates('plan')[0].entries).toEqual([
    { content: 'Edit a.txt', priority: 'medium', status: 'in_progress' },
    { content: 'Check it', priority: 'medium', status: 'pending' },
  ]);
  const edited = client.updates('tool_call_update').find((update) => update.toolCallId === 'e1');
  expect(edited).toMatchObject({ status: 'completed', content: [{ type: 'diff', path: path.join(root, 'a.txt'), oldText: 'old\n', newText: 'new\n' }] });
  const sent = server.completions().at(-3)!.body.messages.find((message: any) => message.role === 'user').content;
  expect(sent).toStartWith('Review a.txt closely.');
  expect(sent).toContain('Resource file:///notes.md:');
  expect(sent).toContain('Linked: [guide.md](file:///guide.md)');
  expect(client.problems).toEqual([]);
  await client.close();
}, 30_000);

test('session/load replays the recorded conversation before it answers', async () => {
  const first = connect();
  const sessionId = (await first.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue({ text: 'The answer is 4.' });
  await first.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'what is 2+2?' }] });
  await first.close();

  const second = connect();
  const loaded = await second.request('session/load', { sessionId, cwd: root, mcpServers: [] });
  expect(loaded.result.modes.currentModeId).toBe('default');
  const replayed = second.messages.slice(0, second.messages.indexOf(loaded)).filter((message) => message.method === 'session/update').map((message) => [message.params.update.sessionUpdate, message.params.update.content?.text]);
  expect(replayed).toEqual([
    ['user_message_chunk', 'what is 2+2?'],
    ['agent_message_chunk', 'The answer is 4.'],
  ]);
  server.enqueue({ text: 'I said 4.' });
  await second.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'what did you say?' }] });
  expect(server.completions().at(-1)!.body.messages.map((message: any) => message.content)).toContain('The answer is 4.');
  expect((await second.request('session/load', { sessionId: 'no-such-session', cwd: root, mcpServers: [] })).error).toBeDefined();
  expect(second.problems).toEqual([]);
  await second.close();
});

const editCall = (id: string) => ({ id, name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } });

test('allow-always grants for the session, so the next call does not ask', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue({ toolCalls: [editCall('e1')] }, { text: 'first' });
  const first = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'edit it' }] });
  await waitFor(() => client.messages.some((message) => message.method === 'session/request_permission'));
  client.answer(client.messages.find((message) => message.method === 'session/request_permission').id, 'allow-always');
  expect((await first).result.stopReason).toBe('end_turn');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');

  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  const asks = () => client.messages.filter((message) => message.method === 'session/request_permission');
  const before = asks().length;
  server.enqueue({ toolCalls: [editCall('e2')] }, { text: 'second' });
  const second = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'again' }] });
  await Bun.sleep(250);
  for (const extra of asks().slice(before)) client.answer(extra.id, 'reject-once');
  expect(asks().length).toBe(before);
  expect((await second).result.stopReason).toBe('end_turn');
  await client.close();
}, 20_000);

test('reject-always denies the call, so the file is left as it was', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue({ toolCalls: [editCall('e1')] });
  const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'edit it' }] });
  await waitFor(() => client.messages.some((message) => message.method === 'session/request_permission'));
  client.answer(client.messages.find((message) => message.method === 'session/request_permission').id, 'reject-always');
  // A rejection with no feedback stops the turn, and the model is told why.
  expect((await pending).result.stopReason).toBe('refusal');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  expect(client.problems).toEqual([]);
  await client.close();
}, 20_000);

test('a permission request that answers with an error denies the call', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue({ toolCalls: [editCall('e1')] });
  const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'edit it' }] });
  await waitFor(() => client.messages.some((message) => message.method === 'session/request_permission'));
  client.answerError(client.messages.find((message) => message.method === 'session/request_permission').id, 'the editor is unhappy');
  expect((await pending).result.stopReason).toBe('refusal');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  await client.close();
}, 20_000);

test('a tool result past the output limit is cut, with the rest counted', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'bun -e "console.log(\'x\'.repeat(25000))"' } }] }, { text: 'Ran it.' });
  const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'run it' }] });
  await waitFor(() => client.messages.some((message) => message.method === 'session/request_permission'));
  client.answer(client.messages.find((message) => message.method === 'session/request_permission').id, 'allow-once');
  await pending;
  const update = client.updates('tool_call_update').filter((entry) => entry.toolCallId === 'c1').at(-1)!;
  const body = (update.content as any[])[0].content.text as string;
  expect(body).toMatch(/\[\d+ more characters\]/);
  expect(body.length).toBeGreaterThan(19_900);
  expect(body.length).toBeLessThan(20_100);
  await client.close();
}, 30_000);

test('apply_patch reports every file it touches as a location', async () => {
  fs.writeFileSync(path.join(root, 'c.txt'), 'one\n');
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  const patch = ['--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-old', '+new', '--- a/c.txt', '+++ b/c.txt', '@@ -1 +1 @@', '-one', '+two', ''].join('\n');
  server.enqueue({ toolCalls: [{ id: 'p1', name: 'apply_patch', arguments: { patch } }] }, { text: 'Patched.' });
  const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'patch it' }] });
  await waitFor(() => client.messages.some((message) => message.method === 'session/request_permission'));
  client.answer(client.messages.find((message) => message.method === 'session/request_permission').id, 'allow-once');
  await pending;
  const update = client.updates('tool_call').find((entry) => entry.toolCallId === 'p1');
  expect(update.locations.map((location: any) => location.path).sort()).toEqual([path.join(root, 'a.txt'), path.join(root, 'c.txt')].sort());
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');
  expect(fs.readFileSync(path.join(root, 'c.txt'), 'utf8')).toBe('two\n');
  await client.close();
}, 30_000);
