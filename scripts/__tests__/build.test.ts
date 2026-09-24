import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { JAMCLI_VERSION } from '../../src/core/version.js';

const repo = path.resolve(import.meta.dir, '../..');

test('the build is a Bun command: one entry that runs by itself, and its lazily loaded parts in chunks', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-build-'));
  try {
    const build = Bun.spawnSync(['bun', path.join(repo, 'scripts', 'build.ts'), out], { cwd: repo });
    expect(build.exitCode).toBe(0);
    const entry = path.join(out, 'index.js');
    const source = fs.readFileSync(entry, 'utf8');
    expect(source.startsWith('#!/usr/bin/env bun\n')).toBe(true);
    expect(fs.statSync(entry).mode & 0o111).not.toBe(0);
    // A shebang is valid only on the file that is run.
    const chunks = fs.readdirSync(path.join(out, 'chunks'));
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(fs.readFileSync(path.join(out, 'chunks', chunk), 'utf8')).not.toContain('#!/usr/bin/env');
    // The entry reads its arguments before it loads anything else.
    expect(source).not.toMatch(/^import .* from "\.\/chunks\//m);
    // Dependencies stay in node_modules rather than in the bundle.
    expect(source + chunks.map((chunk) => fs.readFileSync(path.join(out, 'chunks', chunk), 'utf8')).join('')).toMatch(/from "@opentui\/core"/);
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(out, 'node_modules'));
    const version = Bun.spawnSync([entry, '--version']);
    expect(version.stdout.toString()).toBe(`${JAMCLI_VERSION}\n`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}, 60_000);
