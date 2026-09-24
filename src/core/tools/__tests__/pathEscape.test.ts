import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import { ensureDir, pathExists, remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;
let outsideFile: string;

beforeAll(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-escape-'));
  await ensureDir(path.join(projectRoot, 'inside'));
  outsideFile = path.join(path.dirname(projectRoot), `escaped-${path.basename(projectRoot)}.txt`);
  await fs.promises.writeFile(outsideFile, 'top secret contents');
});

afterAll(async () => {
  await remove(projectRoot);
  await remove(outsideFile);
});

test('read_file rejects a path that escapes the project root', async () => {
  const registry = createBuiltinRegistry();
  const result = await registry.execute(
    'read_file',
    { path: `../${path.basename(outsideFile)}` },
    { projectRoot }
  );

  expect(result.success).toBe(false);
  expect(result.output.toLowerCase()).toContain('escape');
  expect(result.output).not.toContain('top secret');
});

test('a symbolic link inside the project that points outside is refused for reads', async () => {
  const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-outside-'));
  await fs.promises.writeFile(path.join(outsideDir, 'id_rsa'), 'PRIVATE KEY');
  await fs.promises.symlink(outsideDir, path.join(projectRoot, 'inside', 'keys'));
  try {
    const registry = createBuiltinRegistry();
    const result = await registry.execute('read_file', { path: 'inside/keys/id_rsa' }, { projectRoot });
    expect(result.success).toBe(false);
    expect(result.output).toContain('symbolic link');
    expect(result.output).not.toContain('PRIVATE KEY');
  } finally {
    await remove(path.join(projectRoot, 'inside', 'keys'));
    await remove(outsideDir);
  }
});

test('a write through a symbolic link that points outside is refused and nothing is created', async () => {
  const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-outside-'));
  await fs.promises.symlink(outsideDir, path.join(projectRoot, 'inside', 'out'));
  try {
    const registry = createBuiltinRegistry();
    const result = await registry.execute('write_file', { path: 'inside/out/planted.sh', content: 'x' }, { projectRoot });
    expect(result.success).toBe(false);
    expect(result.output).toContain('symbolic link');
    expect(await pathExists(path.join(outsideDir, 'planted.sh'))).toBe(false);
  } finally {
    await remove(path.join(projectRoot, 'inside', 'out'));
    await remove(outsideDir);
  }
});

test('a project root reached through a symbolic link still works', async () => {
  const alias = path.join(os.tmpdir(), `jamcli-alias-${path.basename(projectRoot)}`);
  await fs.promises.symlink(projectRoot, alias);
  try {
    const registry = createBuiltinRegistry();
    const result = await registry.execute('write_file', { path: 'inside/ok.txt', content: 'fine' }, { projectRoot: alias });
    expect(result.success).toBe(true);
    expect(await fs.promises.readFile(path.join(projectRoot, 'inside', 'ok.txt'), 'utf-8')).toBe('fine');
  } finally {
    await remove(alias);
  }
});
