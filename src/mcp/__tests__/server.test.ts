import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import type { ElicitationRequest } from '../../core/mcp/connect.js';
import { serverFixture } from './fixture.js';

const { context, serve, commitReady } = serverFixture();

test('a host delegates an edit: the session waits on its approval, the host answers, and the turn finishes', async () => {
  const { call, start } = await serve();
  const session = await start();
  context.provider.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'Changed it.' });
  const asked = await call('session_send', { session, text: 'change a.txt' });
  expect(asked.report).toMatchObject({ status: 'waiting', waiting: { kind: 'approval', tool: 'edit', personOnly: false } });
  expect(asked.text).toContain('Answer with session_answer');
  const done = await call('session_answer', { session, approval: 'allow_once' });
  expect(done.report).toMatchObject({ status: 'idle', ended: 'ok' });
  expect(done.text).toContain('+new');
  expect(done.text).toContain('Changed it.');
  expect(fs.readFileSync(path.join(context.project, 'a.txt'), 'utf8')).toBe('new\n');
}, 60_000);

test('a command runs as a person would run it, and its list is answered by the host', async () => {
  const { call, start } = await serve();
  const session = await start();
  const before = context.provider.completions().length;
  const shown = await call('session_send', { session, text: '/context' });
  expect(shown.report.status).toBe('idle');
  expect(shown.text).toContain('Context:');
  expect(context.provider.completions().length).toBe(before);
  const offered = await call('session_send', { session, text: '/effort' });
  expect(offered.report).toMatchObject({ status: 'waiting', waiting: { kind: 'choice', personOnly: false } });
  const chosen = await call('session_answer', { session, choice: 'low' });
  expect(chosen.report.status).toBe('idle');
  expect(chosen.text).toContain('Later turns');
  expect(JSON.parse(fs.readFileSync(path.join(context.base, 'user', 'config.json'), 'utf8')).effort).toBe('low');
}, 60_000);

test("a commit is the person's: the host cannot answer it, and the person is asked in their own host", async () => {
  const asked: ElicitationRequest[] = [];
  const { call, start } = await serve(async (request) => {
    asked.push(request);
    return { action: 'accept', content: { answer: 'allow' } };
  });
  const session = await start();
  const log = commitReady();
  const done = await call('session_send', { session, text: 'commit it' });
  expect(asked).toHaveLength(1);
  expect(asked[0].message).toContain('asks you, not the agent driving it');
  expect(done.report).toMatchObject({ status: 'idle', ended: 'ok' });
  expect(log()).toBe('feat: add a');
}, 60_000);

test("the person's no, or a host that cannot ask, is a denial the agent cannot overrule", async () => {
  const { call, start } = await serve(async () => ({ action: 'decline' }));
  const session = await start();
  const log = commitReady();
  const done = await call('session_send', { session, text: 'commit it' });
  expect(done.report.status).toBe('idle');
  expect(log()).toBe('');

  await context.connection!.client.close();
  const nobody = await serve();
  const second = await nobody.start();
  commitReady();
  const denied = await nobody.call('session_send', { session: second, text: 'commit it' });
  expect(denied.report.status).toBe('idle');
  expect(log()).toBe('');
}, 90_000);

test("the host is refused an answer that is the person's, and a session it does not have", async () => {
  const asked: ElicitationRequest[] = [];
  const { call, start } = await serve(async (request) => {
    asked.push(request);
    return { action: 'decline' };
  });
  const session = await start();
  const log = commitReady();
  // The call returns at once, so the commit's approval arrives with no call waiting on it.
  expect((await call('session_send', { session, text: 'commit it', wait_ms: 0 })).report.status).toBe('running');
  await Bun.sleep(1_500);
  const refused = await call('session_answer', { session, approval: 'allow_once' });
  expect(refused).toMatchObject({ error: true, text: expect.stringContaining('Only the person answers this') });
  // The next call that waits puts it to the person, whose no stands.
  const after = await call('session_state', { session, wait_ms: 30_000 });
  expect(asked).toHaveLength(1);
  expect(after.report.status).toBe('idle');
  expect(log()).toBe('');

  expect(await call('session_answer', { session: 'nope', approval: 'allow_once' })).toMatchObject({ error: true, text: expect.stringContaining('No session nope') });
  expect((await call('session_start', { cwd: 'relative/dir' })).error).toBe(true);
}, 60_000);

test("/commit's confirmation is the person's too: the caller cannot say yes to it, and the person is asked", async () => {
  const asked: ElicitationRequest[] = [];
  const { call, start } = await serve(async (request) => {
    asked.push(request);
    return { action: 'accept', content: { answer: 'commit' } };
  });
  const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: context.project });
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('add', 'a.txt');
  const session = await start();
  const done = await call('session_send', { session, text: '/commit add a' });
  expect(asked).toHaveLength(1);
  expect(asked[0].message).toContain('Commit this?');
  expect(done.text).not.toContain('Answer with /choose');
  expect(new TextDecoder().decode(git('log', '--format=%s').stdout).trim()).toBe('add a');
}, 60_000);

test('allow_session grants a pattern the call offers, which covers later calls, and nothing it does not offer', async () => {
  const { call, start } = await serve();
  const session = await start();
  context.provider.enqueue({ toolCalls: [{ id: 'r1', name: 'run_command', arguments: { command: 'ls -la' } }] }, { text: 'Listed.' });
  const asked = await call('session_send', { session, text: 'list the files' });
  expect(asked.report.waiting.suggestions).toContain('run_command(ls *)');
  expect(asked.text).toContain('run_command(ls *)');
  const refused = await call('session_answer', { session, approval: 'allow_session', pattern: 'run_command(*)' });
  expect(refused.error).toBe(true);
  expect(refused.text).toContain('run_command(ls *)');
  expect((await call('session_answer', { session, approval: 'allow_session', pattern: 'run_command(ls *)' })).report.status).toBe('idle');
  context.provider.enqueue({ toolCalls: [{ id: 'r2', name: 'run_command', arguments: { command: 'ls a.txt' } }] }, { text: 'Listed again.' });
  const again = await call('session_send', { session, text: 'list a.txt' });
  expect(again.report).toMatchObject({ status: 'idle', ended: 'ok' });
  expect(again.text).toContain('Listed again.');
}, 60_000);
