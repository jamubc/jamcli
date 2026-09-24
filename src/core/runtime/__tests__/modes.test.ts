import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { SessionLog } from '../../transcript/index.js';
import type { AgentEvent } from '../../types.js';

let server: FakeProviderServer;
let root: string;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-modes-'));
  configure();
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function configure(permissions?: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, ...(permissions ? { permissions } : {}) })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
}

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'tui', mcp: false, ...options });
const edit = { id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } };
const names = (runtime: { tools: { name: string }[] }) => runtime.tools.map((tool) => tool.name);

test('plan mode offers only what reads and plans, and tells the model why', async () => {
  configure({ mode: 'plan' });
  const runtime = await start();
  expect(runtime.permissionMode).toBe('plan');
  for (const hidden of ['edit', 'write_file', 'apply_patch', 'run_command', 'task']) expect(names(runtime)).not.toContain(hidden);
  for (const offered of ['read_file', 'grep', 'glob', 'todo_write']) expect(names(runtime)).toContain(offered);
  server.enqueue({ toolCalls: [{ ...edit, name: 'edit' }] }, { text: 'Here is the plan.' });
  await runtime.run('plan the change');
  const [first, second] = server.completions().slice(-2);
  expect(first.body.messages[0].content).toContain('Plan mode is on');
  expect(second.body.messages.find((message: any) => message.role === 'tool').content).toBe(
    'Not run: plan mode is on, so this session only reads and plans.'
  );
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  expect(SessionLog.open(root, runtime.sessionId).events()[0]).toMatchObject({ permissionMode: 'plan' });
});

test('switching modes changes what is offered and asked, and is recorded', async () => {
  configure({ mode: 'plan' });
  const runtime = await start();
  expect(runtime.setPermissionMode('accept-edits')).toBeUndefined();
  expect(names(runtime)).toContain('edit');
  server.enqueue({ toolCalls: [edit] }, { text: 'done' });
  const asked: AgentEvent[] = [];
  await runtime.run('make the change', (event) => {
    if (event.type === 'approval_request') asked.push(event);
  });
  expect(asked).toHaveLength(0);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');
  expect(server.completions().at(-2)!.body.messages[0].content).not.toContain('Plan mode is on');
  const events = SessionLog.open(root, runtime.sessionId).events();
  expect(events.find((event) => event.type === 'permission_mode')).toMatchObject({ from: 'plan', to: 'accept-edits' });
  expect(events.find((event) => event.type === 'approval')).toMatchObject({ by: 'mode', reason: 'accept-edits mode allows changes inside the project' });
});

test('auto mode needs a sandbox, whether asked for by a file or a switch', async () => {
  configure({ mode: 'auto' });
  const unsandboxed = await start();
  expect(unsandboxed.permissionMode).toBe('default');
  expect(unsandboxed.notices).toEqual([expect.stringContaining('.jamcli/config.json permissions.mode asks for auto mode')]);
  expect(unsandboxed.setPermissionMode('auto')).toContain('no sandbox');

  const sandboxed = await start({ sandboxed: true });
  expect(sandboxed.permissionMode).toBe('auto');
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'echo in-auto' } }] }, { text: 'ok' });
  const asked: string[] = [];
  await sandboxed.run('run it', (event) => {
    if (event.type === 'approval_request') asked.push(event.call.name);
  });
  expect(asked).toEqual([]);
});

test('bypass starts only from the flag, and is recorded on the session line', async () => {
  configure({ mode: 'bypass' });
  const fromFile = await start();
  expect(fromFile.permissionMode).toBe('default');
  expect(fromFile.notices[0]).toContain('--dangerously-bypass-permissions');

  const fromFlag = await start({ bypassPermissions: true });
  expect(fromFlag.permissionMode).toBe('bypass');
  server.enqueue({ toolCalls: [edit] }, { text: 'ok' });
  await fromFlag.run('change it');
  expect(SessionLog.open(root, fromFlag.sessionId).events()[0]).toMatchObject({ permissionMode: 'bypass' });
});

test('a pattern granted for the session stops the prompts it was made for', async () => {
  const runtime = await start();
  const command = (id: string, text: string) => ({ id, name: 'run_command', arguments: { command: text } });
  server.enqueue(
    { toolCalls: [command('c1', 'echo one')] },
    { toolCalls: [command('c2', 'echo two')] },
    { toolCalls: [command('c3', 'ls')] },
    { text: 'done' }
  );
  const asked: string[] = [];
  await runtime.run('run things', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event.call.arguments.command);
    event.decide({ allow: true, scope: 'session', pattern: 'run_command(echo *)' });
  });
  expect(asked).toEqual(['echo one', 'ls']);
});
