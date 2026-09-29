import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import type { ElicitationRequest } from '../../core/mcp/connect.js';
import { serverFixture } from './fixture.js';

const { context, serve, commitReady } = serverFixture();

/** The terminal's report: its screen and what the interface is doing. */
const screenOf = (result: { report: any }) => result.report.screen as string;

test('an agent uses the interface itself: it types, reads the reply on screen, and answers an approval with a key', async () => {
  const { call } = await serve();
  const started = await call('terminal_start', { cwd: context.project, cols: 100, rows: 30 });
  expect(started.report.state).toBe('idle');
  expect(screenOf(started)).toContain('Message JamCLI');

  context.provider.enqueue({ text: 'Hello there.' });
  const replied = await call('terminal_type', { terminal: 't1', text: 'hi' });
  expect(screenOf(replied)).toContain('Hello there.');

  context.provider.enqueue({ toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'a.txt', find_string: 'old', replace_string: 'new' } }] }, { text: 'Changed it.' });
  const asking = await call('terminal_type', { terminal: 't1', text: 'change a.txt' });
  expect(asking.report).toMatchObject({ state: 'requires_action', waitingOn: { tool: 'edit', alwaysAsks: false } });
  expect(screenOf(asking)).toContain('Allow edit a.txt?');
  const allowed = await call('terminal_keys', { terminal: 't1', keys: ['1'] });
  expect(screenOf(allowed)).toContain('Changed it.');
  expect(fs.readFileSync(path.join(context.project, 'a.txt'), 'utf8')).toBe('new\n');

  const stopped = await call('terminal_stop', { terminal: 't1' });
  const recording = /Its recording is (\S+) /.exec(stopped.text)![1];
  const lines = fs.readFileSync(recording, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  expect(lines[0]).toMatchObject({ version: 2, width: 100, height: 30 });
  expect(lines.filter((event) => event[1] === 'i').map((event) => event[2]).join('')).toContain('change a.txt');
}, 90_000);

test('a question the model puts to the person shows as waiting for an answer, named as a question', async () => {
  const { call } = await serve();
  await call('terminal_start', { cwd: context.project, cols: 100, rows: 30 });
  context.provider.enqueue({ toolCalls: [{ id: 'q1', name: 'ask_user', arguments: { question: 'Which colour?', choices: ['red', 'blue'] } }] }, { text: 'Noted.' });
  const asking = await call('terminal_type', { terminal: 't1', text: 'ask me' });
  expect(asking.report).toMatchObject({ state: 'requires_action', waitingOn: { tool: 'ask_user', alwaysAsks: false, question: true } });
  expect(asking.text).toContain('a question from ask_user');
  expect(screenOf(asking)).toContain('Which colour?');
  const cancelled = await call('terminal_keys', { terminal: 't1', keys: ['escape'] });
  expect(screenOf(cancelled)).toContain('Noted.');
}, 90_000);

test("keys meant for a call only the person answers are not sent: the person is asked, and their answer is typed", async () => {
  const asked: ElicitationRequest[] = [];
  const { call } = await serve(async (request) => {
    asked.push(request);
    return { action: 'accept', content: { answer: 'deny' } };
  });
  const log = commitReady();
  await call('terminal_start', { cwd: context.project, cols: 100, rows: 30 });
  const waiting = await call('terminal_type', { terminal: 't1', text: 'commit it' });
  expect(waiting.report).toMatchObject({ state: 'requires_action', waitingOn: { tool: 'git_commit', alwaysAsks: true } });
  expect(waiting.text).toContain('they are asked, not you');
  const answered = await call('terminal_keys', { terminal: 't1', keys: ['1'] });
  expect(asked).toHaveLength(1);
  expect(asked[0].message).toContain('asks you, not the agent driving it');
  expect(answered.text).toContain('did not allow it; your input was not sent');
  expect(log()).toBe('');
}, 90_000);

test('the terminal resizes, and names a key it does not know', async () => {
  const { call } = await serve();
  await call('terminal_start', { cwd: context.project, cols: 100, rows: 30 });
  const resized = await call('terminal_resize', { terminal: 't1', cols: 70, rows: 20 });
  expect(resized.report.size).toEqual({ cols: 70, rows: 20 });
  expect(Math.max(...screenOf(resized).split('\n').map((line) => line.length))).toBeLessThanOrEqual(70);
  expect(await call('terminal_keys', { terminal: 't1', keys: ['hyper+q'] })).toMatchObject({ error: true, text: expect.stringContaining('Not keys: hyper+q') });
}, 60_000);

test('a jamcli that has exited says so, with what it last showed, and takes nothing more', async () => {
  const { call } = await serve();
  const started = await call('terminal_start', { cwd: context.project, args: ['--no-such-option'], cols: 80, rows: 10 });
  expect(started.report.state).toBe('exited');
  expect(started.report.screen).toContain('Unknown option: --no-such-option');
  const typed = await call('terminal_type', { terminal: 't1', text: 'hello' });
  expect(typed).toMatchObject({ error: true, text: expect.stringContaining('jamcli has exited, so nothing was sent.') });
}, 60_000);
