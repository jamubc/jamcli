import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import { ensureDir, remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-grep-'));
  await fs.promises.writeFile(path.join(projectRoot, 'sample.txt'), 'alpha\nbeta\nGAMMA\ngamma\nomega\n');
  await fs.promises.writeFile(path.join(projectRoot, 'other.md'), 'nothing here\n');
  await ensureDir(path.join(projectRoot, 'node_modules'));
  await fs.promises.writeFile(path.join(projectRoot, 'node_modules', 'ignored.txt'), 'beta in ignored dir\n');
});

afterAll(async () => {
  await remove(projectRoot);
});

test('grep returns matches with surrounding context lines', async () => {
  const registry = createBuiltinRegistry();
  const result = await registry.execute('grep', { pattern: 'beta', context: 1, glob: '*.txt' }, { projectRoot });

  expect(result.success).toBe(true);
  expect(result.output).toContain('sample.txt-1-alpha');
  expect(result.output).toContain('sample.txt:2:beta');
  expect(result.output).toContain('sample.txt-3-GAMMA');
});

test('grep is case sensitive by default', async () => {
  const registry = createBuiltinRegistry();
  const result = await registry.execute('grep', { pattern: 'gamma', glob: '*.txt' }, { projectRoot });

  expect(result.success).toBe(true);
  expect(result.output).toContain('sample.txt:4:gamma');
  expect(result.output).not.toContain('GAMMA');
});

test('grep honors the case sensitivity flag', async () => {
  const registry = createBuiltinRegistry();
  const result = await registry.execute(
    'grep',
    { pattern: 'gamma', case_sensitive: false, glob: '*.txt' },
    { projectRoot }
  );

  expect(result.success).toBe(true);
  expect(result.output).toContain('sample.txt:3:GAMMA');
  expect(result.output).toContain('sample.txt:4:gamma');
});

test('grep applies the file pattern filter', async () => {
  const registry = createBuiltinRegistry();
  const result = await registry.execute('grep', { pattern: 'nothing', glob: '*.md' }, { projectRoot });

  expect(result.success).toBe(true);
  expect(result.output).toContain('other.md:1:nothing here');
  expect(result.output).not.toContain('sample.txt');
});

test('grep respects the ignore patterns carried on the context', async () => {
  const registry = createBuiltinRegistry();
  const result = await registry.execute(
    'grep',
    { pattern: 'beta', glob: '**/*.txt' },
    { projectRoot, ignorePatterns: ['node_modules/**'] }
  );

  expect(result.success).toBe(true);
  expect(result.output).toContain('sample.txt:2:beta');
  expect(result.output).not.toContain('ignored');
});
