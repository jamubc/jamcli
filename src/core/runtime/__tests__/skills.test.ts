import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent, ToolResult } from '../../types.js';

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;
let previousConfig: string | undefined;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-skills-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  previousConfig = process.env.JAMCLI_CONFIG_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  process.env.JAMCLI_CONFIG_DIR = path.join(root, '.user');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, active_profile: 'default', trust: { enabled: false }, sandbox: { enabled: false } })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});
afterEach(() => {
  for (const [key, value] of [['JAMCLI_STATE_DIR', previousState], ['JAMCLI_CONFIG_DIR', previousConfig]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

function skill(name: string, front: string, body: string, files: Record<string, string> = {}) {
  const dir = path.join(root, '.agents', 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n${front}\n---\n${body}\n`);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const offered = (body: any) => (body.tools ?? []).map((tool: any) => tool.function.name);
const systemOf = (body: any) => body.messages.find((message: any) => message.role === 'system').content as string;
const load = (id: string, name: string) => ({ id, name: 'skill', arguments: { name } });
const edit = { id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } };

test('the prompt lists skills by name and description, and the skill tool loads one with its files', async () => {
  const dir = skill('release-notes', 'description: Write release notes from the git log.', 'Run scripts/log.sh, then group the commits.', { 'scripts/log.sh': 'git log --oneline\n' });
  const runtime = await start();
  expect(runtime.skills.map((entry) => entry.name)).toEqual(['release-notes']);
  server.enqueue({ toolCalls: [load('s1', 'release-notes')] }, { text: 'loaded' });
  const results: ToolResult[] = [];
  await runtime.run('write the notes', (event) => event.type === 'tool_result' && results.push(event.result));

  const first = server.completions().at(-2)!.body;
  expect(offered(first)).toContain('skill');
  expect(systemOf(first)).toContain('- release-notes: Write release notes from the git log.');
  expect(systemOf(first)).not.toContain('group the commits');
  expect(results[0].output).toContain('Run scripts/log.sh, then group the commits.');
  expect(results[0].output).toContain(`Files it bundles, under ${dir}:\n- scripts/log.sh`);
  await runtime.close();
});

test('a bundled script runs only through run_command, which asks as any command does', async () => {
  const dir = skill('tidy', 'description: Tidy the project.', 'Run scripts/tidy.sh.', { 'scripts/tidy.sh': 'echo tidied > tidied.txt\n' });
  const runtime = await start();
  const script = path.join(dir, 'scripts', 'tidy.sh');
  server.enqueue({ toolCalls: [load('s1', 'tidy')] }, { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: `sh ${script}` } }] }, { text: 'asked' });
  const asked: string[] = [];
  await runtime.run('tidy up', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(`${event.call.name} ${event.call.arguments.command}`);
    event.decide({ allow: false, feedback: 'not now' });
  });
  expect(asked).toEqual([`run_command sh ${script}`]);
  expect(fs.existsSync(path.join(root, 'tidied.txt'))).toBe(false);
  await runtime.close();
});

test('a skill\'s allowed-tools narrow the rest of the turn, never widen, and lift when it ends', async () => {
  skill('read-only', 'description: Look without touching.\nallowed-tools: Read Grep', 'Only read.');
  const runtime = await start({ allowTools: ['edit'] });
  server.enqueue({ toolCalls: [load('s1', 'read-only')] }, { toolCalls: [edit] }, { text: 'refused' }, { toolCalls: [edit] }, { text: 'edited' });
  const results: ToolResult[] = [];
  await runtime.run('look', (event) => event.type === 'tool_result' && results.push(event.result));
  expect(results[0].output).toContain('While this skill is active, until this turn ends, only these tools may run: read_file, grep.');
  expect(results[1]).toMatchObject({ tool: 'edit', status: 'denied', output: 'Not run: the skill read-only allows only read_file, grep.' });
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('old\n');

  await runtime.run('now edit');
  expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('new\n');

  // Inside a command that narrows too, only what both allow may run.
  skill('wide', 'description: Asks for more.\nallowed-tools: read_file run_command', 'Anything.');
  const second = await start({ allowTools: ['edit', 'run_command'] });
  server.enqueue({ toolCalls: [load('s1', 'wide')] }, { toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'true' } }] }, { text: 'done' });
  const events: AgentEvent[] = [];
  await second.run('go', (event) => events.push(event), { allowedTools: ['skill', 'read_file'], label: '/look' });
  const denied = events.flatMap((event) => (event.type === 'tool_result' ? [event.result] : [])).find((result) => result.tool === 'run_command');
  expect(denied).toMatchObject({ status: 'denied', output: 'Not run: /look and the skill wide allows only read_file.' });
  await runtime.close();
  await second.close();
});

test('with no skills there is no skill tool and no list', async () => {
  const runtime = await start();
  server.enqueue({ text: 'hi' });
  await runtime.run('hi');
  const body = server.completions().at(-1)!.body;
  expect(offered(body)).not.toContain('skill');
  expect(systemOf(body)).not.toContain('Skills:');
  await runtime.close();
});
