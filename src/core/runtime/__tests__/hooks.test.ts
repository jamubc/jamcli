import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent, ToolResult } from '../../types.js';
import type { HookSettings } from '../../hooks/commands.js';

let server: FakeProviderServer;
let root: string;
let saved: Record<string, string | undefined>;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-hooks-')));
  saved = { JAMCLI_STATE_DIR: process.env.JAMCLI_STATE_DIR, JAMCLI_CONFIG_DIR: process.env.JAMCLI_CONFIG_DIR };
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  process.env.JAMCLI_CONFIG_DIR = path.join(root, '.user');
  fs.mkdirSync(path.join(root, '.user'), { recursive: true });
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  project({});
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function project(extra: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false }, ...extra })
  );
}
const userHooks = (hooks: HookSettings) => fs.writeFileSync(path.join(root, '.user', 'config.json'), JSON.stringify({ hooks }));
/** A hook script in the test directory, so commands need no quoting. */
function script(name: string, body: string): string {
  const file = path.join(root, '.hooks', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const edit = (id = 'e1', replace = 'new') => ({ id, name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: replace } });
const read = { id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } };
const contents = () => fs.readFileSync(path.join(root, 'a.txt'), 'utf8');
async function runWith(runtime: Awaited<ReturnType<typeof start>>, prompt: string, answer?: (event: Extract<AgentEvent, { type: 'approval_request' }>) => void) {
  const events: AgentEvent[] = [];
  await runtime.run(prompt, (event) => {
    events.push(event);
    if (event.type === 'approval_request') answer?.(event);
  });
  const results = events.flatMap((event) => (event.type === 'tool_result' ? [event.result] : [])) as ToolResult[];
  const notices = events.flatMap((event) => (event.type === 'notice' ? [event.message] : []));
  return { events, results, notices };
}

test('a pre_tool hook that exits 2 denies the call it matches, with its message as the reason', async () => {
  const seen = path.join(root, 'seen.json');
  userHooks({ pre_tool: [{ matcher: 'edit(a.txt)', command: script('guard.sh', `cat > ${seen}; echo "a.txt is frozen" >&2; exit 2`) }] });
  fs.writeFileSync(path.join(root, 'b.txt'), 'old\n');
  const runtime = await start({ allowTools: ['edit'] });
  const other = { id: 'e2', name: 'edit', arguments: { path: 'b.txt', find_string: 'old', replace_string: 'new' } };
  server.enqueue({ toolCalls: [read, edit(), other] }, { text: 'blocked' });
  const { results } = await runWith(runtime, 'change it');
  // The matcher names a.txt, so the read and the edit of b.txt pass it by.
  expect(results.map((result) => [result.tool, result.status])).toEqual([
    ['read_file', 'ok'],
    ['edit', 'denied'],
    ['edit', 'ok'],
  ]);
  expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('new\n');
  expect(results[1].output).toBe('Not run: a pre_tool hook blocked it: a.txt is frozen.');
  expect(contents()).toBe('old\n');
  // The hook read the event, for the call its matcher named and not the read.
  expect(JSON.parse(fs.readFileSync(seen, 'utf8'))).toMatchObject({
    event: 'pre_tool',
    session_id: runtime.sessionId,
    project_root: root,
    surface: 'headless',
    tool_name: 'edit',
    tool_call_id: 'e1',
    tool_input: { path: 'a.txt', find_string: 'old', replace_string: 'new' },
  });
  await runtime.close();
});

test('hooks add context to the prompt, the session, and a call\'s result', async () => {
  userHooks({
    session_start: [{ command: 'echo "The main branch is frozen."' }],
    user_prompt_submit: [{ command: `echo '{"additional_context":"The build is red since 9:00."}'` }],
    pre_tool: [{ matcher: 'read_file', command: `echo '{"additional_context":"This file is generated."}'` }],
    post_tool: [{ command: `echo '{"additional_context":"Checked by the linter."}'` }],
  });
  const runtime = await start();
  server.enqueue({ toolCalls: [read] }, { text: 'done' });
  await runWith(runtime, 'why is it red?');
  const body = server.completions().at(-1)!.body;
  const system = body.messages.find((message: any) => message.role === 'system').content;
  expect(system).toContain('The main branch is frozen.');
  expect(body.messages.find((message: any) => message.role === 'user').content).toBe('why is it red?\n\nThe build is red since 9:00.');
  expect(body.messages.find((message: any) => message.role === 'tool').content).toMatch(/\|old\n\nThis file is generated\.\n\nChecked by the linter\.$/);
  await runtime.close();
});

test('replacement arguments are checked against the tool\'s schema before the call runs', async () => {
  userHooks({ pre_tool: [{ matcher: 'edit', command: `echo '{"updated_input":{"path":"a.txt","find_string":"old","replace_string":"hooked"}}'` }] });
  const runtime = await start({ allowTools: ['edit'] });
  server.enqueue({ toolCalls: [edit()] }, { text: 'done' });
  const { notices, events } = await runWith(runtime, 'change it');
  expect(contents()).toBe('hooked\n');
  expect(notices).toContain('A pre_tool hook changed the arguments of edit (e1).');
  expect(events.find((event) => event.type === 'tool_call')).toMatchObject({ call: { arguments: { replace_string: 'hooked' } } });
  await runtime.close();

  userHooks({ pre_tool: [{ matcher: 'edit', command: `echo '{"updated_input":{"path":"a.txt","bogus":1}}'` }] });
  const second = await start({ allowTools: ['edit'] });
  server.enqueue({ toolCalls: [edit('e2', 'again')] }, { text: 'done' });
  const { results } = await runWith(second, 'change it again');
  expect(results[0].status).toBe('denied');
  expect(results[0].output).toMatch(/^Not run: a pre_tool hook blocked it: it replaced the arguments with ones the tool does not take \(.*bogus/);
  expect(contents()).toBe('hooked\n');
  await second.close();
});

test('a hook decision is one more rule source: allow answers only the mode, deny and ask win', async () => {
  userHooks({ pre_tool: [{ matcher: 'edit', command: `echo '{"decision":"allow","reason":"small edit"}'` }, { matcher: 'read_file', command: `echo '{"decision":"ask","reason":"secrets nearby"}'` }] });
  const runtime = await start();
  server.enqueue({ toolCalls: [edit()] }, { text: 'edited' }, { toolCalls: [read] }, { text: 'asked' });
  const asked: string[] = [];
  const first = await runWith(runtime, 'edit', (event) => asked.push(event.call.name));
  expect(asked).toEqual([]);
  expect(contents()).toBe('new\n');
  expect(first.events.find((event) => event.type === 'approval_decision')).toMatchObject({ by: 'hook', allow: true, reason: 'a pre_tool hook allowed it: small edit' });
  await runWith(runtime, 'read', (event) => {
    asked.push(`${event.call.name}: ${event.request?.reason}`);
    event.decide({ allow: false, feedback: 'no' });
  });
  expect(asked).toEqual(['read_file: a pre_tool hook asks first: secrets nearby']);
  await runtime.close();

  // A deny rule still denies what a hook allows.
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  const denied = await start({ denyTools: ['edit'] });
  server.enqueue({ toolCalls: [edit()] }, { text: 'denied' });
  await runWith(denied, 'edit');
  expect(contents()).toBe('old\n');
  await denied.close();
});

test('a failing hook is a notice and the turn goes on; a disabled one does not run', async () => {
  const ran = path.join(root, 'ran');
  userHooks({ pre_tool: [{ command: 'echo oops >&2; exit 1' }, { command: `touch ${ran}`, enabled: false }, { command: 'sleep 5', timeout_ms: 100 }] });
  const runtime = await start({ allowTools: ['edit'] });
  server.enqueue({ toolCalls: [edit()] }, { text: 'done' });
  const { notices, results } = await runWith(runtime, 'edit');
  expect(results[0].status).toBe('ok');
  expect(contents()).toBe('new\n');
  expect(notices.filter((notice) => notice.startsWith('Hook '))).toEqual([
    expect.stringMatching(/^Hook .* on pre_tool failed: it exited with 1: oops$/),
    expect.stringMatching(/^Hook .* on pre_tool failed: it did not finish within 100 ms$/),
  ]);
  expect(fs.existsSync(ran)).toBe(false);
  // The failure never reaches the model as its own words.
  expect(JSON.stringify(server.completions().at(-1)!.body.messages)).not.toContain('oops');
  await runtime.close();
});

test('a user_prompt_submit hook can stop a prompt, and a stop hook can ask the model to go on', async () => {
  userHooks({ user_prompt_submit: [{ command: script('secret.sh', 'grep -q password && { echo "that looks like a password" >&2; exit 2; }; exit 0') }] });
  const runtime = await start();
  const before = server.completions().length;
  const stopped = await runWith(runtime, 'my password is hunter2');
  expect(server.completions().length).toBe(before);
  expect(stopped.notices).toContain('A user_prompt_submit hook stopped this prompt: that looks like a password');
  expect(runtime.session.messages.some((message) => message.content.includes('hunter2'))).toBe(false);
  await runtime.close();

  const marker = path.join(root, 'once');
  userHooks({ stop: [{ command: script('tests.sh', `[ -f ${marker} ] && exit 0; touch ${marker}; echo "the tests have not been run" >&2; exit 2`) }] });
  const second = await start();
  server.enqueue({ text: 'All done.' }, { text: 'Ran them; all done.' });
  const result = await second.run('finish');
  expect(result.response).toBe('Ran them; all done.');
  const last = server.completions().at(-1)!.body.messages.at(-1);
  expect(last).toMatchObject({ role: 'user', content: '[A stop hook asks you to continue: the tests have not been run]' });
  await second.close();
});

test('a project\'s hooks run only once trusted, and trust lapses when they change', async () => {
  const ran = path.join(root, 'project-hook-ran');
  project({ hooks: { pre_tool: [{ command: `touch ${ran}` }] } });
  const untrusted = await start();
  expect(untrusted.notices.join('\n')).toContain('This project configures 1 hook not yet trusted, so it does not run.');
  expect(untrusted.hooks()).toMatchObject({ projectTrusted: false, hooks: [{ event: 'pre_tool', scope: 'project' }] });
  server.enqueue({ toolCalls: [read] }, { text: 'read' }, { toolCalls: [read] }, { text: 'read again' });
  await runWith(untrusted, 'read');
  expect(fs.existsSync(ran)).toBe(false);
  untrusted.trustProjectHooks();
  await runWith(untrusted, 'read again');
  expect(fs.existsSync(ran)).toBe(true);
  await untrusted.close();

  // A later session trusts the same hooks without asking, and not changed ones.
  expect((await start()).hooks().projectTrusted).toBe(true);
  project({ hooks: { pre_tool: [{ command: `touch ${ran}; echo changed` }] } });
  expect((await start()).hooks().projectTrusted).toBe(false);
});

test('hooks run with the session\'s minimal environment, and notification hooks hear of approvals', async () => {
  const envFile = path.join(root, 'env.txt');
  const notified = path.join(root, 'notified.json');
  userHooks({ pre_tool: [{ command: `env > ${envFile}` }], notification: [{ command: `cat > ${notified}` }] });
  const runtime = await start({ env: { ...process.env, OPENAI_API_KEY: 'sk-secret-value' } });
  server.enqueue({ toolCalls: [edit()] }, { text: 'asked' });
  await runWith(runtime, 'edit', (event) => event.decide({ allow: false, feedback: 'no' }));
  const env = fs.readFileSync(envFile, 'utf8');
  expect(env).not.toContain('sk-secret-value');
  expect(env).toContain(`JAMCLI_PROJECT_DIR=${root}`);
  expect(env).toContain(`JAMCLI_SESSION_ID=${runtime.sessionId}`);
  const written = () => fs.existsSync(notified) && fs.readFileSync(notified, 'utf8').endsWith('\n');
  for (let i = 0; i < 100 && !written(); i += 1) await Bun.sleep(20);
  expect(JSON.parse(fs.readFileSync(notified, 'utf8'))).toMatchObject({ event: 'notification', message: 'JamCLI asks to run edit.', level: 'info' });
  await runtime.close();
});

test('with a sandbox, hooks run inside it: the project is writable and the rest is not', async () => {
  const { detectSandbox } = await import('../../sandbox/index.js');
  if (detectSandbox({ projectRoot: root }).kind !== 'bwrap') return;
  // Outside /tmp, which the sandbox replaces, so this is the real directory.
  const outside = fs.mkdtempSync(path.join('/var/tmp', 'jamcli-hook-outside-'));
  try {
    project({ sandbox: { enabled: true } });
    userHooks({ pre_tool: [{ command: `touch ${path.join(outside, 'escaped')}; touch ${path.join(root, 'inside')}` }] });
    const runtime = await start();
    expect(runtime.sandbox.kind).toBe('bwrap');
    server.enqueue({ toolCalls: [read] }, { text: 'read' });
    await runWith(runtime, 'read');
    expect(fs.existsSync(path.join(root, 'inside'))).toBe(true);
    expect(fs.existsSync(path.join(outside, 'escaped'))).toBe(false);
    await runtime.close();
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
