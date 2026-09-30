import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent, ApprovalRequest } from '../../types.js';
import { SessionLog } from '../../transcript/index.js';
import { taskCancelRunner, taskResultRunner, taskRunner, taskStatusRunner } from '../../tools/task.js';
import type { DelegationRequest } from '../../delegation/types.js';
import { PermissionEngine } from '../../permissions/engine.js';
import { parseRule, type Rule } from '../../permissions/rules.js';
import { createBuiltinRegistry } from '../../tools/registry.js';
import { toolNaming } from '../tools.js';
import { WorkTable } from '../../work.js';
import { describeCall } from '../../approval.js';

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
  const child = await start({ surface: 'child', allowTools: ['edit', 'run_command'], parent: { sessionId: 'parent', depth: 1, permissions: inherited, work: new WorkTable(), model: 'ollama:fake-model' } });
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

test("a child's skill narrows the child only, and the parent's narrowing still holds the child", async () => {
  const dir = path.join(root, '.agents', 'skills', 'read-only');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: read-only\ndescription: Look without touching.\nallowed-tools: read_file\n---\nOnly read.\n');
  const parent = await start({ allowTools: ['task', 'edit', 'skill'] });
  server.enqueue(
    { toolCalls: [delegateCall('look around')] },
    { toolCalls: [{ id: 's1', name: 'skill', arguments: { name: 'read-only' } }] },
    { text: 'child looked' },
    { toolCalls: [editCall] },
    { text: 'parent edited' }
  );
  const results: { tool: string; status?: string; output: string }[] = [];
  await parent.run('delegate, then edit', (event) => event.type === 'tool_result' && results.push(event.result));
  expect(results.find((result) => result.tool === 'edit')).toMatchObject({ status: 'ok' });
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');

  // What a command narrowed for the parent's turn reaches the child it starts.
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  server.enqueue({ toolCalls: [delegateCall('change a.txt')] }, { toolCalls: [editCall] }, { text: 'child refused' }, { text: 'parent done' });
  const childResults: { tool: string; status?: string; output: string }[] = [];
  await parent.run('delegate the edit', (event) => event.type === 'tool_result' && childResults.push(event.result), { allowedTools: ['task', 'read_file'], label: '/look' });
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');
  const childLog = SessionLog.open(root, (childResults.find((result) => result.tool === 'task')!.output.match(/child session (\S+)/) ?? [])[1]!);
  expect(childLog.events().find((event) => event.type === 'approval')).toMatchObject({ allow: false, reason: '/look allows only task, read_file' });
  await parent.close();
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
  const work = new WorkTable();
  const ctx = { projectRoot: root, delegate, work };
  const started = await taskRunner({ agent: 'quick', prompt: 'p', background: true }, ctx);
  const id = started.metadata!.id as string;
  expect((await taskStatusRunner({ id }, ctx)).output).toContain(`${id}: running`);
  // The person sees it listed while it runs, and the model is told once when it ends.
  expect(work.list()).toMatchObject([{ id, kind: 'task', label: 'p', agent: 'quick' }]);
  expect(work.drainEnded()).toEqual([]);
  release();
  await Bun.sleep(5);
  expect(work.drainEnded()).toMatchObject([{ id, outcome: 'ok' }]);
  expect(work.drainEnded()).toEqual([]);
  expect((await taskResultRunner({ id }, ctx)).output).toContain('finished');
  // Collected, it stays listed for the person, with how it ended, and asking again gives the same answer rather than an error.
  expect(work.list()).toMatchObject([{ id, outcome: 'ok' }]);
  expect((await taskResultRunner({ id }, ctx)).output).toContain('finished');
  expect((await taskStatusRunner({ id }, ctx)).status).not.toBe('error');

  const second = (await taskRunner({ agent: 'quick', prompt: 'p', background: true }, ctx)).metadata!.id as string;
  expect((await taskCancelRunner({ id: second }, ctx)).output).toBe(`Cancelled ${second}. Partial output:\npartial `);
  // A job id is the session's own: another table knows nothing of it.
  expect((await taskStatusRunner({ id: second }, { projectRoot: root, work: new WorkTable() })).status).toBe('error');
});

test('a foreground task is listed while it runs and gone from the running count after', async () => {
  const work = new WorkTable();
  let seen: number | undefined;
  const delegate = async (request: DelegationRequest) => {
    seen = work.running('task');
    return { status: 'ok' as const, response: 'done', agent: request.agent ?? 'quick' };
  };
  const result = await taskRunner({ agent: 'quick', prompt: 'look' }, { projectRoot: root, delegate, work });
  expect(result.output).toContain('done');
  expect(seen).toBe(1);
  expect(work.running()).toBe(0);
  // Its result came back in the call, so there is no news of it.
  expect(work.drainEnded()).toEqual([]);
});

test('finished background tasks do not count against the concurrency limit', async () => {
  const delegate = async (request: DelegationRequest) => ({ status: 'ok' as const, response: 'done', agent: request.agent ?? 'quick' });
  const ctx = { projectRoot: root, delegate, work: new WorkTable(), delegationConfig: { max_depth: 2, max_concurrent: 1, max_turns_per_child: 2 } };
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

test('a task reports its agent, model, session, and activity to the work table as it runs', async () => {
  const work = new WorkTable();
  const delegate = async (request: DelegationRequest) => {
    request.onStart?.({ agent: 'quick', model: 'ollama:qwen', sessionId: 'child-1' });
    request.onEvent?.({ type: 'tool_call', call: { id: 'c1', name: 'grep', arguments: { pattern: 'todo' } } });
    request.onEvent?.({ type: 'usage', usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 }, cost: 0.001 });
    const [item] = work.list();
    expect(item).toMatchObject({ agent: 'quick', model: 'ollama:qwen', sessionId: 'child-1', tokens: 60, cost: 0.001 });
    expect(item.detail).toContain('grep');
    expect(item.label).toBe('Count the todos');
    return { status: 'ok' as const, response: 'done', agent: 'quick', childSessionId: 'child-1' };
  };
  const result = await taskRunner({ title: 'Count the todos', prompt: 'look' }, { projectRoot: root, delegate, work });
  expect(result.output).toContain('done');
  expect(work.events(work.list()[0].id).map((event) => event.type)).toEqual(['tool_call', 'usage']);
  expect(describeCall({ id: 't1', name: 'task', arguments: { title: 'Count the todos', prompt: 'look', background: true } })).toBe('task Count the todos · background');
  // A caller that gives no title still gets a label: the start of the prompt.
  await taskRunner({ prompt: 'look  for\nthe todos' }, { projectRoot: root, delegate: async () => ({ status: 'ok' as const, response: '', agent: 'quick' }), work });
  expect(work.list()[1].label).toBe('look for the todos');
});

test("a background child's prompt reaches whoever answers the parent's calls, and its answered call's result is shown", async () => {
  const work = new WorkTable();
  const asked: ApprovalRequest[] = [];
  const shown: string[] = [];
  const delegate = async (request: DelegationRequest) => {
    request.onStart?.({ agent: 'quick', model: 'ollama:qwen', sessionId: 'child-1' });
    const call = { id: 'c1', name: 'run_command', arguments: { command: 'wc -l a.txt' } };
    const decision = await request.requestApproval!({ call, request: { id: 'c1', call, policyClass: 'execute', summary: 'run_command wc -l a.txt', reason: 'this tool asks before it runs', suggestions: [] } });
    // A grandchild's ask arrives already naming the grandchild, and keeps naming it.
    const grandchild = { task: 'task-g', title: 'Read the lock file', agent: 'deep' };
    await request.requestApproval!({ call, request: { id: 'c2', call, policyClass: 'execute', summary: 'run_command wc -l a.txt', reason: 'this tool asks before it runs', suggestions: [], from: grandchild } });
    request.onResult?.({ tool: 'run_command', callId: 'c1', success: true, output: '3 a.txt', durationMs: 1 });
    return { status: 'ok' as const, response: `decided ${JSON.stringify(decision)}`, agent: request.agent ?? 'quick' };
  };
  const ctx = {
    projectRoot: root,
    delegate,
    work,
    requestApproval: async ({ request }: { request?: ApprovalRequest }) => (asked.push(request!), { allow: true, scope: 'once' as const }),
    onNestedResult: (result: { output?: string }) => shown.push(result.output ?? ''),
  };
  const started = await taskRunner({ agent: 'quick', title: 'Count the lines', prompt: 'count', background: true }, ctx);
  const id = started.metadata!.id as string;
  await Bun.sleep(10);
  // The prompt names the child that asks, as data, so two asking at once can be told apart, and says only why it asks.
  expect(asked.map((request) => request.from)).toEqual([{ task: id, title: 'Count the lines', agent: 'quick' }, { task: 'task-g', title: 'Read the lock file', agent: 'deep' }]);
  expect(asked[0].reason).toBe('this tool asks before it runs');
  expect(shown).toEqual(['3 a.txt']);
  const result = await taskResultRunner({ id }, ctx);
  expect(result.output).toContain('decided {"allow":true,"scope":"once"}');
});

test("a grant settles every child's ask it now allows, unasked, and names the rule that did", async () => {
  const parent = await start({ allowTools: ['task'] });
  const task = (id: string, letter: string) => ({ id, name: 'task', arguments: { agent: 'quick', title: `Print ${letter}`, prompt: `print ${letter}` } });
  const print = (id: string, letter: string) => ({ toolCalls: [{ id, name: 'run_command', arguments: { command: `printf ${letter}` } }] });
  server.enqueue(
    { toolCalls: [task('t1', 'a'), task('t2', 'b'), task('t3', 'c')] },
    print('p1', 'a'),
    print('p2', 'b'),
    print('p3', 'c'),
    { text: 'printed' },
    { text: 'printed' },
    { text: 'printed' },
    { text: 'all printed' }
  );
  const asks: Extract<AgentEvent, { type: 'approval_request' }>[] = [];
  const decisions: Extract<AgentEvent, { type: 'approval_decision' }>[] = [];
  const running = parent.run('print three letters', (event) => {
    if (event.type === 'approval_request') asks.push(event);
    if (event.type === 'approval_decision') decisions.push(event);
  });
  const deadline = Date.now() + 5_000;
  while (asks.length < 3 && Date.now() < deadline) await Bun.sleep(10);
  expect(asks.map((ask) => ask.request?.summary).sort()).toEqual(['run_command printf a', 'run_command printf b', 'run_command printf c']);
  // One answer for the session, with a pattern that covers all three.
  asks[0].decide({ allow: true, scope: 'session', pattern: 'run_command(printf *)' });
  const result = await Promise.race([running, Bun.sleep(5_000).then(() => undefined)]);
  expect(result?.response).toBe('all printed');
  // The others ran without being answered, each recorded with the rule that allowed it and where it came from.
  const others = decisions.filter((decision) => decision.callId !== asks[0].call.id && decision.tool === 'run_command');
  expect(others.map((decision) => decision.callId).sort()).toEqual(asks.slice(1).map((ask) => ask.call.id).sort());
  for (const decision of others) expect(decision).toMatchObject({ allow: true, by: 'user', rule: 'run_command(printf *)', source: 'granted at an approval prompt' });
  expect(asks.slice(1).every((ask) => ask.withdrawn?.aborted)).toBe(true);
}, 20_000);

test('task_result waits for a running child, holds no longer than the turn, and says when a wait ran out', async () => {
  let finish!: () => void;
  const delegate = async (request: DelegationRequest) => {
    await new Promise<void>((resolve) => (finish = resolve));
    return { status: 'ok' as const, response: 'the child finished', agent: request.agent ?? 'quick' };
  };
  const work = new WorkTable();
  const controller = new AbortController();
  const ctx = { projectRoot: root, delegate, work, signal: controller.signal };
  const id = (await taskRunner({ agent: 'quick', prompt: 'p', background: true }, ctx)).metadata!.id as string;
  // Without a wait it returns at once, and says how to wait.
  expect((await taskResultRunner({ id }, ctx)).output).toContain('task_result with wait_seconds holds until it ends');
  // With one it holds until the child ends, and collects it.
  const waiting = taskResultRunner({ id, wait_seconds: 30 }, ctx);
  await Bun.sleep(20);
  finish();
  expect((await waiting).output).toContain('the child finished');
  expect(work.get(id)?.told).toBe(true);
  // A cancelled turn ends the wait at once instead of holding the tool for its full time.
  const second = (await taskRunner({ agent: 'quick', prompt: 'q', background: true }, ctx)).metadata!.id as string;
  const held = taskResultRunner({ id: second, wait_seconds: 900 }, ctx);
  await Bun.sleep(10);
  controller.abort();
  expect((await held).output).toContain('is still running after 900 s');
  finish();
});
