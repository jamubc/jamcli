import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent, ToolCall } from '../../types.js';

let server: FakeProviderServer;
let base: string;
let root: string;
const shared = process.env.JAMCLI_CONFIG_DIR;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-rules-')));
  root = path.join(base, 'project');
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
  fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(process.env.JAMCLI_CONFIG_DIR, 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, model: 'ollama:fake-model', permissions: { deny: ['web_fetch(domain:example.com)'] } })
  );
  fs.mkdirSync(path.join(root, '.jamcli'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ permissions: { ask: ['read_file(secrets/**)'] } }));
});
afterEach(() => {
  process.env.JAMCLI_CONFIG_DIR = shared;
  fs.rmSync(base, { recursive: true, force: true });
});

const open = () => createRuntime({ projectRoot: root, surface: 'tui', mcp: false, env: {} });
const command = (text: string, id = 'c1'): ToolCall => ({ id, name: 'run_command', arguments: { command: text } });
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const local = () => path.join(root, '.jamcli', 'config.local.json');

/** Run one call and say what happened to it: asked, or its result's status. */
async function outcome(runtime: Awaited<ReturnType<typeof open>>, call: ToolCall): Promise<string> {
  server.enqueue({ toolCalls: [call] }, { text: 'done' });
  let asked = false;
  let status = '';
  await runtime.run('go', (event: AgentEvent) => {
    // Denied with feedback, so the turn goes on to the reply queued for it.
    if (event.type === 'approval_request') {
      asked = true;
      event.decide({ allow: false, feedback: 'not now' });
    }
    if (event.type === 'tool_result' && event.result.callId === call.id) status = event.result.status ?? (event.result.success ? 'ok' : 'error');
  });
  return asked ? 'asked' : status;
}

test('the rules are listed with their scope and source, lowest scope first', async () => {
  const runtime = await open();
  try {
    const rules = runtime.permissionRules().map(({ decision, text, scope, source }) => ({ decision, text, scope, source }));
    expect(rules.slice(0, 2).map((rule) => rule.scope)).toEqual(['builtin', 'builtin']);
    expect(rules).toContainEqual({ decision: 'deny', text: 'web_fetch(domain:example.com)', scope: 'user', source: expect.stringMatching(/config\.json permissions\.deny\[0\]$/) });
    expect(rules).toContainEqual({ decision: 'ask', text: 'read_file(secrets/**)', scope: 'project', source: '.jamcli/config.json permissions.ask[0]' });
  } finally {
    await runtime.close();
  }
});

test('a session rule applies to the next call and is written nowhere', async () => {
  const runtime = await open();
  try {
    expect(await outcome(runtime, command('echo one'))).toBe('asked');
    expect(runtime.addPermissionRule('allow', 'run_command(echo *)', 'session')).toBeUndefined();
    expect(await outcome(runtime, command('echo two', 'c2'))).toBe('ok');
    expect(runtime.permissionRules().at(-1)).toMatchObject({ decision: 'allow', text: 'run_command(echo *)', scope: 'session', source: 'added in this session' });
    expect(fs.existsSync(local())).toBe(false);
  } finally {
    await runtime.close();
  }
});

test('a saved rule is written to its scope\'s file, keeps the rest of it, and holds in the next session', async () => {
  fs.writeFileSync(local(), JSON.stringify({ theme: 'dark', permissions: { allow: ['grep'] } }));
  const first = await open();
  try {
    expect(first.addPermissionRule('deny', 'run_command(rm *)', 'local')).toBeUndefined();
    expect(first.addPermissionRule('allow', 'run_command(npm test)', 'project')).toBeUndefined();
    expect(first.addPermissionRule('ask', 'edit(src/**)', 'user')).toBeUndefined();
    expect(await outcome(first, command('rm -rf build'))).toBe('denied');
  } finally {
    await first.close();
  }
  expect(readJson(local())).toEqual({ theme: 'dark', permissions: { allow: ['grep'], deny: ['run_command(rm *)'] } });
  expect(readJson(path.join(root, '.jamcli', 'config.json')).permissions).toEqual({ ask: ['read_file(secrets/**)'], allow: ['run_command(npm test)'] });
  expect(readJson(path.join(process.env.JAMCLI_CONFIG_DIR!, 'config.json')).permissions).toEqual({ deny: ['web_fetch(domain:example.com)'], ask: ['edit(src/**)'] });

  const second = await open();
  try {
    expect(second.permissionRules()).toContainEqual(expect.objectContaining({ decision: 'deny', text: 'run_command(rm *)', scope: 'local' }));
    expect(await outcome(second, command('rm -rf dist'))).toBe('denied');
  } finally {
    await second.close();
  }
});

test('a rule that does not parse, or a file that is not JSON, changes nothing and says why', async () => {
  const runtime = await open();
  try {
    const before = runtime.permissionRules().length;
    expect(runtime.addPermissionRule('allow', 'run_command(', 'local')).toMatch(/is not a rule/);
    fs.writeFileSync(local(), '{ not json');
    expect(runtime.addPermissionRule('allow', 'grep', 'local')).toMatch(/config\.local\.json is not valid JSON, so it was not changed/);
    expect(runtime.permissionRules()).toHaveLength(before);
    expect(fs.readFileSync(local(), 'utf8')).toBe('{ not json');
  } finally {
    await runtime.close();
  }
});

test('removing a rule takes it out of the session and every file, and keeps what a person cannot edit', async () => {
  fs.writeFileSync(local(), JSON.stringify({ permissions: { allow: ['run_command(echo *)'], deny: ['run_command(echo *)'] } }));
  const runtime = await open();
  try {
    runtime.addPermissionRule('allow', 'run_command(echo *)', 'session');
    expect(await outcome(runtime, command('echo hi'))).toBe('denied');
    const { removed, kept } = runtime.removePermissionRule('run_command(echo *)');
    expect(removed.map((rule) => `${rule.scope} ${rule.decision}`).sort()).toEqual(['local allow', 'local deny', 'session allow']);
    expect(kept).toEqual([]);
    expect(readJson(local())).toEqual({ permissions: { allow: [], deny: [] } });
    expect(await outcome(runtime, command('echo again', 'c2'))).toBe('asked');

    // A built-in rule stays, and says so, and a file that does not hold the rule is not rewritten.
    const builtin = runtime.removePermissionRule('run_command(cd *)');
    expect(builtin.removed).toEqual([]);
    expect(builtin.kept.map((rule) => rule.scope)).toEqual(['builtin']);
    expect(runtime.permissionRules().some((rule) => rule.text === 'run_command(cd *)')).toBe(true);
    const project = path.join(root, '.jamcli', 'config.json');
    const written = fs.statSync(project).mtimeMs;
    await Bun.sleep(5);
    expect(runtime.removePermissionRule('grep').removed).toEqual([]);
    expect(fs.statSync(project).mtimeMs).toBe(written);
  } finally {
    await runtime.close();
  }
});

test('a rule from the legacy tools block is kept, since it is edited in that file', async () => {
  fs.writeFileSync(path.join(root, '.jamcli', 'mcp.json'), JSON.stringify({ tools: { run_command: { allowed: false } } }));
  const runtime = await open();
  try {
    const { removed, kept } = runtime.removePermissionRule('run_command');
    expect(removed).toEqual([]);
    expect(kept).toEqual([expect.objectContaining({ decision: 'deny', scope: 'project', source: '.jamcli/mcp.json tools.run_command' })]);
    expect(readJson(path.join(root, '.jamcli', 'mcp.json'))).toEqual({ tools: { run_command: { allowed: false } } });
  } finally {
    await runtime.close();
  }
});

test('a rule that denies a whole tool takes it out of what the model is offered, and removing it brings it back', async () => {
  const runtime = await open();
  try {
    expect(runtime.tools.some((tool) => tool.name === 'grep')).toBe(true);
    runtime.addPermissionRule('deny', 'grep', 'session');
    expect(runtime.tools.some((tool) => tool.name === 'grep')).toBe(false);
    runtime.removePermissionRule('grep');
    expect(runtime.tools.some((tool) => tool.name === 'grep')).toBe(true);
  } finally {
    await runtime.close();
  }
});

test('rules do not change while a turn runs', async () => {
  const runtime = await open();
  try {
    server.enqueue({ text: 'slow', delayMs: 300 });
    const turn = runtime.run('wait');
    await Bun.sleep(50);
    expect(runtime.addPermissionRule('allow', 'grep', 'session')).toMatch(/A turn is running/);
    expect(runtime.removePermissionRule('run_command(cd *)').error).toMatch(/A turn is running/);
    await turn;
    expect(runtime.addPermissionRule('allow', 'grep', 'session')).toBeUndefined();
  } finally {
    await runtime.close();
  }
});
