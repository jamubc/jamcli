import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import { pathExists, remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-patch-'));
});

afterEach(async () => {
  await remove(projectRoot);
});

const file = (name: string) => path.join(projectRoot, name);
const patch = (text: string) => createBuiltinRegistry().execute('apply_patch', { patch: text }, { projectRoot });

test('applies a patch that touches two files', async () => {
  await fs.promises.writeFile(file('a.txt'), 'one\ntwo\nthree\n');
  await fs.promises.writeFile(file('b.txt'), 'alpha\nbeta\n');
  const result = await patch(
    [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1,2 +1,3 @@',
      ' alpha',
      ' beta',
      '+gamma',
      '',
    ].join('\n')
  );
  expect(result.success).toBe(true);
  expect(result.output).toContain('M a.txt (+1 -1)');
  expect(result.output).toContain('M b.txt (+1 -0)');
  expect(await fs.promises.readFile(file('a.txt'), 'utf-8')).toBe('one\nTWO\nthree\n');
  expect(await fs.promises.readFile(file('b.txt'), 'utf-8')).toBe('alpha\nbeta\ngamma\n');
});

test('writes nothing when any hunk fails to apply', async () => {
  await fs.promises.writeFile(file('a.txt'), 'one\ntwo\n');
  await fs.promises.writeFile(file('b.txt'), 'alpha\n');
  const result = await patch(
    [
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '+TWO',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1,1 +1,1 @@',
      '-not what the file says',
      '+changed',
      '',
    ].join('\n')
  );
  expect(result.success).toBe(false);
  expect(result.output).toContain('does not apply to b.txt');
  expect(result.output).toContain('Nothing was written');
  expect(await fs.promises.readFile(file('a.txt'), 'utf-8')).toBe('one\ntwo\n');
});

test('creates and deletes files through /dev/null', async () => {
  await fs.promises.writeFile(file('old.txt'), 'bye\n');
  const result = await patch(
    [
      '--- /dev/null',
      '+++ b/src/new.txt',
      '@@ -0,0 +1,1 @@',
      '+hello',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-bye',
      '',
    ].join('\n')
  );
  expect(result.success).toBe(true);
  expect(await fs.promises.readFile(file('src/new.txt'), 'utf-8')).toBe('hello\n');
  expect(await pathExists(file('old.txt'))).toBe(false);
});

test('inserts dollar sequences literally and keeps CRLF line endings', async () => {
  await fs.promises.writeFile(file('run.cmd'), 'echo PID\r\nexit\r\n');
  const result = await patch(
    ['--- a/run.cmd', '+++ b/run.cmd', '@@ -1,2 +1,2 @@', '-echo PID', '+echo "pid=$$ match=$&"', ' exit', ''].join('\n')
  );
  expect(result.success).toBe(true);
  expect(await fs.promises.readFile(file('run.cmd'), 'utf-8')).toBe('echo "pid=$$ match=$&"\r\nexit\r\n');
});

test('refuses a patch whose file lies outside the project', async () => {
  const outside = path.join(path.dirname(projectRoot), `patch-outside-${path.basename(projectRoot)}.txt`);
  await fs.promises.writeFile(outside, 'secret\n');
  try {
    const result = await patch(
      [`--- a/../${path.basename(outside)}`, `+++ b/../${path.basename(outside)}`, '@@ -1,1 +1,1 @@', '-secret', '+leaked', ''].join('\n')
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain('escapes the project root');
    expect(await fs.promises.readFile(outside, 'utf-8')).toBe('secret\n');
  } finally {
    await remove(outside);
  }
});

test('refuses to create a file that already exists', async () => {
  await fs.promises.writeFile(file('here.txt'), 'x\n');
  const result = await patch(['--- /dev/null', '+++ b/here.txt', '@@ -0,0 +1,1 @@', '+y', ''].join('\n'));
  expect(result.success).toBe(false);
  expect(result.output).toContain('already exists');
});
