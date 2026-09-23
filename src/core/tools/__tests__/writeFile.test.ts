import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-write-'));
});

afterEach(async () => {
  await fs.remove(projectRoot);
});

const write = (args: Record<string, unknown>) => createBuiltinRegistry().execute('write_file', args, { projectRoot });

test('creates a new file, including missing parent directories', async () => {
  const result = await write({ path: 'src/new/hello.ts', content: 'export const hi = 1;\n' });
  expect(result.success).toBe(true);
  expect(result.output).toContain('Created src/new/hello.ts');
  expect(await fs.readFile(path.join(projectRoot, 'src/new/hello.ts'), 'utf-8')).toBe('export const hi = 1;\n');
});

test('refuses to overwrite an existing file without overwrite', async () => {
  await fs.writeFile(path.join(projectRoot, 'keep.txt'), 'original');
  const result = await write({ path: 'keep.txt', content: 'replaced' });
  expect(result.output).toContain('Refused to overwrite keep.txt');
  expect(await fs.readFile(path.join(projectRoot, 'keep.txt'), 'utf-8')).toBe('original');
});

test('overwrites when asked explicitly', async () => {
  await fs.writeFile(path.join(projectRoot, 'keep.txt'), 'original');
  const result = await write({ path: 'keep.txt', content: 'replaced', overwrite: true });
  expect(result.output).toContain('Overwrote keep.txt');
  expect(await fs.readFile(path.join(projectRoot, 'keep.txt'), 'utf-8')).toBe('replaced');
});

test('refuses to write over a directory', async () => {
  await fs.ensureDir(path.join(projectRoot, 'dir'));
  const result = await write({ path: 'dir', content: 'x', overwrite: true });
  expect(result.output).toContain('is a directory');
});

test('refuses a path outside the project root', async () => {
  const outside = `../escaped-${path.basename(projectRoot)}.txt`;
  const result = await write({ path: outside, content: 'leak' });
  expect(result.success).toBe(false);
  expect(result.output.toLowerCase()).toContain('escapes the project root');
  expect(await fs.pathExists(path.resolve(projectRoot, outside))).toBe(false);
});
