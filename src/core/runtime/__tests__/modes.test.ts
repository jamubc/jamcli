import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { SessionLog } from '../../transcript/index.js';
import type { AgentEvent } from '../../types.js';
import { detectSandbox, unsandboxed as unsandboxedSandbox } from '../../sandbox/index.js';

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

const planCall = { id: 'p1', name: 'plan_write', arguments: { content: '# Plan\n1. Edit a.txt to say new.' } };
const exitCall = { id: 'x1', name: 'exit_plan_mode', arguments: {} };
const toolResult = (request: any, id: string) => request.body.messages.find((message: any) => message.role === 'tool' && message.tool_call_id === id)?.content;

test('an approved exit hands the plan over as the preview and returns to the mode held before plan', async () => {
  configure({ mode: 'accept-edits' });
  const runtime = await start();
  expect(runtime.setPermissionMode('plan')).toBeUndefined();
  expect(names(runtime)).toContain('plan_write');
  expect(names(runtime)).toContain('exit_plan_mode');
  server.enqueue({ toolCalls: [planCall] }, { toolCalls: [exitCall] }, { text: 'Approved.' });
  const asked: Extract<AgentEvent, { type: 'approval_request' }>[] = [];
  await runtime.run('plan the change', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event);
    event.decide({ allow: true });
  });
  expect(asked.map((event) => event.call.name)).toEqual(['exit_plan_mode']);
  expect(asked[0].request).toMatchObject({ alwaysAsks: true, preview: { kind: 'text', text: '# Plan\n1. Edit a.txt to say new.' } });
  expect(fs.readFileSync(path.join(root, '.jamcli', 'plan.md'), 'utf8')).toBe('# Plan\n1. Edit a.txt to say new.\n');
  expect(toolResult(server.completions().at(-1), 'x1')).toContain('From the next turn the session is in accept-edits mode');
  expect(runtime.permissionMode).toBe('accept-edits');
  expect(names(runtime)).toContain('edit');
  // The plan is written and handed over only in plan mode; read_file reads it back in any mode.
  for (const planOnly of ['plan_write', 'exit_plan_mode']) expect(names(runtime)).not.toContain(planOnly);
  const modes = SessionLog.open(root, runtime.sessionId).events().filter((event) => event.type === 'permission_mode');
  expect(modes).toMatchObject([{ from: 'accept-edits', to: 'plan' }, { from: 'plan', to: 'accept-edits' }]);
});

test('a declined exit keeps plan mode and returns the feedback; a session that began in plan mode exits to default', async () => {
  configure({ mode: 'plan' });
  const runtime = await start();
  server.enqueue({ toolCalls: [planCall] }, { toolCalls: [exitCall] }, { text: 'Revising.' });
  await runtime.run('plan the change', (event) => {
    if (event.type === 'approval_request') event.decide({ allow: false, feedback: 'name the test too' });
  });
  expect(toolResult(server.completions().at(-1), 'x1')).toContain('name the test too');
  expect(runtime.permissionMode).toBe('plan');

  server.enqueue({ toolCalls: [{ ...exitCall, id: 'x2' }] }, { text: 'Approved.' });
  await runtime.run('hand it over', (event) => {
    if (event.type === 'approval_request') event.decide({ allow: true });
  });
  expect(runtime.permissionMode).toBe('default');

  // Without a plan the prompt says so, and the call fails even when allowed.
  fs.rmSync(path.join(root, '.jamcli', 'plan.md'));
  const previews: string[] = [];
  server.enqueue({ toolCalls: [{ ...exitCall, id: 'x3' }] }, { text: 'Oh.' });
  runtime.setPermissionMode('plan');
  await runtime.run('exit', (event) => {
    if (event.type !== 'approval_request') return;
    previews.push(event.request?.preview?.text ?? '');
    event.decide({ allow: true });
  });
  expect(previews).toEqual(['There is no plan file; the call will fail.']);
  expect(toolResult(server.completions().at(-1), 'x3')).toContain('no plan to hand over');
  expect(runtime.permissionMode).toBe('plan');
});

test('ask_user reaches the person through the interface, and says no one can answer elsewhere', async () => {
  configure({ mode: 'plan' });
  const ask = { id: 'q1', name: 'ask_user', arguments: { question: 'Which store?', choices: ['redis', 'memory'] } };
  const runtime = await start();
  server.enqueue({ toolCalls: [ask] }, { text: 'Redis it is.' });
  const seen: Extract<AgentEvent, { type: 'elicitation_request' }>[] = [];
  await runtime.run('decide', (event) => {
    if (event.type !== 'elicitation_request') return;
    seen.push(event);
    event.respond({ action: 'accept', content: { answer: 'redis' } });
  });
  expect(seen[0].request).toMatchObject({ mode: 'form', server: 'JamCLI', message: 'Which store?' });
  expect(toolResult(server.completions().at(-1), 'q1')).toBe('redis');

  const headless = await start({ surface: 'headless' });
  server.enqueue({ toolCalls: [{ ...ask, id: 'q2' }] }, { text: 'Assuming redis.' });
  const events: AgentEvent[] = [];
  await headless.run('decide', (event) => void events.push(event));
  expect(events.some((event) => event.type === 'elicitation_request')).toBe(false);
  expect(toolResult(server.completions().at(-1), 'q2')).toContain('No one can answer a question on this surface');
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
  const unsandboxed = await start({ sandbox: unsandboxedSandbox('none in this test') });
  expect(unsandboxed.permissionMode).toBe('default');
  expect(unsandboxed.notices).toEqual([expect.stringContaining('.jamcli/config.json permissions.mode asks for auto mode')]);
  expect(unsandboxed.setPermissionMode('auto')).toContain('no sandbox');
  expect(unsandboxed.sandbox).toEqual({ kind: 'none', reason: 'none in this test' });

  const sandboxed = await start({ sandbox: { kind: 'bwrap', reason: 'a test sandbox', wrap: (command) => ({ file: '/bin/sh', args: ['-c', command] }) } });
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
    { toolCalls: [command('c3', 'touch c.txt')] },
    { text: 'done' }
  );
  const asked: string[] = [];
  await runtime.run('run things', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event.call.arguments.command);
    event.decide({ allow: true, scope: 'session', pattern: 'run_command(echo *)' });
  });
  expect(asked).toEqual(['echo one', 'touch c.txt']);
});

const detected = detectSandbox({ projectRoot: os.tmpdir() });

test.skipIf(detected.kind !== 'bwrap')('commands run in the sandbox the runtime detects', async () => {
  const runtime = await start({ allowTools: ['run_command'] });
  expect(runtime.sandbox.kind).toBe('bwrap');
  const probe = path.join(os.homedir(), `.jamcli-runtime-probe-${process.pid}`);
  try {
    server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: `touch ${probe}` } }] }, { text: 'ok' });
    await runtime.run('try it');
    expect(fs.existsSync(probe)).toBe(false);
    const result = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool').content;
    expect(result).toContain('bubblewrap sandbox');
  } finally {
    fs.rmSync(probe, { force: true });
  }
});
