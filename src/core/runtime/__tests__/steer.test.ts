import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent } from '../../types.js';

let server: FakeProviderServer;
let root: string;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-steer-')));
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  configure({});
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  fs.rmSync(root, { recursive: true, force: true });
});

function configure(extra: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, models: { 'ollama:fake-model': { context_window: 64_000 } }, sandbox: { enabled: false }, trust: { enabled: false }, lsp: { enabled: false }, ...extra })
  );
}
const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const command = (id: string, text: string) => ({ id, name: 'run_command', arguments: { command: text } });
const read = (id: string) => ({ id, name: 'read_file', arguments: { path: 'a.txt' } });

async function run(runtime: Awaited<ReturnType<typeof start>>, prompt: string, answer: 'allow' | 'deny' | 'none' = 'none') {
  const events: AgentEvent[] = [];
  const asked: string[] = [];
  const result = await runtime.run(prompt, (event) => {
    events.push(event);
    if (event.type === 'approval_request') {
      asked.push(event.call.name);
      if (answer !== 'none') event.decide({ allow: answer === 'allow', scope: 'once' });
      else event.decide({ allow: false, scope: 'once', by: 'mode', feedback: 'no one answers here' });
    }
  });
  const results = events.flatMap((event) => (event.type === 'tool_result' ? [event.result] : []));
  return { result, events, asked, results };
}

test('in default mode a command that only reads inside the project runs without asking, and one that writes still asks', async () => {
  const runtime = await start();
  expect(runtime.permissionMode).toBe('default');
  server.enqueue({ toolCalls: [command('c1', 'ls'), command('c2', 'cat a.txt | head -1'), command('c3', 'echo hi > b.txt')] }, { text: 'done' });
  const { asked, results, events } = await run(runtime, 'look around');
  expect(asked).toEqual(['run_command']);
  expect(results.map((result) => result.status)).toEqual(['ok', 'ok', 'denied']);
  expect(results[1].output).toContain('old');
  const steers = events.filter((event) => event.type === 'steer') as Extract<AgentEvent, { type: 'steer' }>[];
  expect(steers.map((steer) => [steer.handler, steer.callId])).toEqual([
    ['M2', 'c1'],
    ['M2', 'c2'],
  ]);
  // The allowance is a hook's, recorded as such.
  const approvals = events.filter((event) => event.type === 'approval_decision') as Extract<AgentEvent, { type: 'approval_decision' }>[];
  expect(approvals.find((approval) => approval.callId === 'c1')).toMatchObject({ allow: true, by: 'hook' });
  await runtime.close();
});

test('a deny rule still wins over the read-only allowance', async () => {
  configure({ permissions: { deny: ['run_command(cat *)'] } });
  const runtime = await start();
  server.enqueue({ toolCalls: [command('c1', 'cat a.txt')] }, { text: 'done' });
  const { asked, results, events } = await run(runtime, 'read it with cat');
  expect(asked).toEqual([]);
  expect(results[0].status).toBe('denied');
  expect(events.some((event) => event.type === 'steer')).toBe(false);
  await runtime.close();
});

test('a read repeated with the same arguments on the same tree is refused with the first line of the earlier result', async () => {
  configure({ permissions: { mode: 'accept-edits' } });
  const runtime = await start();
  server.enqueue({ toolCalls: [read('r1')] }, { toolCalls: [read('r2')] }, { toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { toolCalls: [read('r3')] }, { text: 'done' });
  const { results, events } = await run(runtime, 'read twice, change, read again');
  expect(results.map((result) => [result.callId, result.status])).toEqual([
    ['r1', 'ok'],
    ['r2', 'denied'],
    ['e1', 'ok'],
    ['r3', 'ok'],
  ]);
  expect(results[1].output).toMatch(/^Not run: a pre_tool hook blocked it: same call, same result; nothing has changed since\. It began: 1\|/);
  expect(results[3].output).toContain('new');
  expect((events.filter((event) => event.type === 'steer') as Extract<AgentEvent, { type: 'steer' }>[]).map((steer) => steer.handler)).toEqual(['M3']);
  await runtime.close();
});

test('a model or mode switch is told to the model with its next prompt, and the prompt names the model', async () => {
  configure({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl }, openai: { base_url: server.openaiBaseUrl, key_env_var: 'JAMCLI_TEST_OPENAI_KEY' } }, models: { 'ollama:fake-model': { context_window: 64_000 } } });
  process.env.JAMCLI_TEST_OPENAI_KEY = 'sk-test-0123456789abcdef';
  const runtime = await start();
  server.enqueue({ text: 'first' });
  await run(runtime, 'hello');
  const first = server.completions().at(-1)!.body;
  expect(first.messages.find((message: any) => message.role === 'system').content).toContain('- Model: ollama:fake-model');
  runtime.setModel('openai:gpt-fake');
  runtime.setPermissionMode('accept-edits');
  server.enqueue({ text: 'second', forModel: 'gpt-fake' });
  const { events } = await run(runtime, 'again');
  const prompt = events.find((event) => event.type === 'message' && event.message.role === 'user') as Extract<AgentEvent, { type: 'message' }>;
  expect(prompt.message.content).toBe(
    'again\n\n[Model changed: ollama:fake-model to openai:gpt-fake. Messages above were written by ollama:fake-model.]\n\n[Mode changed: default to accept-edits. Earlier calls were decided under default.]'
  );
  const second = server.completions().at(-1)!.body;
  const system = second.messages.find((message: any) => message.role === 'system').content;
  expect(system).toContain('- Model: openai:gpt-fake');
  await runtime.close();
});

test('a window too small for every tool is offered the core tier, with the rest behind search_tools', async () => {
  configure({ models: { 'ollama:fake-model': { context_window: 8_192 } } });
  const small = await start();
  const offered = small.tools.map((tool) => tool.name);
  expect(offered).toContain('search_tools');
  server.enqueue({ toolCalls: [{ id: 's1', name: 'search_tools', arguments: { query: 'select:git_status' } }] }, { toolCalls: [{ id: 'g1', name: 'git_status', arguments: {} }] }, { text: 'done' });
  const { results } = await run(small, 'what changed?', 'allow');
  expect(results[0].output).toContain('git_status');
  const requests = server.completions();
  const before = requests.at(-3)!.body.tools.map((tool: any) => tool.function.name);
  const after = requests.at(-1)!.body.tools.map((tool: any) => tool.function.name);
  expect(before).toEqual(expect.arrayContaining(['read_file', 'glob', 'grep', 'edit', 'write_file', 'run_command', 'todo_write', 'todo_read', 'command_output', 'command_kill', 'search_tools']));
  expect(before).not.toContain('git_status');
  expect(before).not.toContain('task');
  expect(after).toContain('git_status');
  // The base request leaves the small window most of its budget.
  const usage = small.contextUsage();
  expect(usage.used).toBeLessThan(usage.trigger * 0.6);
  await small.close();

  configure({ models: { 'ollama:fake-model': { context_window: 64_000 } } });
  const large = await start();
  expect(large.tools.map((tool) => tool.name)).not.toContain('search_tools');
  expect(large.tools.map((tool) => tool.name)).toContain('git_status');
  // The task and delegate families wait for the step after one starts.
  server.enqueue({ text: 'nothing' });
  await run(large, 'hi');
  const names = server.completions().at(-1)!.body.tools.map((tool: any) => tool.function.name);
  expect(names).toContain('task');
  expect(names).not.toContain('task_status');
  await large.close();
});

test('the wire schema is what the model sees, and a call is still checked against the full one', async () => {
  configure({ permissions: { mode: 'accept-edits' } });
  const runtime = await start();
  const readFile = runtime.tools.find((tool) => tool.name === 'read_file')!;
  expect(Object.keys(readFile.parameters.properties ?? {})).toEqual(['path', 'offset', 'limit']);
  server.enqueue({ toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'a.txt', start_line: 1, end_line: 1 } }] }, { text: 'done' });
  const { results } = await run(runtime, 'read with the old names');
  expect(results[0].status).toBe('ok');
  expect(results[0].output).toContain('old');
  await runtime.close();
});
