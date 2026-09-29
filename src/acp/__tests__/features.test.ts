import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'node:stream';
import { AcpServer } from '../server.js';
import { permissionInput, toolTitle } from '../updates.js';
import { startFakeProvider, type FakeProviderServer } from '../../testing/fakeProvider.js';

// The SDK's own zod schemas, which its package does not export, checked against every message.
const zod: any = await import(new URL('./schema/zod.gen.js', import.meta.resolve('@agentclientprotocol/sdk')).href);
/** What the agent may ask of the editor, each checked against the SDK's schema. */
const EDITOR_REQUESTS: Record<string, any> = {
  'fs/read_text_file': zod.zReadTextFileRequest,
  'fs/write_text_file': zod.zWriteTextFileRequest,
  'terminal/create': zod.zCreateTerminalRequest,
  'terminal/output': zod.zTerminalOutputRequest,
  'terminal/wait_for_exit': zod.zWaitForTerminalExitRequest,
  'terminal/kill': zod.zKillTerminalRequest,
  'terminal/release': zod.zReleaseTerminalRequest,
};
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
            : message.method in EDITOR_REQUESTS
              ? EDITOR_REQUESTS[message.method]
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
    // The agent numbers its own requests to the editor too, so only a response answers this one.
    const answered = (message: any) => message.id === id && !('method' in message) && ('result' in message || 'error' in message);
    await waitFor(() => messages.some(answered));
    return messages.find(answered);
  };
  const updates = (kind?: string) => messages.filter((message) => message.method === 'session/update' && (!kind || message.params.update.sessionUpdate === kind)).map((message) => message.params.update);
  const answer = (id: unknown, optionId: string) => input.write(`${JSON.stringify({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'selected', optionId } } })}\n`);
  const answerError = (id: unknown, message: string) => input.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message } })}\n`);
  /** Answer the agent's request, as an editor does. */
  const reply = (id: unknown, result: unknown) => input.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  /** Wait for the agent's next unanswered request by that method. */
  const asked = async (method: string, seen = new Set<unknown>()) => {
    await waitFor(() => messages.some((message) => message.method === method && !seen.has(message.id)));
    const found = messages.find((message) => message.method === method && !seen.has(message.id));
    seen.add(found.id);
    return found;
  };
  const close = async () => {
    input.end();
    await done;
  };
  return { messages, request, updates, answer, answerError, reply, asked, close, problems };
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
  const offered = client.updates('available_commands_update')[0].availableCommands;
  expect(offered).toContainEqual({ name: 'review', description: 'Review a file', input: { hint: '<file>' } });
  // Every built-in command is offered, the same set the interface lists.
  const { BUILTIN_COMMANDS } = await import('../../commands/builtin/index.js');
  for (const command of BUILTIN_COMMANDS) expect(offered.map((entry: { name: string }) => entry.name)).toContain(command.name);

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

test('a web_fetch tool call names its URL in the title', () => {
  expect(toolTitle({ id: 'w1', name: 'web_fetch', arguments: { url: 'https://example.com/a' } })).toBe('web_fetch https://example.com/a');
  expect(toolTitle({ id: 'e1', name: 'edit', arguments: { path: 'a.txt' } })).toBe('edit a.txt');
});

test('a permission request carries a text preview to the editor, so a plan handed over is readable there', () => {
  const call = { id: 'x1', name: 'exit_plan_mode', arguments: {} };
  const base = { id: 'a1', call, policyClass: 'state' as const, summary: 'exit_plan_mode', reason: 'it always asks', suggestions: [] };
  const decide = () => {};
  expect(permissionInput({ type: 'approval_request', call, decide, request: { ...base, preview: { kind: 'text', text: '# Plan\n1. Edit a.ts' } } })).toEqual({ preview: '# Plan\n1. Edit a.ts' });
  // A diff is not the call's input; the editor shows it as content when the call runs.
  expect(permissionInput({ type: 'approval_request', call: editCall('e1'), decide, request: { ...base, call: editCall('e1'), preview: { kind: 'diff', text: '--- a' } } })).toEqual(editCall('e1').arguments);
  expect(permissionInput({ type: 'approval_request', call, decide })).toEqual({});
});

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

test("an editor that lends its files: a read sees the unsaved buffer, and an edit is written through the editor", async () => {
  const client = connect();
  await client.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  const file = path.join(root, 'a.txt');
  server.enqueue(
    { toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } }] },
    { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'unsaved', replace_string: 'saved' } }] },
    { text: 'Done.' }
  );
  const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'change it' }] });
  const seen = new Set<unknown>();
  const read = await client.asked('fs/read_text_file', seen);
  expect(read.params).toMatchObject({ sessionId, path: file });
  client.reply(read.id, { content: 'unsaved\n' });
  client.answer((await client.asked('session/request_permission')).id, 'allow-once');
  client.reply((await client.asked('fs/read_text_file', seen)).id, { content: 'unsaved\n' });
  const write = await client.asked('fs/write_text_file');
  expect(write.params).toMatchObject({ sessionId, path: file, content: 'saved\n' });
  client.reply(write.id, null);
  expect((await pending).result.stopReason).toBe('end_turn');
  // The model read the editor's copy, and the disk was never written.
  const toolMessages = server.completions().at(-2)!.body.messages.filter((message: any) => message.role === 'tool');
  expect(toolMessages[0].content).toContain('unsaved');
  expect(fs.readFileSync(file, 'utf8')).toBe('old\n');
  expect(client.updates('tool_call_update').find((update) => update.toolCallId === 'e1')).toMatchObject({ status: 'completed', content: [{ type: 'diff', oldText: 'unsaved\n', newText: 'saved\n' }] });
  expect(client.problems).toEqual([]);
  await client.close();
}, 30_000);

test("an editor that lends a terminal runs the command in it, shown under the call, with jamcli's own environment", async () => {
  process.env.ACP_TEST_API_KEY = 'must-not-reach-the-terminal';
  try {
    const client = connect();
    await client.request('initialize', { protocolVersion: 1, clientCapabilities: { terminal: true } });
    const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
    server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'printf hello' } }] }, { text: 'It said hello.' });
    const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'say hello' }] });
    client.answer((await client.asked('session/request_permission')).id, 'allow-once');
    const created = await client.asked('terminal/create');
    const { command, args, cwd } = created.params;
    // env -i replaces the terminal's environment with the one jamcli gives every command.
    expect(command).toBe('/usr/bin/env');
    expect(args[0]).toBe('-i');
    expect(args.slice(-3)).toEqual(['/bin/sh', '-c', 'printf hello']);
    expect(args.some((arg: string) => arg.startsWith('PATH='))).toBe(true);
    expect(args.join(' ')).not.toContain('must-not-reach-the-terminal');
    expect(cwd).toBe(root);
    client.reply(created.id, { terminalId: 'term-1' });
    // The terminal is shown under the call while it runs.
    await waitFor(() => client.updates('tool_call_update').some((update) => update.toolCallId === 'c1' && update.content?.[0]?.type === 'terminal'));
    client.reply((await client.asked('terminal/wait_for_exit')).id, { exitCode: 0, signal: null });
    client.reply((await client.asked('terminal/output')).id, { output: 'hello\n', truncated: false, exitStatus: { exitCode: 0, signal: null } });
    client.reply((await client.asked('terminal/release')).id, null);
    expect((await pending).result.stopReason).toBe('end_turn');
    const toolMessage = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
    expect(toolMessage.content).toContain('Exit code 0');
    expect(toolMessage.content).toContain('hello');
    // The last update leaves the terminal in place rather than replacing it with text.
    const last = client.updates('tool_call_update').filter((update) => update.toolCallId === 'c1').at(-1)!;
    expect(last).toEqual({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed' });
    expect(client.problems).toEqual([]);
    await client.close();
  } finally {
    delete process.env.ACP_TEST_API_KEY;
  }
}, 30_000);

test("a command in the editor's terminal that runs out of time is killed, and what it printed is kept", async () => {
  const client = connect();
  await client.request('initialize', { protocolVersion: 1, clientCapabilities: { terminal: true } });
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'sleep 60', timeout_ms: 200 } }] }, { text: 'It hung.' });
  const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'wait' }] });
  client.answer((await client.asked('session/request_permission')).id, 'allow-once');
  client.reply((await client.asked('terminal/create')).id, { terminalId: 'term-2' });
  // wait_for_exit is never answered: the time limit decides.
  await client.asked('terminal/wait_for_exit');
  client.reply((await client.asked('terminal/kill')).id, null);
  client.reply((await client.asked('terminal/output')).id, { output: 'partial\n', truncated: false, exitStatus: { exitCode: null, signal: 'SIGTERM' } });
  client.reply((await client.asked('terminal/release')).id, null);
  expect((await pending).result.stopReason).toBe('end_turn');
  const toolMessage = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
  expect(toolMessage.content).toContain('Timed out');
  expect(toolMessage.content).toContain('partial');
  expect(client.problems).toEqual([]);
  await client.close();
}, 30_000);

test('an editor that cannot start the terminal leaves the command to run here', async () => {
  const client = connect();
  await client.request('initialize', { protocolVersion: 1, clientCapabilities: { terminal: true } });
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'printf ran-here' } }] }, { text: 'Ran.' });
  const pending = client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'run' }] });
  client.answer((await client.asked('session/request_permission')).id, 'allow-once');
  client.answerError((await client.asked('terminal/create')).id, 'no terminals here');
  expect((await pending).result.stopReason).toBe('end_turn');
  const toolMessage = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool');
  expect(toolMessage.content).toContain('ran-here');
  await client.close();
}, 30_000);

/** The text of every message chunk since `from`, joined. */
const chunks = (client: ReturnType<typeof connect>, from = 0) =>
  client
    .updates('agent_message_chunk')
    .slice(from)
    .map((update) => update.content.text)
    .join('');

test('a prompt naming a built-in command runs it, and its output is the reply, with no model asked', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  const before = server.completions().length;
  const reply = await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/context' }] });
  expect(reply.result.stopReason).toBe('end_turn');
  expect(chunks(client)).toContain('Context:');
  expect(server.completions().length).toBe(before);
  expect(client.problems).toEqual([]);
  await client.close();
});

test('a list a command offers is answered with /choose in the next prompt', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/mode' }] });
  await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/agents' }] });
  const offered = chunks(client);
  expect(offered).toContain('Answer with /choose <number or key>, or /choose none.');
  const seen = client.updates('agent_message_chunk').length;
  await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/choose none' }] });
  await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/choose 1' }] });
  expect(chunks(client, seen)).toContain('No list is waiting for an answer.');
  expect(client.problems).toEqual([]);
  await client.close();
});

test('/mode and /model over ACP tell the editor what changed', async () => {
  // /model saves the model for new sessions in the user's configuration, so this test has its own.
  const shared = process.env.JAMCLI_CONFIG_DIR;
  process.env.JAMCLI_CONFIG_DIR = path.join(root, '.user');
  try {
    const client = connect();
    const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
    await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/mode plan' }] });
    await waitFor(() => client.updates('current_mode_update').length > 0);
    expect(client.updates('current_mode_update').at(-1).currentModeId).toBe('plan');
    await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/model ollama:other-model' }] });
    await waitFor(() => client.updates('config_option_update').length > 0);
    expect(client.updates('config_option_update').at(-1).configOptions[0].currentValue).toBe('ollama:other-model');
    expect(JSON.parse(fs.readFileSync(path.join(root, '.user', 'config.json'), 'utf8')).model).toBe('ollama:other-model');
    expect(client.problems).toEqual([]);
    await client.close();
  } finally {
    process.env.JAMCLI_CONFIG_DIR = shared;
  }
});

test('/exit over ACP closes the session', async () => {
  const client = connect();
  const sessionId = (await client.request('session/new', { cwd: root, mcpServers: [] })).result.sessionId;
  expect((await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/exit' }] })).result.stopReason).toBe('end_turn');
  expect((await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/context' }] })).error).toBeDefined();
  await client.close();
});
