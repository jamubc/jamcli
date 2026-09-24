import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { JAMCLI_VERSION } from '../core/version.js';
import { USAGE } from '../cli.js';

const ENTRY = path.join(import.meta.dir, '../index.tsx');

test('the entry point loads nothing until it has read the arguments', () => {
  const source = fs.readFileSync(ENTRY, 'utf8');
  expect(source).not.toMatch(/^\s*import\s/m);
  expect(source).toContain("await import('./tui/start.js')");
});

test('--version and -v print the recorded version', async () => {
  for (const flag of ['--version', '-v']) {
    const child = Bun.spawn(['bun', ENTRY, flag], { stdout: 'pipe', stderr: 'pipe' });
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(code).toBe(0);
    expect(out).toBe(`${JAMCLI_VERSION}\n`);
  }
});

test('--help reaches the command line without the interface', async () => {
  const child = Bun.spawn(['bun', ENTRY, '--help'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  expect(code).toBe(0);
  expect(out).toContain('Usage: jamcli');
});

test('every subcommand the usage lists reaches the command line', async () => {
  const source = fs.readFileSync(ENTRY, 'utf8');
  const subcommands = [...USAGE.matchAll(/^ {2}jamcli ([a-z]+)/gm)].map((match) => match[1]);
  expect(subcommands).toEqual(expect.arrayContaining(['sessions', 'audit', 'config', 'mcp', 'acp']));
  for (const name of subcommands) expect(source).toContain(`'${name}',`);

  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-entry-'));
  try {
    const child = Bun.spawn(['bun', ENTRY, 'config', 'get', 'model'], {
      cwd,
      env: { ...process.env, JAMCLI_CONFIG_DIR: path.join(cwd, 'user') },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [err, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    expect(err).toBe('model is not set.\n');
    expect(code).toBe(1);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
