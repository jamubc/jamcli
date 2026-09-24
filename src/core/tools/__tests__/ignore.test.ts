import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_IGNORE, resolveIgnorePatterns } from '../ignore.js';

test("ignore patterns come from the call, then the project's mcp.json, then the defaults", async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-ignore-'));
  const configured = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-ignore-'));
  try {
    expect(await resolveIgnorePatterns({ projectRoot: bare })).toEqual(DEFAULT_IGNORE);
    expect(DEFAULT_IGNORE).toContain('*.lock');
    fs.mkdirSync(path.join(configured, '.jamcli'));
    fs.writeFileSync(path.join(configured, '.jamcli', 'mcp.json'), JSON.stringify({ ignore_patterns: ['build/**'] }));
    expect(await resolveIgnorePatterns({ projectRoot: configured })).toEqual(['build/**']);
    expect(await resolveIgnorePatterns({ projectRoot: configured, ignorePatterns: ['x/**'] })).toEqual(['x/**']);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(configured, { recursive: true, force: true });
  }
});
