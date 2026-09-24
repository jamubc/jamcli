import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRuntime, type RuntimeOptions } from '../index.js';
import { startFakeProvider, type FakeProviderServer } from '../../../testing/fakeProvider.js';
import type { AgentEvent } from '../../types.js';

let server: FakeProviderServer;
let root: string;

beforeAll(() => {
  server = startFakeProvider();
});
afterAll(() => server.close());

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-runtime-commit-')));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Pat Person');
  git('config', 'user.email', 'pat@example.com');
  fs.writeFileSync(path.join(root, 'a.txt'), 'old\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');
  fs.writeFileSync(path.join(root, 'a.txt'), 'new\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function configure(config: Record<string, unknown>) {
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'), { recursive: true });
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ api_registry: { ollama: { endpoint: server.ollamaBaseUrl } }, sandbox: { enabled: false }, ...config }));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ name: 'Default', preferred_model: 'fake-model' }));
}

const start = (options: Partial<RuntimeOptions> = {}) => createRuntime({ projectRoot: root, surface: 'tui', mcp: false, ...options });
const commit = { id: 'g1', name: 'git_commit', arguments: { message: 'fix(a): say new\n\nThe file said old.', paths: ['a.txt'] } };
const count = () => Number(git('rev-list', '--count', 'HEAD').trim());

/** Run a turn that commits, answering its prompt with `allow`, and return what was asked. */
async function run(runtime: Awaited<ReturnType<typeof start>>, allow: boolean) {
  const asked: Extract<AgentEvent, { type: 'approval_request' }>[] = [];
  // A person's denial ends the turn, so the reply after the call is queued only when it runs.
  server.enqueue({ toolCalls: [commit] }, ...(allow ? [{ text: 'Done.' }] : []));
  await runtime.run('commit it', (event) => {
    if (event.type !== 'approval_request') return;
    asked.push(event);
    event.decide({ allow, scope: 'once' });
  });
  return asked;
}

test('a commit asks every time, with the message, the files, and the diffstat, even where a rule and the mode would allow it', async () => {
  configure({ permissions: { mode: 'accept-edits', allow: ['git_commit'] } });
  const runtime = await start();
  const [first] = await run(runtime, false);
  expect(first.request!.reason).toBe('a commit is always asked for; no rule or mode allows one ahead');
  expect(first.request!.suggestions).toEqual([]);
  expect(first.request!.preview?.text).toContain('fix(a): say new');
  expect(first.request!.preview?.text).toContain('M a.txt');
  expect(first.request!.preview?.text).toContain('1 file changed');
  // Asked and refused: nothing was committed, and nothing was staged either.
  expect(count()).toBe(1);
  expect(git('diff', '--cached')).toBe('');

  const [second] = await run(runtime, true);
  expect(second).toBeDefined();
  expect(count()).toBe(2);
  expect(git('log', '-1', '--format=%an|%s')).toBe('Pat Person|fix(a): say new\n');
  await runtime.close();
});

test('bypass mode asks too, unless git.allow_commit_in_bypass says otherwise; a deny rule stops it', async () => {
  configure({});
  const bypass = await start({ bypassPermissions: true });
  expect(await run(bypass, false)).toHaveLength(1);
  await bypass.close();

  configure({ git: { allow_commit_in_bypass: true } });
  const allowed = await start({ bypassPermissions: true });
  expect(await run(allowed, false)).toHaveLength(0);
  expect(count()).toBe(2);
  await allowed.close();

  fs.writeFileSync(path.join(root, 'a.txt'), 'newer\n');
  configure({ permissions: { deny: ['git_commit'] } });
  const denied = await start();
  expect(await run(denied, true)).toHaveLength(0);
  expect(count()).toBe(2);
  await denied.close();
});

test('a commit carries a trailer only when git.attribution names one', async () => {
  configure({ git: { attribution: 'Reviewed-by: Sam <sam@example.com>' } });
  const runtime = await start();
  await run(runtime, true);
  expect(git('log', '-1', '--format=%B')).toContain('Reviewed-by: Sam <sam@example.com>');
  await runtime.close();
});
