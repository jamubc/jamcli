import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import { remove } from '../../../utils/fsx.js';
import os from 'os';
import path from 'path';
import { createBuiltinRegistry } from '../registry.js';
import { lineAnchor } from '../anchors.js';

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jamcli-toolset-'));
});

afterEach(async () => {
  await remove(projectRoot);
});

const exec = (tool: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  createBuiltinRegistry().execute(tool, args, { projectRoot, ignorePatterns: [], ...extra });

test('read_file returns a window and says where to continue', async () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
  await fs.promises.writeFile(path.join(projectRoot, 'long.txt'), `${lines.join('\n')}\n`);
  const result = await exec('read_file', { path: 'long.txt', offset: 11, limit: 5 });
  expect(result.output.split('\n').slice(0, 5)).toEqual(
    lines.slice(10, 15).map((text, i) => `${11 + i}|${lineAnchor(text)}|${text}`)
  );
  expect(result.output).toContain('[Showing lines 11-15 of 50. Continue with offset 16.]');
  expect(result.metadata?.totalLines).toBe(50);
});

test('read_file stops at its output budget and reports the next offset', async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `${'x'.repeat(80)} ${i}`);
  await fs.promises.writeFile(path.join(projectRoot, 'wide.txt'), lines.join('\n'));
  const result = await exec('read_file', { path: 'wide.txt' }, { maxOutputChars: 2_000 });
  expect(result.output.length).toBeLessThan(2_300);
  expect(result.output).toMatch(/Continue with offset \d+\.\]/);
});

test('read_file cuts a very long line for display but anchors its full content', async () => {
  const long = 'y'.repeat(5_000);
  await fs.promises.writeFile(path.join(projectRoot, 'min.js'), `${long}\nshort\n`);
  const result = await exec('read_file', { path: 'min.js' });
  expect(result.output).toContain('[line cut at 2000 characters]');
  expect(result.output).toContain(`1|${lineAnchor(long)}|`);
  expect(result.output).toContain('[1 long line was cut for display.]');
});

test('read_file refuses a binary file and names its size', async () => {
  await fs.promises.writeFile(path.join(projectRoot, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
  const result = await exec('read_file', { path: 'image.png' });
  expect(result.output).toContain('is a binary file (5 bytes)');
});

test('read_file reports an empty file plainly', async () => {
  await fs.promises.writeFile(path.join(projectRoot, 'empty.txt'), '');
  const result = await exec('read_file', { path: 'empty.txt' });
  expect(result.output).toBe('empty.txt is empty.');
});
