import { test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;
let filePath: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-ambiguous-'));
  filePath = path.join(projectRoot, 'notes.txt');
});

afterEach(async () => {
  await fs.remove(projectRoot);
});

test('an ambiguous find is rejected with the match count and the file is unchanged', async () => {
  await fs.writeFile(filePath, 'alpha\nbeta\nalpha\n');
  const registry = createBuiltinRegistry();

  const result = await registry.execute(
    'apply_patch',
    { path: 'notes.txt', find_string: 'alpha', replace_string: 'gamma' },
    { projectRoot }
  );

  expect(result.success).toBe(false);
  expect(result.output).toContain('2');
  expect(await fs.readFile(filePath, 'utf-8')).toBe('alpha\nbeta\nalpha\n');
});

test('an unambiguous find is applied to the file', async () => {
  await fs.writeFile(filePath, 'alpha\nbeta\n');
  const registry = createBuiltinRegistry();

  const result = await registry.execute(
    'apply_patch',
    { path: 'notes.txt', find_string: 'beta', replace_string: 'gamma' },
    { projectRoot }
  );

  expect(result.success).toBe(true);
  expect(await fs.readFile(filePath, 'utf-8')).toBe('alpha\ngamma\n');
});
