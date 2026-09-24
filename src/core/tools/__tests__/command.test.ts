import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import { pathExists, remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';
import { HeadTailBuffer } from '../command.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-command-'));
});

afterEach(async () => {
  await remove(projectRoot);
});

const run = (args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  createBuiltinRegistry().execute('run_command', args, { projectRoot, ...extra });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a successful command reports exit code 0 and its output', async () => {
  const result = await run({ command: 'echo hello' });
  expect(result.success).toBe(true);
  expect(result.status).toBe('ok');
  expect(result.output).toContain('Exit code 0');
  expect(result.output).toContain('hello');
});

test('a failing command reports its exit code with stdout and stderr labeled', async () => {
  const result = await run({ command: 'echo out; echo err 1>&2; exit 3' });
  expect(result.success).toBe(false);
  expect(result.status).toBe('error');
  expect(result.output).toContain('Exit code 3');
  expect(result.output).toContain('stdout:\nout');
  expect(result.output).toContain('stderr:\nerr');
});

test('a timed out command is stopped with its whole process group', async () => {
  const started = Date.now();
  const result = await run({ command: '(sleep 1; echo leaked > leak.txt) & sleep 30', timeout_ms: 300 });
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(result.status).toBe('timeout');
  expect(result.output).toContain('Timed out');
  await sleep(1_500);
  expect(await pathExists(path.join(projectRoot, 'leak.txt'))).toBe(false);
});

test('cancelling stops the command and reports it as cancelled', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 200);
  const started = Date.now();
  const result = await run({ command: 'sleep 30' }, { signal: controller.signal });
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(result.status).toBe('cancelled');
});

test('long output keeps its beginning and end and says how much was cut', async () => {
  const result = await run({ command: 'seq 1 20000' }, { maxOutputChars: 1_000 });
  expect(result.output).toContain('characters removed');
  expect(result.output).toContain('\n1\n2\n3\n');
  expect(result.output.trimEnd().endsWith('20000')).toBe(true);
  expect(result.output.length).toBeLessThan(2_000);
});

test('output is streamed while the command runs', async () => {
  const chunks: string[] = [];
  await run({ command: 'echo one; sleep 0.1; echo two' }, { onProgress: (chunk: string) => chunks.push(chunk) });
  expect(chunks.join('')).toContain('one');
  expect(chunks.join('')).toContain('two');
});

test('a command waiting on stdin gets end of input instead of hanging', async () => {
  const result = await run({ command: 'cat; echo after-cat', timeout_ms: 5_000 });
  expect(result.status).toBe('ok');
  expect(result.output).toContain('after-cat');
});

test('a working directory outside the project is refused', async () => {
  const result = await run({ command: 'pwd', cwd: '..' });
  expect(result.success).toBe(false);
  expect(result.output).toContain('escapes the project root');
});

test('a background command returns a job whose output and exit can be read later', async () => {
  const registry = createBuiltinRegistry();
  const started = await registry.execute('run_command', { command: 'sleep 0.2; echo ready', background: true }, { projectRoot });
  const jobId = String(started.metadata?.jobId);
  expect(started.output).toContain(jobId);
  await sleep(600);
  const output = await registry.execute('command_output', { job_id: jobId }, { projectRoot });
  expect(output.output).toContain('ready');
  expect(output.output).toContain('exited with code 0');
});

test('command_kill stops a running background command', async () => {
  const registry = createBuiltinRegistry();
  const started = await registry.execute('run_command', { command: 'sleep 30', background: true }, { projectRoot });
  const jobId = String(started.metadata?.jobId);
  await registry.execute('command_kill', { job_id: jobId }, { projectRoot });
  await sleep(300);
  const output = await registry.execute('command_output', { job_id: jobId }, { projectRoot });
  expect(output.output).toContain('ended by signal');
});

test('HeadTailBuffer keeps both ends within its limit', () => {
  const buffer = new HeadTailBuffer(10);
  buffer.push('abcdefghij');
  buffer.push('klmnopqrst');
  expect(buffer.length).toBe(20);
  expect(buffer.removed).toBe(10);
  expect(buffer.toString()).toBe('abcde\n… [10 characters removed] …\npqrst');
});
