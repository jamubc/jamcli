import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureDir, ensureDirSync, outputJson, pathExists, readJson, readJsonSync, remove, writeJson } from '../fsx.js';

test('the fs helpers read and write JSON as fs-extra did, and make and remove directories', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-fsx-'));
  try {
    const file = path.join(base, 'a.json');
    expect(await pathExists(file)).toBe(false);
    await writeJson(file, { a: 1 }, { spaces: 2 });
    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "a": 1\n}\n');
    expect(await pathExists(file)).toBe(true);
    await writeJson(file, [1]);
    expect(fs.readFileSync(file, 'utf8')).toBe('[1]\n');
    fs.writeFileSync(file, '﻿{"b": true}');
    expect(await readJson(file)).toEqual({ b: true });
    expect(readJsonSync(file)).toEqual({ b: true });
    await expect(readJson(path.join(base, 'absent.json'))).rejects.toThrow();

    await ensureDir(path.join(base, 'x', 'y'));
    ensureDirSync(path.join(base, 'p', 'q'));
    await ensureDir(path.join(base, 'x', 'y'));
    expect(fs.statSync(path.join(base, 'x', 'y')).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(base, 'p', 'q')).isDirectory()).toBe(true);
    await outputJson(path.join(base, 'deep', 'er', 'c.json'), { c: 3 });
    expect(await readJson(path.join(base, 'deep', 'er', 'c.json'))).toEqual({ c: 3 });

    await remove(path.join(base, 'x'));
    await remove(path.join(base, 'never-there'));
    expect(await pathExists(path.join(base, 'x'))).toBe(false);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
