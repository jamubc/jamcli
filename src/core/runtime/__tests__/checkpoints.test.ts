import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import { SessionLog } from '../../transcript/index.js';

let server: FakeProviderServer;
let root: string;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-checkpoints-')));
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, permissions: { mode: 'accept-edits', allow: ['run_command(true)'] }, sandbox: { enabled: false } }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'P', GIT_AUTHOR_EMAIL: 'p@example.com', GIT_COMMITTER_NAME: 'P', GIT_COMMITTER_EMAIL: 'p@example.com' } });
const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'tui', mcp: false, ...options });
const edit = (id: string, from: string, to: string) => ({ id, name: 'edit', arguments: { path: 'a.txt', find_string: from, replace_string: to } });
const read = () => fs.readFileSync(path.join(root, 'a.txt'), 'utf8');

test('in a repository, each step that changes something is checkpointed first, and a restore can itself be undone', async () => {
  git('init', '-q', '-b', 'main');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  const runtime = await start();
  // Reading, and the agent's own plan, change nothing worth a checkpoint.
  server.enqueue(
    { toolCalls: [{ id: 'r1', name: 'read_file', arguments: { path: 'a.txt' } }, { id: 't1', name: 'todo_write', arguments: { todos: [{ content: 'Edit a.txt', status: 'pending' }] } }] },
    { text: 'Read it.' }
  );
  await runtime.run('look');
  expect(runtime.checkpoints()).toEqual([]);
  // A command that changes nothing leaves no checkpoint either.
  server.enqueue({ toolCalls: [{ id: 'c1', name: 'run_command', arguments: { command: 'true' } }] }, { text: 'Ran it.' });
  await runtime.run('run it');
  expect(runtime.checkpoints()).toEqual([]);

  // Two edits in one step take one checkpoint, before the first.
  server.enqueue({ toolCalls: [edit('e1', 'old', 'mid'), edit('e2', 'mid', 'new')] }, { text: 'Changed it.' });
  await runtime.run('change it');
  expect(read()).toBe('new\n');
  const [first] = runtime.checkpoints();
  expect(runtime.checkpoints()).toHaveLength(1);
  expect(first).toMatchObject({ n: 1, kind: 'git', label: 'edit a.txt' });
  expect(first.after).toMatch(/^[0-9a-f]{40}$/);
  // The turn it records is where 'change it' was said, so the conversation can go back there.
  const events = SessionLog.open(root, runtime.sessionId).events().filter((event) => event.type !== 'session');
  expect(events[first.turn!]).toMatchObject({ type: 'message', message: { role: 'user', content: 'change it' } });
  expect(git('status', '--porcelain')).toBe(' M a.txt\n');

  const preview = await runtime.previewCheckpoint(1);
  expect(preview.files).toEqual([{ path: 'a.txt', change: 'restored' }]);
  expect(preview.diff).toContain('-new');
  expect(preview.diff).toContain('+old');
  expect(await runtime.restoreCheckpoint(1)).toEqual(['a.txt']);
  expect(read()).toBe('old\n');
  // The restore took a checkpoint of what it replaced, so it can be undone too.
  expect(runtime.checkpoints().map((entry) => entry.label)).toEqual(['edit a.txt', 'before restoring checkpoint 1']);
  await runtime.restoreCheckpoint(2);
  expect(read()).toBe('new\n');
  // The person's own git state is as it was: nothing staged, HEAD where it was.
  expect(git('diff', '--cached')).toBe('');
  expect(git('rev-list', '--count', 'HEAD').trim()).toBe('1');
  await expect(runtime.previewCheckpoint(9)).rejects.toThrow('This session has no checkpoint 9.');
  await runtime.close();
});

test('outside a repository, the file an edit is about to change is backed up and restored', async () => {
  const runtime = await start();
  server.enqueue({ toolCalls: [edit('e1', 'old', 'new')] }, { text: 'Done.' });
  await runtime.run('change it');
  expect(read()).toBe('new\n');
  const [first] = runtime.checkpoints();
  expect(first).toMatchObject({ n: 1, kind: 'files', files: ['a.txt'] });
  expect((await runtime.previewCheckpoint(1)).files).toEqual([{ path: 'a.txt', change: 'restored' }]);
  await runtime.restoreCheckpoint(1);
  expect(read()).toBe('old\n');
  await runtime.close();
});

test("a change the person asks for is checkpointed too, even before the session's first message", async () => {
  git('init', '-q', '-b', 'main');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  const runtime = await start();
  const result = await runtime.withCheckpoint('revert a.txt', async () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'reverted\n');
    return 'done';
  });
  expect(result).toBe('done');
  expect(runtime.checkpoints()).toMatchObject([{ n: 1, label: 'revert a.txt', kind: 'git' }]);
  await runtime.restoreCheckpoint(1);
  expect(read()).toBe('old\n');
  // A change that changes nothing leaves no checkpoint.
  await runtime.withCheckpoint('nothing', async () => undefined);
  expect(runtime.checkpoints().map((entry) => entry.label)).toEqual(['revert a.txt', 'before restoring checkpoint 1']);
  await runtime.close();
});
