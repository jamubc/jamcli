import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { userConfigDir, userDataDir } from '../../utils/paths.js';
import { describeContributions, describePermissions, permissionsOf, readManifest, widened, type PluginManifest, type PluginPermissions } from './manifest.js';

export type PluginScope = 'user' | 'project';

/** One installed plugin, as its lockfile records it. */
export interface LockedPlugin {
  name: string;
  version: string;
  /** Where it came from: a path, or a git URL with an optional `#ref`. */
  source: string;
  /** The git commit it was taken from, when the source is a repository. */
  commit?: string;
  /** `sha256-` and the hash of its sorted files and their contents. */
  integrity: string;
  permissions: PluginPermissions;
  consentedAt: string;
  enabled: boolean;
  /** Why it was turned off, when JamCLI did it: `integrity` after a failed check. */
  disabledReason?: string;
  /** Where the installed copy is. */
  dir: string;
}

interface LockFile {
  version: 1;
  plugins: Record<string, LockedPlugin>;
}

export const lockFilePath = (scope: PluginScope, projectRoot: string) =>
  scope === 'user' ? path.join(userConfigDir(), 'plugins.lock.json') : path.join(projectRoot, '.jamcli', 'plugins.lock.json');

export const pluginsDir = () => path.join(userDataDir(), 'plugins');

export function readLock(scope: PluginScope, projectRoot: string): LockFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockFilePath(scope, projectRoot), 'utf8'));
    return { version: 1, plugins: parsed?.plugins && typeof parsed.plugins === 'object' ? parsed.plugins : {} };
  } catch {
    return { version: 1, plugins: {} };
  }
}

function writeLock(scope: PluginScope, projectRoot: string, lock: LockFile) {
  const file = lockFilePath(scope, projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(lock, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

/** Every installed plugin: a project's entry shadows a user's of the same name. */
export function installedPlugins(projectRoot: string): (LockedPlugin & { scope: PluginScope })[] {
  const byName = new Map<string, LockedPlugin & { scope: PluginScope }>();
  for (const scope of ['user', 'project'] as const) for (const plugin of Object.values(readLock(scope, projectRoot).plugins)) byName.set(plugin.name, { ...plugin, scope });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The plugins whose contributions load: enabled, and installed where the lockfile says. */
export const enabledPlugins = (projectRoot: string) => installedPlugins(projectRoot).filter((plugin) => plugin.enabled && fs.existsSync(plugin.dir));

const files = (dir: string, base = dir): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name === '.git') return [];
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${path.relative(base, full)} is a symbolic link, which a plugin may not contain.`);
      return entry.isDirectory() ? files(full, base) : [path.relative(base, full)];
    })
    .sort();

/** A hash of every file's path and contents, in a fixed order: the same tree gives the same value anywhere. */
export function integrityOf(dir: string): string {
  const hash = crypto.createHash('sha256');
  for (const file of files(dir)) {
    hash.update(file.split(path.sep).join('/'));
    hash.update('\0');
    hash.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest());
  }
  return `sha256-${hash.digest('hex')}`;
}

const isGitSource = (source: string) => /^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/)/.test(source) || source.endsWith('.git') || /\.git#/.test(source);

const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim();

/** Fetch a source into a new temporary directory: a copy of a path, or a clone at a ref. */
function fetchSource(source: string): { dir: string; commit?: string; cleanup: () => void } {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-plugin-'));
  const cleanup = () => fs.rmSync(staging, { recursive: true, force: true });
  const dir = path.join(staging, 'plugin');
  try {
    if (isGitSource(source)) {
      const [url, ref] = source.split('#');
      git(['clone', '--quiet', ...(ref ? [] : ['--depth', '1']), url, dir]);
      if (ref) git(['checkout', '--quiet', ref], dir);
      const commit = git(['rev-parse', 'HEAD'], dir);
      fs.rmSync(path.join(dir, '.git'), { recursive: true, force: true });
      return { dir, commit, cleanup };
    }
    const from = path.resolve(source);
    if (!fs.statSync(from).isDirectory()) throw new Error(`${source} is not a directory.`);
    let commit: string | undefined;
    try {
      commit = git(['rev-parse', 'HEAD'], from);
    } catch {
      // Not a repository: no commit to record.
    }
    fs.cpSync(from, dir, { recursive: true, filter: (item) => path.basename(item) !== '.git' });
    return { dir, ...(commit ? { commit } : {}), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** What the person is shown before consenting. */
export interface ConsentRequest {
  manifest: PluginManifest;
  permissions: PluginPermissions;
  /** Each contribution and each permission, as lines. */
  lines: string[];
  /** On update: what the new version may reach that the installed one could not. */
  widened?: string[];
}

export interface InstallOptions {
  scope: PluginScope;
  projectRoot: string;
  /** Show the request and return whether the person agreed. */
  consent: (request: ConsentRequest) => boolean | Promise<boolean>;
}

/**
 * Install a plugin: fetch it, check its manifest and JamCLI's version, hash it, show what
 * it adds and may reach, and store it only when the person agrees.
 */
export async function installPlugin(source: string, options: InstallOptions): Promise<LockedPlugin> {
  const fetched = fetchSource(source);
  try {
    const manifest = readManifest(fetched.dir);
    const permissions = permissionsOf(manifest);
    const integrity = integrityOf(fetched.dir);
    const lock = readLock(options.scope, options.projectRoot);
    const before = lock.plugins[manifest.name];
    const growth = before ? widened(before.permissions, permissions) : undefined;
    // An update that asks for nothing more keeps the consent given before.
    const needsConsent = !before || (growth?.length ?? 0) > 0;
    if (needsConsent) {
      const lines = [...describeContributions(fetched.dir, manifest), ...describePermissions(permissions)];
      const agreed = await options.consent({ manifest, permissions, lines, ...(growth?.length ? { widened: growth } : {}) });
      if (!agreed) throw new Error(`${manifest.name} was not installed: consent was not given.`);
    }
    const target = path.join(pluginsDir(), manifest.name, manifest.version);
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(fetched.dir, target, { recursive: true });
    if (integrityOf(target) !== integrity) throw new Error(`${manifest.name} changed while it was being installed.`);
    const entry: LockedPlugin = {
      name: manifest.name,
      version: manifest.version,
      source,
      ...(fetched.commit ? { commit: fetched.commit } : {}),
      integrity,
      permissions,
      consentedAt: needsConsent || !before ? new Date().toISOString() : before.consentedAt,
      enabled: true,
      dir: target,
    };
    lock.plugins[manifest.name] = entry;
    writeLock(options.scope, options.projectRoot, lock);
    if (before && before.dir !== target) fs.rmSync(before.dir, { recursive: true, force: true });
    return entry;
  } finally {
    fetched.cleanup();
  }
}

function find(name: string, projectRoot: string): { scope: PluginScope; lock: LockFile; plugin: LockedPlugin } {
  for (const scope of ['project', 'user'] as const) {
    const lock = readLock(scope, projectRoot);
    if (lock.plugins[name]) return { scope, lock, plugin: lock.plugins[name] };
  }
  throw new Error(`No plugin ${name} is installed.`);
}

/** Install the plugin again from where it came from; consent is asked again only if it may reach more. */
export async function updatePlugin(name: string, options: Omit<InstallOptions, 'scope'>): Promise<{ before: LockedPlugin; after: LockedPlugin }> {
  const { scope, plugin } = find(name, options.projectRoot);
  const after = await installPlugin(plugin.source, { ...options, scope });
  return { before: plugin, after };
}

export function setPluginEnabled(name: string, projectRoot: string, enabled: boolean): LockedPlugin {
  const { scope, lock, plugin } = find(name, projectRoot);
  if (enabled && plugin.disabledReason === 'integrity' && integrityOf(plugin.dir) !== plugin.integrity) {
    throw new Error(`${name} does not match what was installed. Install it again to use it.`);
  }
  const { disabledReason: _, ...rest } = plugin;
  lock.plugins[name] = { ...rest, enabled };
  writeLock(scope, projectRoot, lock);
  return lock.plugins[name];
}

export function removePlugin(name: string, projectRoot: string): LockedPlugin {
  const { scope, lock, plugin } = find(name, projectRoot);
  delete lock.plugins[name];
  writeLock(scope, projectRoot, lock);
  fs.rmSync(plugin.dir, { recursive: true, force: true });
  return plugin;
}

export interface VerifyResult {
  name: string;
  ok: boolean;
  problem?: string;
}

/** Hash every installed plugin again. One that no longer matches is turned off until installed again. */
export function verifyPlugins(projectRoot: string): VerifyResult[] {
  const results: VerifyResult[] = [];
  for (const scope of ['user', 'project'] as const) {
    const lock = readLock(scope, projectRoot);
    let changed = false;
    for (const plugin of Object.values(lock.plugins)) {
      let problem: string | undefined;
      try {
        if (!fs.existsSync(plugin.dir)) problem = `${plugin.dir} is missing`;
        else if (integrityOf(plugin.dir) !== plugin.integrity) problem = 'its files do not match what was installed';
      } catch (error: any) {
        problem = error?.message ?? String(error);
      }
      if (problem && plugin.enabled) {
        lock.plugins[plugin.name] = { ...plugin, enabled: false, disabledReason: 'integrity' };
        changed = true;
      }
      results.push({ name: plugin.name, ok: !problem, ...(problem ? { problem } : {}) });
    }
    if (changed) writeLock(scope, projectRoot, lock);
  }
  return results;
}
