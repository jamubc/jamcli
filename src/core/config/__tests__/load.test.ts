import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadConfig, permissionLayers, userConfigFile } from '../load.js';
import { loadPermissions } from '../../permissions/config.js';

let root: string;
let userDir: string;
const sharedConfigDir = process.env.JAMCLI_CONFIG_DIR;

beforeEach(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-config-')));
  root = path.join(base, 'project');
  userDir = path.join(base, 'user');
  fs.mkdirSync(root);
  process.env.JAMCLI_CONFIG_DIR = userDir;
});
afterEach(() => {
  process.env.JAMCLI_CONFIG_DIR = sharedConfigDir;
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

const write = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const user = (value: unknown) => write(path.join(userDir, 'config.json'), value);
const project = (value: unknown, name = 'config.json') => write(path.join(root, '.jamcli', name), value);
const load = (env: Record<string, string> = {}) => loadConfig({ projectRoot: root, env });

test('each layer overrides the ones below it, and every value remembers its layer', () => {
  user({ model: 'ollama:a', agent_loop: { max_steps: 10 } });
  project({ model: 'ollama:b', agent_loop: { max_steps: 20 } });
  project({ agent_loop: { command_timeout_ms: 5000 } }, 'config.local.json');
  const { config, origins, errors } = load({ JAMCLI_MODEL: 'ollama:c' });
  expect(errors).toEqual([]);
  expect(config.model).toBe('ollama:c');
  expect(config.agent_loop).toEqual({ max_steps: 20, command_timeout_ms: 5000 } as any);
  expect(config.api_registry.ollama).toEqual({ endpoint: 'http://localhost:11434' });
  expect(origins.get('model')).toBe('JAMCLI_MODEL');
  expect(origins.get('agent_loop.max_steps')).toBe('.jamcli/config.json');
  expect(origins.get('agent_loop.command_timeout_ms')).toBe('.jamcli/config.local.json');
  expect(origins.get('api_registry.ollama.endpoint')).toBe('defaults');
  expect(origins.get('active_profile')).toBe('defaults');

  // Without the project's value, the user's shows through.
  project({ agent_loop: {} });
  expect(load().config.agent_loop?.max_steps).toBe(10);
  expect(load().origins.get('agent_loop.max_steps')).toBe(path.join(userDir, 'config.json'));
});

test('objects merge key by key, other lists replace, and permission lists add up', () => {
  user({
    api_registry: { anthropic: { key_env_var: 'MY_ANTHROPIC_KEY' } },
    sandbox: { writable: ['/a'] },
    permissions: { allow: ['read_file'], deny: ['run_command(rm *)'] },
  });
  project({ api_registry: { anthropic: { base_url: 'https://gw.example' } }, sandbox: { writable: ['/b'] }, permissions: { allow: ['grep'] } });
  const { config, origins } = load();
  expect(config.api_registry.anthropic).toEqual({ key_env_var: 'MY_ANTHROPIC_KEY', base_url: 'https://gw.example' });
  expect(config.sandbox?.writable).toEqual(['/b']);
  expect(config.permissions).toEqual({ allow: ['read_file', 'grep'], deny: ['run_command(rm *)'] });
  expect(origins.get('permissions.allow[0]')).toBe(path.join(userDir, 'config.json'));
  expect(origins.get('permissions.allow[1]')).toBe('.jamcli/config.json');
  expect(origins.get('sandbox.writable')).toBe('.jamcli/config.json');
});

test('the permission engine reads the same layers, and a deny from the user applies to every project', () => {
  user({ permissions: { deny: ['run_command(rm *)'] } });
  project({ permissions: { allow: ['run_command'], mode: 'accept-edits' } });
  const loaded = loadPermissions({ projectRoot: root, layers: permissionLayers(load({ JAMCLI_PERMISSION_MODE: 'plan' })) });
  expect(loaded.errors).toEqual([]);
  expect(loaded.rules.filter((rule) => rule.scope !== 'builtin').map((rule) => [rule.decision, rule.text, rule.scope])).toEqual([
    ['deny', 'run_command(rm *)', 'user'],
    ['allow', 'run_command', 'project'],
  ]);
  expect(loaded).toMatchObject({ mode: 'plan', modeSource: 'JAMCLI_PERMISSION_MODE' });
});

test('a value that does not fit is reported and the layer below shows through', () => {
  user({ agent_loop: { max_steps: 10 } });
  project({ agent_loop: { max_steps: -1 }, model: 'ollama:b' });
  project('{ not json', 'config.local.json');
  const { config, errors } = load({ JAMCLI_PERMISSION_MODE: 'yolo' });
  expect(config.agent_loop?.max_steps).toBe(10);
  // The rest of the file still applies.
  expect(config.model).toBe('ollama:b');
  expect(config.permissions).toBeUndefined();
  // In layer order.
  expect(errors).toHaveLength(3);
  expect(errors[0]).toBe('.jamcli/config.json agent_loop.max_steps should be a whole number above zero, so it is ignored.');
  expect(errors[1]).toStartWith('.jamcli/config.local.json is not valid JSON, so it is ignored:');
  expect(errors[2]).toBe('JAMCLI_PERMISSION_MODE should be one of "plan", "default", "accept-edits", "auto", "bypass", so it is ignored.');
});

test("the active profile merges the user's file under the project's, and a missing one is named", () => {
  write(path.join(userDir, 'profiles', 'default.json'), { temperature: 0.2, preferred_provider: 'ollama' });
  write(path.join(root, '.jamcli', 'profiles', 'default.json'), { name: 'Default', preferred_model: 'qwen2.5-coder:7b' });
  write(path.join(root, '.jamcli', 'profiles', 'fast.json'), { preferred_model: 'qwen2.5-coder:1.5b' });
  const { profile, origins } = load();
  expect(profile).toEqual({ name: 'Default', temperature: 0.2, preferred_provider: 'ollama', preferred_model: 'qwen2.5-coder:7b' });
  expect(origins.get('profile.temperature')).toBe(path.join(userDir, 'profiles', 'default.json'));
  expect(origins.get('profile.preferred_model')).toBe('.jamcli/profiles/default.json');

  expect(load({ JAMCLI_PROFILE: 'fast' }).profile).toEqual({ name: 'fast', preferred_model: 'qwen2.5-coder:1.5b' });
  project({ active_profile: 'slow' });
  expect(load().errors).toEqual([`.jamcli/config.json names the profile "slow", but there is no profiles/slow.json in ${userDir} or .jamcli.`]);
});

test('the legacy mcp.json is read as it is, with its origin', () => {
  project({ servers: [{ id: 'fs', command: 'npx', args: ['server'] }], tools: { run_command: { allowed: false } } }, 'mcp.json');
  const { mcp, origins } = load();
  expect(mcp.servers?.map((server) => server.id)).toEqual(['fs']);
  expect(mcp.tools).toEqual({ run_command: { allowed: false } });
  expect(origins.get('mcp.servers')).toBe('.jamcli/mcp.json');
});

test('loading writes nothing, in the project or the user directory', () => {
  const { config, profile, errors } = load();
  // An empty file is as good as none.
  project('', 'config.local.json');
  expect(load().errors).toEqual([]);
  fs.rmSync(path.join(root, '.jamcli'), { recursive: true });
  expect(errors).toEqual([]);
  expect(config).toEqual({ active_profile: 'default', api_registry: { ollama: { endpoint: 'http://localhost:11434' } }, telemetry: false });
  expect(profile).toEqual({ name: 'default' });
  expect(fs.readdirSync(root)).toEqual([]);
  expect(fs.existsSync(userDir)).toBe(false);
});

test("the user's file follows XDG_CONFIG_HOME, and JAMCLI_CONFIG_DIR above it", () => {
  const saved = { dir: process.env.JAMCLI_CONFIG_DIR, xdg: process.env.XDG_CONFIG_HOME };
  try {
    delete process.env.JAMCLI_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = path.join(root, 'xdg');
    expect(userConfigFile()).toBe(path.join(root, 'xdg', 'jamcli', 'config.json'));
    process.env.JAMCLI_CONFIG_DIR = userDir;
    expect(userConfigFile()).toBe(path.join(userDir, 'config.json'));
  } finally {
    process.env.JAMCLI_CONFIG_DIR = saved.dir;
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
  }
});
