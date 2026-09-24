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
      // The quick category's model is also the trust classifier unless the gate is off.
      trust: { enabled: false },
      ...extra,
    })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
}

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const delegateCall = (prompt: string) => ({ id: 't1', name: 'task', arguments: { category: 'quick', prompt } });
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
  const child = await start({ surface: 'child', allowTools: ['edit', 'run_command'], parent: { sessionId: 'parent', depth: 1, permissions: inherited } });
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

test('delegation depth is bounded, and an unknown category is refused with the real ones named', async () => {
  configure({ delegation: { max_depth: 1, max_concurrent: 3, max_turns_per_child: 4 } });
  const parent = await start({ allowTools: ['task'] });
  server.enqueue(
    { toolCalls: [delegateCall('delegate again')] },
    { toolCalls: [{ id: 't2', name: 'task', arguments: { category: 'quick', prompt: 'deeper' } }] },
    { text: 'child stopped' },
    { toolCalls: [{ id: 't3', name: 'task', arguments: { category: 'nope', prompt: 'x' } }] },
    { text: 'done' }
  );
  await parent.run('go');
  const requests = server.completions().slice(-5);
  const childSaw = requests[2].body.messages.find((message: any) => message.role === 'tool').content;
  expect(childSaw).toBe('Delegation refused: Delegation depth 1 is at the configured maximum of 1.');
  const parentSaw = requests[4].body.messages.filter((message: any) => message.role === 'tool').at(-1).content;
  expect(parentSaw).toBe('Delegation refused: No category named "nope". The categories are quick.');
  expect(requests[0].body.tools.find((tool: any) => tool.function.name === 'task').function.description).toContain('Categories: quick.');
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
    return { status: request.signal?.aborted ? ('cancelled' as const) : ('ok' as const), response: request.signal?.aborted ? '' : 'finished', category: request.category, resolvedModel: 'ollama:m', childSessionId: 'c1' };
  };
  const ctx = { projectRoot: root, delegate };
  const started = await taskRunner({ category: 'quick', prompt: 'p', background: true }, ctx);
  const id = started.metadata!.id as string;
  expect((await taskStatusRunner({ id })).output).toContain(`${id}: running`);
  release();
  await Bun.sleep(5);
  expect((await taskResultRunner({ id })).output).toContain('finished');

  const second = (await taskRunner({ category: 'quick', prompt: 'p', background: true }, ctx)).metadata!.id as string;
  expect((await taskCancelRunner({ id: second })).output).toBe(`Cancelled ${second}. Partial output:\npartial `);
});

test('finished background tasks do not count against the concurrency limit', async () => {
  const delegate = async (request: DelegationRequest) => ({ status: 'ok' as const, response: 'done', category: request.category });
  const ctx = { projectRoot: root, delegate, delegationConfig: { max_depth: 2, max_concurrent: 1, max_turns_per_child: 2 } };
  await taskRunner({ category: 'quick', prompt: 'a', background: true }, ctx);
  await Bun.sleep(5);
  const next = await taskRunner({ category: 'quick', prompt: 'b', background: true }, ctx);
  expect(next.output).toContain('Started background task');
});
