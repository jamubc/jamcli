import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-glob-'));
  await fs.ensureDir(path.join(projectRoot, 'recency'));
  await fs.ensureDir(path.join(projectRoot, 'src'));
  await fs.ensureDir(path.join(projectRoot, 'node_modules'));
});

afterAll(async () => {
  await fs.remove(projectRoot);
});

const listedOrder = (output: string): string[] =>
  output
    .split('\n')
    .filter((line) => /^\d+\.\s/.test(line))
    .map((line) => line.replace(/^\d+\.\s+/, '').split(/\s{2,}/)[0]);

test('glob orders paths by most recently modified', async () => {
  const oldest = path.join(projectRoot, 'recency', 'oldest.ts');
  const middle = path.join(projectRoot, 'recency', 'middle.ts');
  const newest = path.join(projectRoot, 'recency', 'newest.ts');
  await fs.writeFile(oldest, 'oldest');
  await fs.writeFile(middle, 'middle');
  await fs.writeFile(newest, 'newest');
  await fs.utimes(oldest, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
  await fs.utimes(middle, new Date('2021-01-01T00:00:00Z'), new Date('2021-01-01T00:00:00Z'));
  await fs.utimes(newest, new Date('2022-01-01T00:00:00Z'), new Date('2022-01-01T00:00:00Z'));

  const registry = createBuiltinRegistry();
  const result = await registry.execute('glob', { pattern: 'recency/*.ts' }, { projectRoot });

  expect(result.success).toBe(true);
  expect(listedOrder(result.output)).toEqual([
    'recency/newest.ts',
    'recency/middle.ts',
    'recency/oldest.ts',
  ]);
});

test('glob respects the ignore patterns carried on the context', async () => {
  await fs.writeFile(path.join(projectRoot, 'src', 'kept.ts'), 'kept');
  await fs.writeFile(path.join(projectRoot, 'node_modules', 'skipped.ts'), 'skipped');

  const registry = createBuiltinRegistry();
  const result = await registry.execute(
    'glob',
    { pattern: '**/*.ts' },
    { projectRoot, ignorePatterns: ['node_modules/**'] }
  );

  expect(result.success).toBe(true);
  expect(result.output).toContain('src/kept.ts');
  expect(result.output).not.toContain('node_modules/skipped.ts');
});
