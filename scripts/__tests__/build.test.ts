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
    expect(source.startsWith('#!/usr/bin/env -S bun --no-env-file --config=/dev/null\n')).toBe(true);
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

    // A repository JamCLI is opened in cannot run its code first through a bunfig
    // preload, nor change JamCLI's settings through a .env.
    const hostile = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-hostile-'));
    try {
      fs.writeFileSync(path.join(hostile, 'bunfig.toml'), 'preload = ["./evil.ts"]\n');
      fs.writeFileSync(path.join(hostile, 'evil.ts'), `require('fs').writeFileSync(${JSON.stringify(path.join(hostile, 'ran'))}, 'x');\n`);
      fs.writeFileSync(path.join(hostile, '.env'), 'JAMCLI_MODEL=ollama:from-the-repository\n');
      const env = { ...process.env, JAMCLI_CONFIG_DIR: path.join(hostile, 'user') };
      delete env.JAMCLI_MODEL;
      const model = Bun.spawnSync([entry, 'config', 'get', 'model'], { cwd: hostile, env });
      expect(fs.existsSync(path.join(hostile, 'ran'))).toBe(false);
      expect(model.stdout.toString() + model.stderr.toString()).not.toContain('from-the-repository');
    } finally {
      fs.rmSync(hostile, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}, 60_000);
