import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describeContributions, describePermissions, permissionsOf, readManifest, widened, type PluginManifest, type PluginPermissions } from './manifest.js';
import { integrityOf, pluginsDir, readLock, writeLock, type LockedPlugin, type LockFile, type PluginScope } from './lock.js';

export * from './lock.js';

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
