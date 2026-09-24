import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Config, Profile } from '../../types/config.js';
import { userConfigDir } from '../../utils/paths.js';
import type { PermissionLayer } from '../permissions/config.js';
import { ConfigFileSchema, McpFileSchema, ProfileSchema, type ConfigFile, type McpFile } from './schema.js';
import { formatPath, validateLayer } from './validate.js';

export const PROJECT_DIR = '.jamcli';

/** Where a layer's values come from, lowest first. */
export type LayerScope = 'default' | 'user' | 'project' | 'local' | 'env';

export interface ConfigLayer {
  scope: LayerScope;
  /** The file or variable, as messages and `--show-origin` name it. */
  label: string;
  /** The file read, for a file layer. */
  file?: string;
  /** What the layer sets, with anything invalid taken out. */
  values: ConfigFile;
}

export interface LoadedConfig {
  /** Every layer merged, with defaults filled in. */
  config: Config;
  /** The active profile, from the user's and the project's `profiles/<name>.json`. */
  profile: Profile;
  /** The legacy `.jamcli/mcp.json`: MCP servers and the per-tool permission block. */
  mcp: McpFile;
  /** Each layer that set something, lowest first. */
  layers: ConfigLayer[];
  /** For every value set, the layer it came from, keyed by its path: `agent_loop.max_steps`, `profile.temperature`. */
  origins: Map<string, string>;
  /** Files that could not be read and values that did not fit, each naming its file and key. */
  errors: string[];
}

export interface LoadOptions {
  projectRoot: string;
  /** Where JAMCLI_MODEL and similar are read. Defaults to the process environment. */
  env?: Record<string, string | undefined>;
}

/** What every session has before any file is read. Ollama on this machine is always a provider. */
export const DEFAULTS: ConfigFile = {
  active_profile: 'default',
  api_registry: { ollama: { endpoint: 'http://localhost:11434' } },
  telemetry: false,
};

/** Variables that set one value each, above every file. */
export const ENV_SETTINGS: { variable: string; path: string[] }[] = [
  { variable: 'JAMCLI_MODEL', path: ['model'] },
  { variable: 'JAMCLI_PROFILE', path: ['active_profile'] },
  { variable: 'JAMCLI_PERMISSION_MODE', path: ['permissions', 'mode'] },
];

/** Lists that add up across layers rather than replace one another. */
const CONCATENATED = new Set(['permissions.allow', 'permissions.ask', 'permissions.deny']);

export const userConfigFile = () => path.join(userConfigDir(), 'config.json');
export const projectConfigFile = (projectRoot: string) => path.join(projectRoot, PROJECT_DIR, 'config.json');
export const localConfigFile = (projectRoot: string) => path.join(projectRoot, PROJECT_DIR, 'config.local.json');
export const mcpFile = (projectRoot: string) => path.join(projectRoot, PROJECT_DIR, 'mcp.json');

/** A path as messages show it: relative inside the project, from `~` inside the home directory. */
export function displayPath(file: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, file);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  const home = os.homedir();
  if (file === home || file.startsWith(`${home}${path.sep}`)) return `~${file.slice(home.length)}`;
  return file;
}

export const isPlainObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** A file's JSON, nothing when it is absent, and an error naming it when it cannot be parsed. */
export function readJsonFile(file: string, label: string): { value?: unknown; error?: string } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return {};
    return { error: `${label} could not be read: ${error?.message ?? error}` };
  }
  if (!text.trim()) return {};
  try {
    return { value: JSON.parse(text) };
  } catch (error: any) {
    return { error: `${label} is not valid JSON, so it is ignored: ${error?.message ?? error}` };
  }
}

function recordLeaves(origins: Map<string, string>, value: unknown, at: PropertyKey[], label: string): void {
  if (isPlainObject(value) && Object.keys(value).length) {
    for (const [key, item] of Object.entries(value)) recordLeaves(origins, item, [...at, key], label);
    return;
  }
  origins.set(formatPath(at), label);
}

/**
 * Merge `source` into `target`: objects merge key by key, the permission lists add up,
 * and anything else replaces what was there. Each value set is recorded with its layer.
 */
export function mergeLayer(target: Record<string, any>, source: Record<string, any>, label: string, origins: Map<string, string>, at: string[] = []): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const here = [...at, key];
    const name = formatPath(here);
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      mergeLayer(target[key], value, label, origins, here);
      if (!Object.keys(target[key]).length) origins.set(name, label);
      continue;
    }
    if (Array.isArray(value) && CONCATENATED.has(name)) {
      const existing: unknown[] = Array.isArray(target[key]) ? target[key] : [];
      value.forEach((item, index) => origins.set(formatPath([...here, existing.length + index]), label));
      target[key] = [...existing, ...structuredClone(value)];
      continue;
    }
    target[key] = structuredClone(value);
    recordLeaves(origins, value, here, label);
  }
}

function setPath(target: Record<string, any>, keys: string[], value: unknown): Record<string, any> {
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  node[keys[keys.length - 1]] = value;
  return target;
}

/**
 * Resolve configuration from its layers, lowest to highest: built-in defaults, the user's
 * `config.json`, the project's `.jamcli/config.json` (with the legacy `mcp.json` and
 * `profiles/`), the project-local `.jamcli/config.local.json`, and environment variables.
 * Flags sit above all of these and are applied by the caller. Nothing is written.
 */
export function loadConfig(options: LoadOptions): LoadedConfig {
  const projectRoot = path.resolve(options.projectRoot);
  const env = options.env ?? process.env;
  const errors: string[] = [];
  const origins = new Map<string, string>();
  const layers: ConfigLayer[] = [{ scope: 'default', label: 'defaults', values: DEFAULTS }];

  const files: { scope: LayerScope; file: string }[] = [
    { scope: 'user', file: userConfigFile() },
    { scope: 'project', file: projectConfigFile(projectRoot) },
    { scope: 'local', file: localConfigFile(projectRoot) },
  ];
  for (const { scope, file } of files) {
    const label = displayPath(file, projectRoot);
    const { value, error } = readJsonFile(file, label);
    if (error) errors.push(error);
    if (value === undefined) continue;
    const checked = validateLayer(ConfigFileSchema, value, label);
    errors.push(...checked.errors);
    if (checked.value) layers.push({ scope, label, file, values: checked.value });
  }

  for (const { variable, path: keys } of ENV_SETTINGS) {
    const raw = env[variable]?.trim();
    if (!raw) continue;
    const checked = validateLayer(ConfigFileSchema, setPath({}, keys, raw), variable, { single: true });
    errors.push(...checked.errors);
    if (checked.value) layers.push({ scope: 'env', label: variable, values: checked.value });
  }

  const merged: Record<string, any> = {};
  for (const layer of layers) mergeLayer(merged, layer.values, layer.label, origins);
  const { $schema: _schema, ...config } = merged;
  origins.delete('$schema');

  const profileName: string = config.active_profile;
  const profile: Record<string, any> = {};
  const profileFiles = [path.join(userConfigDir(), 'profiles', `${profileName}.json`), path.join(projectRoot, PROJECT_DIR, 'profiles', `${profileName}.json`)];
  let profileFound = false;
  for (const file of profileFiles) {
    const label = displayPath(file, projectRoot);
    const { value, error } = readJsonFile(file, label);
    if (error) errors.push(error);
    if (value === undefined) continue;
    profileFound = true;
    const checked = validateLayer(ProfileSchema, value, label);
    errors.push(...checked.errors);
    if (checked.value) mergeLayer(profile, checked.value, label, origins, ['profile']);
  }
  const profileValues = { name: profileName, ...profile } as Profile;
  if (!profileFound && profileName !== DEFAULTS.active_profile) {
    const source = origins.get('active_profile') ?? 'the configuration';
    errors.push(`${source} names the profile "${profileName}", but there is no profiles/${profileName}.json in ${displayPath(userConfigDir(), projectRoot)} or ${PROJECT_DIR}.`);
  }

  let mcp: McpFile = {};
  const mcpLabel = displayPath(mcpFile(projectRoot), projectRoot);
  const mcpRead = readJsonFile(mcpFile(projectRoot), mcpLabel);
  if (mcpRead.error) errors.push(mcpRead.error);
  if (mcpRead.value !== undefined) {
    const checked = validateLayer(McpFileSchema, mcpRead.value, mcpLabel);
    errors.push(...checked.errors);
    mcp = checked.value ?? {};
    recordLeaves(origins, { mcp }, [], mcpLabel);
  }

  return { config: config as Config, profile: profileValues, mcp, layers, origins, errors };
}

/** The layers as the permission engine reads them, so rules and the mode come from the same files. */
export const permissionLayers = (loaded: LoadedConfig): PermissionLayer[] =>
  loaded.layers
    .filter((layer) => layer.scope !== 'default')
    .map((layer) => ({ scope: layer.scope as PermissionLayer['scope'], label: layer.label, permissions: layer.values.permissions }));
