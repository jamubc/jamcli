import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPluginCommand } from '../plugin.js';

let base: string;
let project: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-plugin-cli-')));
  project = path.join(base, 'project');
  fs.mkdirSync(project, { recursive: true });
  for (const [key, value] of Object.entries({ JAMCLI_DATA_DIR: path.join(base, 'data'), JAMCLI_CONFIG_DIR: path.join(base, 'config'), JAMCLI_STATE_DIR: path.join(base, 'state') })) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(base, { recursive: true, force: true });
});

test('plugin install --scope project writes the project lockfile, not the user one', async () => {
  const dir = path.join(base, 'src', 'cli-plugin');
  fs.mkdirSync(path.join(dir, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'commands', 'hello.md'), 'Say hello.\n');
  fs.writeFileSync(path.join(dir, 'jamcli-plugin.json'), JSON.stringify({ name: 'cli-plugin', version: '1.0.0', contributes: { commands: 'commands' } }));
  const out: string[] = [];
  const code = await runPluginCommand(['install', dir, '--scope', 'project', '--yes'], project, { out: (line) => out.push(line), err: (line) => out.push(line) });
  expect(code).toBe(0);

  const lockFile = path.join(project, '.jamcli', 'plugins.lock.json');
  expect(fs.existsSync(lockFile)).toBe(true);
  expect(JSON.parse(fs.readFileSync(lockFile, 'utf8')).plugins['cli-plugin']).toMatchObject({ version: '1.0.0', enabled: true, permissions: { network: [], env: [], filesystem: 'none' } });
  expect(fs.existsSync(path.join(base, 'config', 'plugins.lock.json'))).toBe(false);
  expect(out.join('\n')).toContain('for the project');
});
