import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import fs from 'fs';
import { remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';
import { StaleAnchorError, editRunner } from '../edit.js';
import type { ToolContext } from '../../../types/tools.js';

let projectRoot: string;
let filePath: string;

const anchorsOf = (metadata: Record<string, unknown> | undefined): { line: number; anchor: string }[] =>
  (metadata?.anchors as { line: number; anchor: string }[]) ?? [];

beforeAll(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-edit-'));
  filePath = path.join(projectRoot, 'file.txt');
});

afterAll(async () => {
  await remove(projectRoot);
});

beforeEach(async () => {
  await fs.promises.writeFile(filePath, 'alpha\nbeta\nalpha\n');
});

test('an ambiguous find is rejected with the match count and never edits', async () => {
  const registry = createBuiltinRegistry();

  const result = await registry.execute(
    'edit',
    { path: 'file.txt', find_string: 'alpha', replace_string: 'gamma' },
    { projectRoot }
  );

  expect(result.success).toBe(false);
  expect(result.output).toContain('2');
  expect(result.output.toLowerCase()).toContain('ambiguous');
  expect(await fs.promises.readFile(filePath, 'utf-8')).toBe('alpha\nbeta\nalpha\n');
});

test('a unique find is applied', async () => {
  const registry = createBuiltinRegistry();

  const result = await registry.execute(
    'edit',
    { path: 'file.txt', find_string: 'beta', replace_string: 'gamma' },
    { projectRoot }
  );

  expect(result.success).toBe(true);
  expect(await fs.promises.readFile(filePath, 'utf-8')).toBe('alpha\ngamma\nalpha\n');
});

test('an anchored edit with matching anchors is applied', async () => {
  const registry = createBuiltinRegistry();
  const read = await registry.execute('read_file', { path: 'file.txt' }, { projectRoot });

  const result = await registry.execute(
    'edit',
    { path: 'file.txt', find_string: 'beta', replace_string: 'gamma', anchors: anchorsOf(read.metadata) },
    { projectRoot }
  );

  expect(result.success).toBe(true);
  expect(await fs.promises.readFile(filePath, 'utf-8')).toBe('alpha\ngamma\nalpha\n');
});

test('a stale anchor is rejected, the file is left byte-identical, and fresh anchors are returned', async () => {
  const registry = createBuiltinRegistry();
  const read = await registry.execute('read_file', { path: 'file.txt' }, { projectRoot });
  const anchors = anchorsOf(read.metadata);

  // An external change lands on line 2 after the read.
  await fs.promises.writeFile(filePath, 'alpha\nEXTERNAL\nalpha\n');
  const before = await fs.promises.readFile(filePath);

  const ctx: ToolContext = { projectRoot };
  let thrown: unknown;
  try {
    await editRunner({ path: 'file.txt', find_string: 'EXTERNAL', replace_string: 'mine', anchors }, ctx);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(StaleAnchorError);
  const stale = thrown as StaleAnchorError;
  expect(stale.mismatches).toHaveLength(1);
  expect(stale.mismatches[0].line).toBe(2);
  expect(stale.freshAnchors).toHaveLength(anchors.length);
  expect(stale.freshAnchors.find((entry) => entry.line === 2)!.anchor).not.toBe(
    anchors.find((entry) => entry.line === 2)!.anchor
  );
  expect(await fs.promises.readFile(filePath)).toEqual(before);
});
