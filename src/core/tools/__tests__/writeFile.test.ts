import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import { ensureDir, pathExists, remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-write-'));
});

afterEach(async () => {
  await remove(projectRoot);
});

const write = (args: Record<string, unknown>) => createBuiltinRegistry().execute('write_file', args, { projectRoot });

test('creates a new file, including missing parent directories', async () => {
  const result = await write({ path: 'src/new/hello.ts', content: 'export const hi = 1;\n' });
  expect(result.success).toBe(true);
  expect(result.output).toContain('Created src/new/hello.ts');
  expect(await fs.promises.readFile(path.join(projectRoot, 'src/new/hello.ts'), 'utf-8')).toBe('export const hi = 1;\n');
});

test('refuses to overwrite an existing file without overwrite', async () => {
  await fs.promises.writeFile(path.join(projectRoot, 'keep.txt'), 'original');
  const result = await write({ path: 'keep.txt', content: 'replaced' });
  expect(result.output).toContain('Refused to overwrite keep.txt');
  expect(await fs.promises.readFile(path.join(projectRoot, 'keep.txt'), 'utf-8')).toBe('original');
});

test('overwrites when asked explicitly', async () => {
  await fs.promises.writeFile(path.join(projectRoot, 'keep.txt'), 'original');
  const result = await write({ path: 'keep.txt', content: 'replaced', overwrite: true });
  expect(result.output).toContain('Overwrote keep.txt');
  expect(await fs.promises.readFile(path.join(projectRoot, 'keep.txt'), 'utf-8')).toBe('replaced');
});

test('refuses to write over a directory', async () => {
  await ensureDir(path.join(projectRoot, 'dir'));
  const result = await write({ path: 'dir', content: 'x', overwrite: true });
  expect(result.output).toContain('is a directory');
});

test('refuses a path outside the project root', async () => {
  const outside = `../escaped-${path.basename(projectRoot)}.txt`;
  const result = await write({ path: outside, content: 'leak' });
  expect(result.success).toBe(false);
  expect(result.output.toLowerCase()).toContain('escapes the project root');
  expect(await pathExists(path.resolve(projectRoot, outside))).toBe(false);
});

test("in an editor that lends its files, writes land in the editor's copy and reads see it", async () => {
  // The editor holds unsaved text for a.txt; the disk has the saved text.
  await fs.promises.writeFile(path.join(projectRoot, 'a.txt'), 'saved\n');
  const buffers = new Map<string, string>([[path.join(projectRoot, 'a.txt'), 'unsaved\n']]);
  const editor = {
    readText: async (file: string) => buffers.get(file) ?? fs.promises.readFile(file, 'utf-8'),
    writeText: async (file: string, content: string) => void buffers.set(file, content),
  };
  const registry = createBuiltinRegistry();
  const run = (name: string, args: Record<string, unknown>) => registry.execute(name, args, { projectRoot, editor });

  expect((await run('read_file', { path: 'a.txt' })).output).toContain('unsaved');
  expect((await run('write_file', { path: 'a.txt', content: 'written\n', overwrite: true })).success).toBe(true);
  const patch = ['--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-written', '+patched', ''].join('\n');
  expect((await run('apply_patch', { patch })).success).toBe(true);
  expect((await run('edit', { path: 'a.txt', find_string: 'patched', replace_string: 'edited' })).success).toBe(true);

  // Each change built on the editor's copy, and the disk was left for the editor to save.
  expect(buffers.get(path.join(projectRoot, 'a.txt'))).toBe('edited\n');
  expect(await fs.promises.readFile(path.join(projectRoot, 'a.txt'), 'utf-8')).toBe('saved\n');
});
