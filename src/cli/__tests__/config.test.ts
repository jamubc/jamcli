import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runConfigCommand, type ConfigAction } from '../config.js';
import { parseArgs } from '../../cli.js';
import { formatPath } from '../../core/config/validate.js';
import { parseKeyPath } from '../../core/config/keys.js';
import { loadConfig, permissionLayers } from '../../core/config/load.js';
import { loadPermissions } from '../../core/permissions/config.js';
import { PermissionEngine } from '../../core/permissions/engine.js';
import { createBuiltinRegistry } from '../../core/tools/registry.js';
import { toolNaming } from '../../core/runtime/tools.js';

let root: string;
let userDir: string;
const shared = process.env.JAMCLI_CONFIG_DIR;

beforeEach(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-config-cli-')));
  root = path.join(base, 'project');
  userDir = path.join(base, 'user');
  fs.mkdirSync(root);
  process.env.JAMCLI_CONFIG_DIR = userDir;
});
afterEach(() => {
  process.env.JAMCLI_CONFIG_DIR = shared;
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

async function config(action: ConfigAction, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runConfigCommand({ action, args }, root, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out, err };
}
const file = (name: string) => JSON.parse(fs.readFileSync(path.join(root, '.jamcli', name), 'utf8'));

test('set writes one file at the chosen scope, and get and list read every layer with its origin', async () => {
  expect(await config('set', 'agent_loop.max_steps', '12', '--scope', 'user')).toMatchObject({ code: 0, out: [`Set agent_loop.max_steps in ${path.join(userDir, 'config.json')}.`] });
  expect(await config('set', 'model', 'ollama:qwen2.5-coder:7b')).toMatchObject({ code: 0, out: ['Set model in .jamcli/config.json.'] });
  expect(await config('set', 'models["ollama:qwen2.5-coder:7b"].context_window', '32768', '--scope=local')).toMatchObject({ code: 0 });
  expect(file('config.json')).toEqual({ model: 'ollama:qwen2.5-coder:7b' });
  expect(file('config.local.json')).toEqual({ models: { 'ollama:qwen2.5-coder:7b': { context_window: 32768 } } });
  // The project directory it created ignores itself.
  expect(fs.readFileSync(path.join(root, '.jamcli', '.gitignore'), 'utf8')).toContain('\n*\n');

  expect((await config('get', 'model')).out).toEqual(['ollama:qwen2.5-coder:7b']);
  expect((await config('get', 'agent_loop', '--show-origin')).out).toEqual(['{"max_steps":12}', `from ${path.join(userDir, 'config.json')}`]);
  fs.mkdirSync(path.join(root, '.jamcli', 'profiles'));
  fs.writeFileSync(path.join(root, '.jamcli', 'profiles', 'default.json'), JSON.stringify({ temperature: 0.3 }));
  const listed = (await config('list', '--show-origin')).out;
  expect(listed).toContain('.jamcli/config.json\tmodel = "ollama:qwen2.5-coder:7b"');
  expect(listed).toContain('.jamcli/config.local.json\tmodels["ollama:qwen2.5-coder:7b"].context_window = 32768');
  expect(listed).toContain('defaults\tapi_registry.ollama.endpoint = "http://localhost:11434"');
  expect(listed).toContain('.jamcli/profiles/default.json\tprofile.temperature = 0.3');
});

test('set reads JSON where it parses, refuses a value that does not fit, and warns when a higher layer wins', async () => {
  await config('set', 'permissions.deny', '["run_command(rm *)"]');
  await config('set', 'sandbox.network', 'true');
  expect(file('config.json')).toEqual({ permissions: { deny: ['run_command(rm *)'] }, sandbox: { network: true } });

  const refused = await config('set', 'agent_loop.max_steps', 'ten');
  expect(refused.code).toBe(1);
  expect(refused.err).toEqual(['.jamcli/config.json agent_loop.max_steps should be a whole number above zero.', 'Nothing was changed.']);
  expect((await config('set', 'agent_loop.max_setps', '3')).err[0]).toBe('.jamcli/config.json: agent_loop.max_setps is not a setting JamCLI knows.');
  expect(file('config.json').agent_loop).toBeUndefined();

  const shadowed = await config('set', 'model', 'ollama:a', '--scope', 'user');
  expect(shadowed.code).toBe(0);
  await config('set', 'model', 'ollama:b');
  expect((await config('set', 'model', 'ollama:c', '--scope', 'user')).err).toEqual(['.jamcli/config.json also sets model, and takes precedence.']);
});

test('keys are never printed, by list or by get', async () => {
  const set = await config('set', 'api_registry.openrouter.api_key', 'sk-or-v1-secret-value');
  expect(set.err).toEqual(['A key in a file can be read by anything that reads the file; key_env_var keeps it in the environment instead.']);
  fs.writeFileSync(path.join(root, '.jamcli', 'mcp.json'), JSON.stringify({ servers: [{ id: 'gh', command: 'x', env: { GITHUB_TOKEN: 'ghp-secret-value' } }] }));
  const everything = [...(await config('list')).out, ...(await config('get', 'api_registry')).out, ...(await config('get', 'mcp.servers')).out, ...(await config('list', '--json')).out];
  expect(everything.join('\n')).not.toContain('secret-value');
  expect((await config('get', 'api_registry.openrouter.api_key')).out).toEqual(['(hidden)']);
});

test('unset removes a value and the sections it empties; a missing key is an error', async () => {
  await config('set', 'context.auto_compact', 'false');
  await config('set', 'telemetry', 'false');
  expect(await config('unset', 'context.auto_compact')).toMatchObject({ code: 0, out: ['Removed context.auto_compact from .jamcli/config.json.'] });
  expect(file('config.json')).toEqual({ telemetry: false });
  expect(await config('unset', 'context.auto_compact')).toMatchObject({ code: 1, err: ['context.auto_compact is not set in .jamcli/config.json.'] });
  expect(await config('get', 'context.auto_compact')).toMatchObject({ code: 1, err: ['context.auto_compact is not set.'] });
});

test("a problem already in the file does not block an unrelated change, and is kept", async () => {
  fs.mkdirSync(path.join(root, '.jamcli'));
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ someones_note: 1 }));
  expect((await config('set', 'telemetry', 'true')).code).toBe(0);
  expect(file('config.json')).toEqual({ someones_note: 1, telemetry: true });
});

test('a file that cannot be parsed is never overwritten', async () => {
  fs.mkdirSync(path.join(root, '.jamcli'));
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), '{ "model": ');
  const result = await config('set', 'telemetry', 'true');
  expect(result.code).toBe(1);
  expect(result.err[0]).toEndWith('Fix the file first; nothing was changed.');
  expect(fs.readFileSync(path.join(root, '.jamcli', 'config.json'), 'utf8')).toBe('{ "model": ');
});

test('migrate moves the legacy tool block into rules that decide the same way, with backups', async () => {
  fs.mkdirSync(path.join(root, '.jamcli'));
  const legacy = {
    servers: [{ id: 'fs', command: 'npx' }],
    tools: {
      run_command: { allowed: false, require_approval: true },
      write_file: { allowed: true, require_approval: true },
      read_file: { allowed: true, require_approval: false },
      git_ops: true,
    },
  };
  fs.writeFileSync(path.join(root, '.jamcli', 'mcp.json'), JSON.stringify(legacy));
  fs.writeFileSync(path.join(root, '.jamcli', 'config.json'), JSON.stringify({ permissions: { allow: ['grep'] } }));

  const registry = createBuiltinRegistry();
  const { classOf, namesOf } = toolNaming(registry);
  const decide = () => {
    const settings = loadConfig({ projectRoot: root, env: {} });
    const loaded = loadPermissions({ projectRoot: root, layers: permissionLayers(settings), legacyTools: settings.mcp.tools as any });
    const engine = new PermissionEngine({ projectRoot: root, rules: loaded.rules, mode: loaded.mode, sandboxed: false, classOf, namesOf });
    return ['run_command', 'write_file', 'read_file', 'grep', 'edit'].map((name) => engine.decide({ id: 'c', name, arguments: { path: 'a.txt', command: 'ls' } }).decision);
  };
  const before = decide();

  const dry = await config('migrate', '--dry-run');
  expect(dry.out.at(-1)).toBe('Dry run: nothing was changed.');
  expect(file('mcp.json')).toEqual(legacy);

  const result = await config('migrate');
  expect(result.code).toBe(0);
  expect(result.out).toEqual([
    '.jamcli/mcp.json tools holds 4 entries.',
    'Rules added to .jamcli/config.json permissions: deny run_command.',
    '3 only restated the defaults and are dropped.',
    'The tools block was removed from .jamcli/mcp.json. Backups: .jamcli/mcp.json.bak, .jamcli/config.json.bak.',
  ]);
  expect(file('config.json')).toEqual({ permissions: { allow: ['grep'], deny: ['run_command'] } });
  expect(file('mcp.json')).toEqual({ servers: [{ id: 'fs', command: 'npx' }] });
  expect(file('mcp.json.bak')).toEqual(legacy);
  expect(decide()).toEqual(before);
  expect((await config('migrate')).out).toEqual(['Nothing to migrate.']);
});

test('keys read back as they are written, and the dispatcher routes config', () => {
  for (const key of ['agent_loop.max_steps', 'models["ollama:qwen2.5-coder:7b"].price.input', 'api_registry.endpoints[0].headers["X-Team"]']) {
    expect(formatPath(parseKeyPath(key) as (string | number)[])).toBe(key);
  }
  expect(parseKeyPath('models.ollama:qwen')).toEqual({ error: 'models.ollama:qwen is not a key.' });
  expect(parseArgs(['config', 'set', 'model', 'ollama:x']).configCommand).toEqual({ action: 'set', args: ['model', 'ollama:x'] });
  expect(parseArgs(['config']).configCommand).toEqual({ action: undefined, args: [] });
});
