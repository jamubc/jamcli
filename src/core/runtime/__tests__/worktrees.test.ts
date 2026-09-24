import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { SessionLog } from '../../transcript/index.js';
import { openWorktree } from '../../git/worktrees.js';

const ENTRY = path.join(import.meta.dir, '../../../index.tsx');
const IDENTITY = { GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' };

let server: FakeProviderServer;
let root: string;
let previousState: string | undefined;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-worktrees-')));
  previousState = process.env.JAMCLI_STATE_DIR;
  process.env.JAMCLI_STATE_DIR = path.join(root, '.state');
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.jamcli', 'config.json'),
    JSON.stringify({
      api_registry: { ollama: { endpoint: server.ollamaBaseUrl } },
      active_profile: 'default',
      categories: { quick: [{ model: 'ollama:child-model' }] },
      trust: { enabled: false },
      sandbox: { enabled: false },
    })
  );
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, '.gitignore'), '.state/\n');
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', 'a.txt', '.gitignore');
  git(root, 'commit', '-q', '-m', 'first');
});

afterEach(() => {
  if (previousState === undefined) delete process.env.JAMCLI_STATE_DIR;
  else process.env.JAMCLI_STATE_DIR = previousState;
  fs.rmSync(root, { recursive: true, force: true });
});

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'headless', mcp: false, ...options });
const edit = (id: string) => ({ id, name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } });
const read = (dir: string) => fs.readFileSync(path.join(dir, 'a.txt'), 'utf8');
const taskCall = (isolation?: string) => ({ id: 't1', name: 'task', arguments: { category: 'quick', prompt: 'change a.txt', ...(isolation ? { isolation } : {}) } });
const taskWorktrees = () => (fs.existsSync(path.join(root, '.jamcli', 'worktrees')) ? fs.readdirSync(path.join(root, '.jamcli', 'worktrees')) : []);

test('a session in a worktree changes the worktree, with the project\'s settings, log, and checkpoints', async () => {
  const tree = await openWorktree(root, 'feature');
  const runtime = await start({ workTree: tree.dir, allowTools: ['edit'] });
  expect(runtime.workRoot).toBe(tree.dir);
  server.enqueue({ toolCalls: [edit('e1')] }, { text: 'Changed it.' });
  const result = await runtime.run('change @a.txt');

  expect(result.response).toBe('Changed it.');
  expect(read(tree.dir)).toBe('new\n');
  expect(read(root)).toBe('old\n');
  expect(git(root, 'status', '--porcelain')).toBe('');
  // The project's profile chose the model, and the prompt names the worktree as where the work is.
  const request = server.completions().at(-2)!.body;
  expect(request.model).toBe('fake-model');
  expect(JSON.stringify(request.messages)).toContain(tree.dir);
  // The session is the project's, so /resume finds it from the project.
  expect(SessionLog.open(root, runtime.sessionId).events()[0]).toMatchObject({ type: 'session', cwd: tree.dir });
  // The step was checkpointed in the worktree, and restoring it puts the worktree back.
  expect(runtime.checkpoints()).toHaveLength(1);
  await runtime.restoreCheckpoint(1);
  expect(read(tree.dir)).toBe('old\n');
  await runtime.close();
});

test('an isolated task changes its own worktree, and its location is reported', async () => {
  const parent = await start({ allowTools: ['task', 'edit'] });
  server.enqueue({ toolCalls: [taskCall('worktree')] }, { toolCalls: [edit('e1')] }, { text: 'child done' }, { text: 'parent done' });
  const result = await parent.run('delegate');

  expect(result.response).toBe('parent done');
  expect(read(root)).toBe('old\n');
  const [name] = taskWorktrees();
  expect(name).toMatch(/^task-/);
  const tree = path.join(root, '.jamcli', 'worktrees', name);
  expect(read(tree)).toBe('new\n');
  expect(git(tree, 'symbolic-ref', '--short', 'HEAD').trim()).toBe(`jamcli/${name}`);
  const reported = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool').content;
  expect(reported).toContain('child done');
  expect(reported).toContain(`The worktree .jamcli/worktrees/${name}, on branch jamcli/${name}, holds 1 file changed and not committed.`);
  expect(reported).toContain(`git merge jamcli/${name}`);
  await parent.close();
});

test('an isolated task that changes nothing leaves no worktree or branch, and one outside git is refused', async () => {
  const parent = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [taskCall('worktree')] }, { toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } }] }, { text: 'looked' }, { text: 'ok' });
  await parent.run('delegate a look');
  expect(taskWorktrees()).toEqual([]);
  expect(git(root, 'branch', '--list', 'jamcli/*')).toBe('');
  const reported = server.completions().at(-1)!.body.messages.find((message: any) => message.role === 'tool').content;
  expect(reported).toContain('looked');
  expect(reported).not.toContain('worktree');
  await parent.close();

  fs.rmSync(path.join(root, '.git'), { recursive: true, force: true });
  const outside = await start({ allowTools: ['task'] });
  server.enqueue({ toolCalls: [taskCall('worktree')] }, { text: 'refused' });
  const before = server.completions().length;
  await outside.run('delegate');
  const requests = server.completions().slice(before);
  // No child ran: the parent's two requests are all there were.
  expect(requests.map((request) => request.body.model)).toEqual(['fake-model', 'fake-model']);
  expect(requests[1].body.messages.find((message: any) => message.role === 'tool').content).toContain('needs a git repository');
  await outside.close();
});

test('jamcli -p --worktree works in the named worktree and says where', async () => {
  server.enqueue({ toolCalls: [edit('e1')] }, { text: 'Changed it.' });
  const child = Bun.spawn(['bun', ENTRY, '-p', 'change it', '--allow-tool', 'edit', '--worktree', 'cli', '--cwd', root], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, JAMCLI_STATE_DIR: path.join(root, '.state') },
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ out, code }).toEqual({ out: 'Changed it.\n', code: 0 });
  expect(err).toContain('Made the worktree .jamcli/worktrees/cli, on branch jamcli/cli.');
  expect(read(path.join(root, '.jamcli', 'worktrees', 'cli'))).toBe('new\n');
  expect(read(root)).toBe('old\n');

  const refused = Bun.spawn(['bun', ENTRY, '-p', 'x', '--worktree', '../out', '--cwd', root], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, JAMCLI_STATE_DIR: path.join(root, '.state') } });
  const [refusal, refusedCode] = await Promise.all([new Response(refused.stderr).text(), refused.exited]);
  expect(refusedCode).toBe(1);
  expect(refusal).toContain('cannot name a worktree');
}, 20_000);

test('in a worktree session, rules are judged from the worktree, and the person\'s working copy is out of reach', async () => {
  const tree = await openWorktree(root, 'rules');
  const runtime = await start({ workTree: tree.dir, permissions: { allowedTools: ['edit(a.txt)'] } });
  const byPath = (id: string, file: string) => ({ id, name: 'edit', arguments: { path: file, find_string: 'old', replace_string: 'new' } });
  server.enqueue({ toolCalls: [byPath('e1', path.join(tree.dir, 'a.txt'))] }, { toolCalls: [byPath('e2', path.join(root, 'a.txt'))] }, { text: 'done' });
  const asked: string[] = [];
  await runtime.run('edit both', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event.call.id);
    event.decide({ allow: true, scope: 'once' });
  });
  // The rule names a.txt in the tree the session works in, whichever way the call spells it.
  expect(asked).not.toContain('e1');
  expect(read(tree.dir)).toBe('new\n');
  // The person's copy is outside the session's tree, so the edit is refused even when allowed.
  expect(read(root)).toBe('old\n');
  const refusal = server.completions().at(-1)!.body.messages.filter((message: any) => message.role === 'tool').at(-1).content;
  expect(refusal).toContain("escapes the project root");
  await runtime.close();
});
