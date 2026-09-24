import { expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { JAMCLI_VERSION } from '../core/version.js';

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
