import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import { remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';
import { replaceLiteral } from '../textEdit.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-literal-'));
});

afterEach(async () => {
  await remove(projectRoot);
});

const registry = () => createBuiltinRegistry();
const file = (name: string) => path.join(projectRoot, name);

const DOLLARS = 'echo "pid=$$ whole=$& before=$` after=$\'"';

test('edit inserts dollar sequences literally', async () => {
  await fs.promises.writeFile(file('run.sh'), '#!/bin/sh\necho PID\n');
  const result = await registry().execute(
    'edit',
    { path: 'run.sh', find_string: 'echo PID', replace_string: DOLLARS },
    { projectRoot }
  );
  expect(result.success).toBe(true);
  expect(await fs.promises.readFile(file('run.sh'), 'utf-8')).toBe(`#!/bin/sh\n${DOLLARS}\n`);
});

test('replace_all replaces every occurrence and reports the count', async () => {
  await fs.promises.writeFile(file('a.txt'), 'x = 1\ny = x\nz = x\n');
  const result = await registry().execute(
    'edit',
    { path: 'a.txt', find_string: 'x', replace_string: 'value', replace_all: true },
    { projectRoot }
  );
  expect(result.success).toBe(true);
  expect(result.output).toContain('Replaced 3 occurrences');
  expect(await fs.promises.readFile(file('a.txt'), 'utf-8')).toBe('value = 1\ny = value\nz = value\n');
});

test('occurrence replaces only the chosen match', async () => {
  await fs.promises.writeFile(file('a.txt'), 'alpha\nbeta\nalpha\n');
  const result = await registry().execute(
    'edit',
    { path: 'a.txt', find_string: 'alpha', replace_string: 'gamma', occurrence: 2 },
    { projectRoot }
  );
  expect(result.success).toBe(true);
  expect(await fs.promises.readFile(file('a.txt'), 'utf-8')).toBe('alpha\nbeta\ngamma\n');
});

test('an occurrence past the last match is refused without writing', async () => {
  await fs.promises.writeFile(file('a.txt'), 'alpha\n');
  const result = await registry().execute(
    'edit',
    { path: 'a.txt', find_string: 'alpha', replace_string: 'gamma', occurrence: 3 },
    { projectRoot }
  );
  expect(result.success).toBe(false);
  expect(result.output).toContain('occurrence 3 does not exist');
  expect(await fs.promises.readFile(file('a.txt'), 'utf-8')).toBe('alpha\n');
});

test('a CRLF file keeps CRLF when the snippet is written with LF', async () => {
  await fs.promises.writeFile(file('win.txt'), 'one\r\ntwo\r\nthree\r\n');
  const result = await registry().execute(
    'edit',
    { path: 'win.txt', find_string: 'one\ntwo', replace_string: 'uno\ndos\ndos-b' },
    { projectRoot }
  );
  expect(result.success).toBe(true);
  expect(await fs.promises.readFile(file('win.txt'), 'utf-8')).toBe('uno\r\ndos\r\ndos-b\r\nthree\r\n');
});

test('an edit reports a unified diff in its metadata', async () => {
  await fs.promises.writeFile(file('a.txt'), 'alpha\nbeta\n');
  const result = await registry().execute(
    'edit',
    { path: 'a.txt', find_string: 'beta', replace_string: 'gamma' },
    { projectRoot }
  );
  expect(String(result.metadata?.diff)).toContain('-beta');
  expect(String(result.metadata?.diff)).toContain('+gamma');
});

test('replaceLiteral reports the lines it changed', () => {
  const result = replaceLiteral('a\nb\nc\n', 'b', 'B1\nB2', 'f');
  expect(result).toMatchObject({ replaced: 1, startLine: 2, endLine: 3, content: 'a\nB1\nB2\nc\n' });
});
