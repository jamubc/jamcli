import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;
let outsideFile: string;

beforeAll(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jamcli-escape-'));
  await fs.ensureDir(path.join(projectRoot, 'inside'));
  outsideFile = path.join(path.dirname(projectRoot), `escaped-${path.basename(projectRoot)}.txt`);
  await fs.writeFile(outsideFile, 'top secret contents');
});

afterAll(async () => {
  await fs.remove(projectRoot);
  await fs.remove(outsideFile);
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

test('apply_patch refuses a path outside the project root and leaves the file untouched', async () => {
  const registry = createBuiltinRegistry();
  const result = await registry.execute(
    'apply_patch',
    { path: `../${path.basename(outsideFile)}`, find_string: 'top secret contents', replace_string: 'leaked' },
    { projectRoot }
  );

  expect(result.success).toBe(false);
  expect(result.output.toLowerCase()).toContain('escape');
  expect(await fs.readFile(outsideFile, 'utf-8')).toBe('top secret contents');
});
