import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent } from '../../types.js';
import { SessionLog } from '../../transcript/index.js';
import { taskCancelRunner, taskResultRunner, taskRunner, taskStatusRunner } from '../../tools/task.js';
import type { DelegationRequest } from '../../delegation/types.js';
import { PermissionEngine } from '../../permissions/engine.js';
import { parseRule, type Rule } from '../../permissions/rules.js';
import { createBuiltinRegistry } from '../../tools/registry.js';
import { toolNaming } from '../tools.js';

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-children-'));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  configure();
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

function configure(extra: Record<string, unknown> = {}) {
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({
      api_registry: { ollama: { endpoint: server.ollamaBaseUrl } },
      active_profile: 'default',
      categories: { quick: [{ model: 'ollama:child-model' }] },
      trust: { enabled: false },
      ...extra,
    })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
}

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const delegateCall = (prompt: string) => ({ id: 't1', name: 'task', arguments: { agent: 'quick', prompt } });
const editCall = { id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } };

test('a child edits under the delegated policy, on its own model and session', async () => {
  const parent = await start({ allowTools: ['task', 'edit'] });
  server.enqueue({ toolCalls: [delegateCall('change a.txt')] }, { toolCalls: [editCall] }, { text: 'child done' }, { text: 'parent done' });
  const events: AgentEvent[] = [];
  const result = await parent.run('delegate the edit', (event) => events.push(event));

  expect(result.response).toBe('parent done');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');
  expect(events.some((event) => event.type === 'approval_request')).toBe(false);
  const [, childFirst, childSecond, parentLast] = server.completions().slice(-4);
  expect([childFirst.body.model, childSecond.body.model, parentLast.body.model]).toEqual(['child-model', 'child-model', 'fake-model']);

  const taskResult = parentLast.body.messages.find((message: any) => message.role === 'tool').content;
  expect(taskResult).toContain('child done');
  const childId = taskResult.match(/child session (\S+)/)[1];
  const childLog = SessionLog.open(root, childId);
  expect(childLog.events()[0]).toMatchObject({ surface: 'child', delegatedBy: parent.sessionId });
  expect(childLog.events().find((event) => event.type === 'approval')).toMatchObject({ by: 'flag', rule: 'edit', surface: 'child' });
});

test('what the parent would ask about, the child asks the parent surface, under the parent call', async () => {
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [delegateCall('change a.txt')] }, { toolCalls: [editCall] }, { text: 'child could not' }, { text: 'ok' });
  const asked: string[] = [];
  await parent.run('delegate the edit', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event.call.id);
    event.decide({ allow: false, feedback: 'not now' });
  });
  expect(asked).toEqual(['t1/e1']);
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  const childRequest = server.completions().at(-2)!.body;
  expect(childRequest.messages.find((message: any) => message.role === 'tool').content).toContain('not now');
});

test('a child cannot widen the policy it inherits', async () => {
  const deny = (parseRule('run_command', 'deny', 'flag', '--deny-tool run_command') as { rule: Rule }).rule;
  const inherited = new PermissionEngine({ projectRoot: root, rules: [deny], ...toolNaming(createBuiltinRegistry()) });
  const child = await start({ surface: 'child', allowTools: ['edit', 'run_command'], parent: { sessionId: 'parent', depth: 1, permissions: inherited, model: 'ollama:fake-model' } });
  expect(child.tools.map((tool) => tool.name)).not.toContain('run_command');
  server.enqueue({ toolCalls: [editCall] }, { text: 'asked' });
  const asked: string[] = [];
  await child.run('edit', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event.call.name);
    event.decide({ allow: false, feedback: 'no' });
  });
  expect(asked).toEqual(['edit']);
});

test('an unreachable ollama refuses the delegation cleanly instead of failing the child raw', async () => {
  // The parent runs on openai here, since the point is the *child's* ollama chain being
  // unreachable, not the parent's own model.
  configure({
    api_registry: { ollama: { endpoint: 'http://127.0.0.1:1' }, openai: { base_url: server.openaiBaseUrl } },
    categories: { quick: [{ model: 'ollama:llama3' }] },
  });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'profiles', 'default.json'),
    JSON.stringify({ name: 'Default', preferred_provider: 'openai', preferred_model: 'fake-model' })
  );
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [delegateCall('go')] }, { text: 'done' });
  await parent.run('delegate');
  const taskResult = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool').content;
  expect(taskResult).toBe('Delegation refused: no entry in "quick" is currently servable');
});

const systemOf = (request: any) => request.body.messages.find((message: any) => message.role === 'system')?.content ?? '';
const lastTool = (request: any) => request.body.messages.filter((message: any) => message.role === 'tool').at(-1).content;

test('a task that names no agent runs on the default, and with no default it is refused naming the agents', async () => {
  configure({ delegation: { default_agent: 'quick' } });
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [{ id: 't1', name: 'task', arguments: { prompt: 'look' } }] }, { text: 'child done' }, { text: 'ok' });
  await parent.run('go');
  const [, child, back] = server.completions().slice(-3);
  expect(child.body.model).toBe('child-model');
  expect(lastTool(back)).toContain('Delegated to agent "quick" on ollama:child-model');

  configure();
  const bare = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [{ id: 't2', name: 'task', arguments: { prompt: 'look' } }] }, { text: 'ok' });
  await bare.run('go');
  expect(lastTool(server.completions().at(-1))).toBe('Delegation refused: Name an agent: none is the default. The agents are quick.');
});

test('a built-in agent runs on the model the session is using, whatever provider serves it', async () => {
  // No categories, no agent files: only the built-ins, and the session on OpenAI.
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { openai: { base_url: server.openaiBaseUrl } }, active_profile: 'default', trust: { enabled: false } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_provider: 'openai', preferred_model: 'session-model' }));
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [{ id: 't1', name: 'task', arguments: { prompt: 'look' } }] }, { text: 'child done' }, { text: 'ok' });
  await parent.run('go');
  const [first, child, back] = server.completions().slice(-3);
  expect(child.dialect).toBe('openai');
  expect(child.body.model).toBe('session-model');
  expect(lastTool(back)).toContain('Delegated to agent "quick" on openai:session-model');
  const description = first.body.tools.find((tool: any) => tool.function.name === 'task').function.description;
  expect(description).toContain('(runs on the same model as you)');
  expect(description).not.toContain('ollama');
});

test("a chain entry's reasoning reaches the child, and the call's level replaces it", async () => {
  configure({ categories: { quick: [{ model: 'ollama:qwq', reasoning: 'off' }] } });
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [delegateCall('think less')] }, { text: 'child done' }, { text: 'ok' });
  await parent.run('go');
  // Ollama's thinking models think unless told not to, so `off` is sent as `think: false`.
  expect(server.completions().at(-2)!.body.think).toBe(false);

  server.enqueue({ toolCalls: [{ id: 't2', name: 'task', arguments: { agent: 'quick', prompt: 'think more', reasoning: 'on' } }] }, { text: 'child done' }, { text: 'ok' });
  await parent.run('again');
  expect(server.completions().at(-2)!.body.think).toBe(true);
});

test("an agent's effort reaches its child, and the call's effort replaces it", async () => {
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { openai: { base_url: server.openaiBaseUrl } }, active_profile: 'default', trust: { enabled: false } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_provider: 'openai', preferred_model: 'session-model' }));
  fs.mkdirSync(path.join(root, '.jamcli', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'agents', 'deep.md'), '---\ndescription: Hard problems.\nmodel: openai:deep-model\neffort: xhigh\n---\n');
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [{ id: 't1', name: 'task', arguments: { agent: 'deep', prompt: 'think' } }] }, { text: 'child done' }, { text: 'ok' });
  await parent.run('go');
  const [first, child] = server.completions().slice(-3);
  expect(child.body.model).toBe('deep-model');
  expect(child.body.reasoning_effort).toBe('xhigh');
  expect(first.body.reasoning_effort).toBeUndefined();
  const description = first.body.tools.find((tool: any) => tool.function.name === 'task').function.description;
  expect(description).toContain('- deep: Hard problems. (runs on openai:deep-model (effort xhigh))');

  server.enqueue({ toolCalls: [{ id: 't2', name: 'task', arguments: { agent: 'deep', prompt: 'look up', effort: 'low' } }] }, { text: 'child done' }, { text: 'ok' });
  await parent.run('again');
  expect(server.completions().at(-2)!.body.reasoning_effort).toBe('low');
});

test("an agent's rules reach its child before the project's rules, and never the parent", async () => {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'PROJECT-RULE-MARKER\n');
  fs.mkdirSync(path.join(root, '.jamcli', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'agents', 'quick.md'), '---\ndescription: Small jobs.\nmodels: ollama:child-model\n---\nAGENT-RULE-MARKER\n');
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [delegateCall('look')] }, { text: 'child done' }, { text: 'ok' });
  await parent.run('go');
  const [first, child] = server.completions().slice(-3);
  const childSystem = systemOf(child);
  expect(childSystem).toContain('Rules for the quick agent, from .jamcli/agents/quick.md:\nAGENT-RULE-MARKER');
  expect(childSystem.indexOf('AGENT-RULE-MARKER')).toBeLessThan(childSystem.indexOf('PROJECT-RULE-MARKER'));
  expect(systemOf(first)).toContain('PROJECT-RULE-MARKER');
  expect(systemOf(first)).not.toContain('AGENT-RULE-MARKER');
  // The model choosing sees the file's description, and the default.
  const description = first.body.tools.find((tool: any) => tool.function.name === 'task').function.description;
  expect(description).toContain('- quick: Small jobs. (runs on ollama:child-model)');
});

test('a child that runs out of steps still reports what it found', async () => {
  configure({ delegation: { max_depth: 2, max_concurrent: 3, max_turns_per_child: 2 } });
  const parent = await start({ allowTools: ['task', 'read_file'] });
  const read = (id: string) => ({ id, name: 'read_file', arguments: { path: 'a.txt' } });
  server.enqueue(
    { toolCalls: [delegateCall('look')] },
    { toolCalls: [read('r1')] },
    { toolCalls: [read('r2')] },
    { text: 'a.txt holds one line, old, at line 1. I did not check anything else.' },
    { text: 'parent done' }
  );
  await parent.run('go');
  const requests = server.completions().slice(-5);
  const wrapUp = requests[3].body.messages.at(-1).content;
  expect(wrapUp).toContain('reached the step limit and cannot call any more tools');
  const parentSaw = requests[4].body.messages.filter((message: any) => message.role === 'tool').at(-1).content;
  expect(parentSaw).toContain('status limit');
  expect(parentSaw).toContain('What it had found:\n\na.txt holds one line, old, at line 1.');
});

test('delegation depth is bounded, and an unknown agent is refused with the real ones named', async () => {
  configure({ delegation: { max_depth: 1, max_concurrent: 3, max_turns_per_child: 4 } });
  const parent = await start({ allowTools: ['task'] });
  server.enqueue(
    { toolCalls: [delegateCall('delegate again')] },
    { toolCalls: [{ id: 't2', name: 'task', arguments: { agent: 'quick', prompt: 'deeper' } }] },
    { text: 'child stopped' },
    { toolCalls: [{ id: 't3', name: 'task', arguments: { agent: 'nope', prompt: 'x' } }] },
    { text: 'done' }
  );
  await parent.run('go');
  const requests = server.completions().slice(-5);
  const childSaw = requests[2].body.messages.find((message: any) => message.role === 'tool').content;
  expect(childSaw).toBe('Delegation refused: Delegation depth 1 is at the configured maximum of 1.');
  const parentSaw = requests[4].body.messages.filter((message: any) => message.role === 'tool').at(-1).content;
  expect(parentSaw).toBe('Delegation refused: No agent named "nope". The agents are quick.');
  // A configured category is an agent with no description, and names no default.
  const description = requests[0].body.tools.find((tool: any) => tool.function.name === 'task').function.description;
  expect(description).toContain('- quick: (runs on ollama:child-model)\nAlways name an agent.');
});

test('cancelling the parent turn cancels the child', async () => {
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [delegateCall('slow work')] }, { text: 'too late', delayMs: 10_000 });
  const before = server.completions().length;
  const running = parent.run('go');
  while (server.completions().length < before + 2) await Bun.sleep(10);
  parent.cancel();
  const result = await running;
  expect(result.status).toBe('cancelled');
});

test('a background task runs on, reports its status, and can be cancelled with its partial output', async () => {
  let release: (value: void) => void = () => {};
  const delegate = async (request: DelegationRequest) => {
    request.onText?.('partial ');
    await new Promise((resolve) => {
      release = resolve;
      request.signal?.addEventListener('abort', () => resolve(undefined), { once: true });
    });
    return { status: request.signal?.aborted ? ('cancelled' as const) : ('ok' as const), response: request.signal?.aborted ? '' : 'finished', agent: request.agent ?? 'quick', resolvedModel: 'ollama:m', childSessionId: 'c1' };
  };
  const ctx = { projectRoot: root, delegate };
  const started = await taskRunner({ agent: 'quick', prompt: 'p', background: true }, ctx);
  const id = started.metadata!.id as string;
  expect((await taskStatusRunner({ id })).output).toContain(`${id}: running`);
  release();
  await Bun.sleep(5);
  expect((await taskResultRunner({ id })).output).toContain('finished');

  const second = (await taskRunner({ agent: 'quick', prompt: 'p', background: true }, ctx)).metadata!.id as string;
  expect((await taskCancelRunner({ id: second })).output).toBe(`Cancelled ${second}. Partial output:\npartial `);
});

test('finished background tasks do not count against the concurrency limit', async () => {
  const delegate = async (request: DelegationRequest) => ({ status: 'ok' as const, response: 'done', agent: request.agent ?? 'quick' });
  const ctx = { projectRoot: root, delegate, delegationConfig: { max_depth: 2, max_concurrent: 1, max_turns_per_child: 2 } };
  await taskRunner({ agent: 'quick', prompt: 'a', background: true }, ctx);
  await Bun.sleep(5);
  const next = await taskRunner({ agent: 'quick', prompt: 'b', background: true }, ctx);
  expect(next.output).toContain('Started background task');
});

test("a run can offer a tool under a description of its own, and only that run", async () => {
  const custom = await start({ allowTools: ['read_file'], toolDescriptions: { read_file: 'TRIAL-DESCRIPTION: read one file.' } });
  server.enqueue({ text: 'ok' });
  await custom.run('hi');
  const offered = (request: any) => request.body.tools.find((tool: any) => tool.function.name === 'read_file').function.description;
  expect(offered(server.completions().at(-1))).toBe('TRIAL-DESCRIPTION: read one file.');
  const plain = await start({ allowTools: ['read_file'] });
  server.enqueue({ text: 'ok' });
  await plain.run('hi');
  expect(offered(server.completions().at(-1))).not.toContain('TRIAL-DESCRIPTION');
});
