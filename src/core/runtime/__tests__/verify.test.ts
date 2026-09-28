import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
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

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-verify-')));
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, permissions: { mode: 'accept-edits' }, sandbox: { enabled: false }, trust: { enabled: false }, lsp: { enabled: false } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  // The project's own gates: a typecheck that fails while a.txt says "broken", and a test that passes.
  fs.writeFileSync(path.join(root, 'typecheck.sh'), '#!/bin/sh\nif grep -q broken a.txt; then echo "a.txt(1,1): error: it is broken"; exit 1; fi\necho fine\n');
  fs.writeFileSync(path.join(root, 'test.sh'), '#!/bin/sh\necho "1 pass"\n');
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Fixture\n\n## Gates\n\n```bash\nsh ./typecheck.sh\nsh ./test.sh\n```\n');
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
});
afterEach(() => {
  expect(server.pending()).toBe(0);
  fs.rmSync(root, { recursive: true, force: true });
});

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const edit = (id: string, from: string, to: string) => ({ id, name: 'edit', arguments: { path: 'a.txt', find_string: from, replace_string: to } });

async function run(runtime: Awaited<ReturnType<typeof start>>, prompt: string) {
  const events: AgentEvent[] = [];
  const result = await runtime.run(prompt, (event) => {
    events.push(event);
    if (event.type === 'approval_request') event.decide({ allow: true, scope: 'once' });
  });
  return { result, events };
}

test('a failing gate comes back with the edit, denies the stop twice, and the third stop is let go with a warning', async () => {
  const runtime = await start();
  expect(runtime.gates.map((gate) => [gate.name, gate.tier, gate.command])).toEqual([
    ['typecheck', 'T1', 'sh ./typecheck.sh'],
    ['test', 'T2', 'sh ./test.sh'],
  ]);
  server.enqueue({ toolCalls: [edit('e1', 'old', 'broken')] }, { text: 'Done.' }, { text: 'Done again.' }, { text: 'Still done.' });
  const { result, events } = await run(runtime, 'break it');
  expect(result.status).toBe('ok');
  expect(result.response).toBe('Still done.');

  // The gate ran once after the edit, and its verdict reached the model with the edit's result.
  const messages = events.flatMap((event) => (event.type === 'message' ? [event.message] : []));
  const editResult = messages.find((message) => message.role === 'tool')!;
  expect(editResult.content).toContain('[Gate typecheck failed on your last edits:\ntypecheck failed in');
  expect(editResult.content).toContain('a.txt(1,1): error: it is broken');
  // Two stops were sent back with the failure; the third was allowed with a warning.
  const carried = messages.filter((message) => message.role === 'user' && message.content.startsWith('[A stop hook asks you to continue: typecheck failed'));
  expect(carried).toHaveLength(2);
  expect(carried[0].content).toContain('Fix what the gate reports before saying anything is done.');
  expect(events.filter((event) => event.type === 'notice' && event.code === 'gate_failed')).toHaveLength(1);
  // Every run went through the permission engine as a run_command call, and was recorded as a gate.
  const gateCalls = events.filter((event) => event.type === 'tool_call' && event.call.name === 'run_command');
  expect(gateCalls).toHaveLength(4);
  const gates = SessionLog.open(root, runtime.sessionId).events().filter((event) => event.type === 'gate');
  expect(gates.map((gate) => (gate as any).status)).toEqual(['failed', 'failed', 'failed', 'failed']);
  expect((gates[0] as any).tree).toMatch(/^[0-9a-f]{40}$/);
  expect(events.filter((event) => event.type === 'steer' && event.handler === 'M5')).toHaveLength(2);
  await runtime.close();
});

test('once the gates pass on a tree they are not run again on it, and completed steps are stamped', async () => {
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'todos.json'), JSON.stringify({ todos: [{ content: 'Fix a.txt', status: 'completed', check: 'sh ./typecheck.sh' }, { content: 'Later', status: 'pending' }] }));
  const runtime = await start();
  server.enqueue({ toolCalls: [edit('e1', 'old', 'fixed')] }, { text: 'Fixed.' });
  const first = await run(runtime, 'fix it');
  expect(first.result.response).toBe('Fixed.');
  const runs = first.events.filter((event) => event.type === 'gate') as Extract<AgentEvent, { type: 'gate' }>[];
  // After the edit: the typecheck. At the stop: the typecheck already passed on this tree, so only the test ran.
  expect(runs.map((gate) => [gate.name, gate.status])).toEqual([
    ['typecheck', 'passed'],
    ['test', 'passed'],
  ]);
  const todos = JSON.parse(fs.readFileSync(path.join(root, '.jamcli', 'todos.json'), 'utf8')).todos;
  expect(todos[0].verified).toEqual({ gate: 'typecheck, test', tree: runs[0].tree });
  expect(todos[1].verified).toBeUndefined();

  // A turn that changes nothing runs no gate, and the model's own run of a gate is recorded rather than repeated.
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'sh ./test.sh' } }] }, { text: 'Ran the tests.' });
  const second = await run(runtime, 'run the tests yourself');
  const recorded = second.events.filter((event) => event.type === 'gate') as Extract<AgentEvent, { type: 'gate' }>[];
  expect(recorded.map((gate) => [gate.name, gate.status, gate.byModel])).toEqual([['test', 'passed', true]]);
  expect(second.events.filter((event) => event.type === 'tool_call')).toHaveLength(1);

  // The pinned state a summary carries names the gates, and the session's end writes the handoff.
  await runtime.close();
  const handoff = fs.readFileSync(path.join(root, '.jamcli', 'handoff.md'), 'utf8');
  expect(handoff).toContain('Request: run the tests yourself');
  expect(handoff).toContain('typecheck passed on tree');
  expect(handoff).toContain('1. [x] Fix a.txt [verified: typecheck, test, tree ');
  expect(handoff).toContain('Changed:\na.txt');
});

test('a handoff left as a reset reaches the next session with its first prompt, once', async () => {
  const runtime = await start();
  server.enqueue({ toolCalls: [edit('e1', 'old', 'fixed')] }, { text: 'Fixed.' });
  await run(runtime, 'fix it');
  const written = await runtime.handoff();
  expect(written?.path).toBe(path.join('.jamcli', 'handoff.md'));
  await runtime.close();
  // The session's end did not overwrite the reset the person asked for.
  expect(fs.readFileSync(path.join(root, '.jamcli', 'handoff.md'), 'utf8').split('\n')[0]).toContain('(reset)');

  const next = await start();
  expect(next.notices.some((notice) => notice.includes('handoff'))).toBe(true);
  server.enqueue({ text: 'Picking up.' }, { text: 'Second turn.' });
  const { events } = await run(next, 'continue');
  const prompt = events.find((event) => event.type === 'message' && event.message.role === 'user') as Extract<AgentEvent, { type: 'message' }>;
  expect(prompt.message.content).toContain(`continue\n\n[Handoff from the previous session ${runtime.sessionId}:\n# Handoff`);
  expect(prompt.message.content).toContain('Request: fix it');
  expect(events.filter((event) => event.type === 'steer' && event.handler === 'M1')).toHaveLength(1);
  const again = await run(next, 'and again');
  const second = again.events.find((event) => event.type === 'message' && event.message.role === 'user') as Extract<AgentEvent, { type: 'message' }>;
  expect(second.message.content).toBe('and again');
  await next.close();
  // This session's own end replaced the file, so a third session would not read the old handoff.
  expect(fs.readFileSync(path.join(root, '.jamcli', 'handoff.md'), 'utf8').split('\n')[0]).not.toContain('(reset)');
});

test('a child run gets no backpressure, and a gate the person denies is a skip, not a failure', async () => {
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, permissions: { mode: 'default', deny: ['run_command(sh ./typecheck.sh)'] }, sandbox: { enabled: false }, trust: { enabled: false }, lsp: { enabled: false } }));
  const runtime = await start({ allowTools: ['edit'] });
  server.enqueue({ toolCalls: [edit('e1', 'old', 'broken')] }, { text: 'Done.' });
  const { result, events } = await run(runtime, 'break it');
  expect(result.status).toBe('ok');
  const gates = events.filter((event) => event.type === 'gate') as Extract<AgentEvent, { type: 'gate' }>[];
  expect(gates.map((gate) => [gate.name, gate.status])).toEqual([
    ['typecheck', 'skipped'],
    ['typecheck', 'skipped'],
    ['test', 'passed'],
  ]);
  expect(events.some((event) => event.type === 'message' && event.message.role === 'user' && event.message.content.startsWith('[A stop hook'))).toBe(false);
  await runtime.close();
});
