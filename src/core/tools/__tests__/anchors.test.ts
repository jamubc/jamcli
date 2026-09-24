import { test, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import { remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';

let projectRoot: string;
let filePath: string;

const anchorsOf = (metadata: Record<string, unknown> | undefined): { line: number; anchor: string }[] =>
  (metadata?.anchors as { line: number; anchor: string }[]) ?? [];

beforeAll(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-anchors-'));
  filePath = path.join(projectRoot, 'file.txt');
});

afterAll(async () => {
  await remove(projectRoot);
});

test('read_file returns a line number and anchor for every requested line', async () => {
  await fs.promises.writeFile(filePath, 'a\nb\nc\n');
  const registry = createBuiltinRegistry();

  const result = await registry.execute('read_file', { path: 'file.txt', start_line: 2, end_line: 3 }, { projectRoot });

  expect(result.success).toBe(true);
  expect(result.output).toMatch(/^2\|[0-9a-f]{12}\|b\n3\|[0-9a-f]{12}\|c$/);
  expect(anchorsOf(result.metadata)).toHaveLength(2);
});

test('an anchor stays stable for unchanged content and changes after an edit', async () => {
  await fs.promises.writeFile(filePath, 'first line\nsecond line\nthird line\n');
  const registry = createBuiltinRegistry();

  const first = await registry.execute('read_file', { path: 'file.txt' }, { projectRoot });
  const firstAnchors = anchorsOf(first.metadata);

  const second = await registry.execute('read_file', { path: 'file.txt' }, { projectRoot });
  const secondAnchors = anchorsOf(second.metadata);
  expect(secondAnchors).toEqual(firstAnchors);

  const line2Before = firstAnchors.find((entry) => entry.line === 2)!.anchor;
  const line1Before = firstAnchors.find((entry) => entry.line === 1)!.anchor;

  const edited = await registry.execute(
    'edit',
    { path: 'file.txt', find_string: 'second line', replace_string: 'changed line' },
    { projectRoot }
  );
  expect(edited.success).toBe(true);

  const third = await registry.execute('read_file', { path: 'file.txt' }, { projectRoot });
  const thirdAnchors = anchorsOf(third.metadata);

  expect(thirdAnchors.find((entry) => entry.line === 2)!.anchor).not.toBe(line2Before);
  expect(thirdAnchors.find((entry) => entry.line === 1)!.anchor).toBe(line1Before);
});
