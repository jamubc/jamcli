import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { completeReference, matchReferences, referenceCandidates, referenceToken } from '../references.js';
import type { Runtime } from '../../../core/runtime/index.js';

test('an email address does not start a reference', () => {
  expect(referenceToken('mail a@b')).toBeUndefined();
  expect(referenceToken('see @src')).toBe('src');
});

test('matching puts names that start with the word first, shortest first, then paths that contain it', () => {
  const items = [
    { text: 'asrc.ts', detail: 'file' },
    { text: 'src/a.ts', detail: 'file' },
    { text: 'docs/', detail: 'directory' },
    { text: 'src.ts', detail: 'file' },
    { text: 'src/', detail: 'directory' },
  ];
  expect(matchReferences(items, 'src').map((item) => item.text)).toEqual(['src/', 'src.ts', 'src/a.ts', 'asrc.ts']);
});

test('completing a directory leaves the cursor inside it, and a file appends a space', () => {
  expect(completeReference('see @src', { text: 'src/', detail: 'directory' })).toBe('see @src/');
  expect(completeReference('read @a', { text: 'a.ts', detail: 'file' })).toBe('read @a.ts ');
});

test('a resource listing that fails still leaves the project paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-references-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export {};\n');
    const runtime = {
      workRoot: root,
      mcpResources: async () => {
        throw new Error('the server is down');
      },
    } as unknown as Runtime;
    const texts = (await referenceCandidates(runtime)).map((item) => item.text);
    expect(texts).toContain('src/');
    expect(texts).toContain('src/a.ts');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
