import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getStateDir, userConfigDir, userDataDir } from '../../utils/paths.js';

/**
 * The plugin lockfiles and the installed copies' integrity: what every session start reads,
 * kept apart from the manifest checks and installing, so a session with no plugins loads
 * nothing more than this.
 */

/** What a plugin may reach, with the defaults filled in: nothing unless it asks. */
export interface PluginPermissions {
  network: string[];
  env: string[];
  filesystem: 'none' | 'project';
}

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

export interface LockFile {
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

export function writeLock(scope: PluginScope, projectRoot: string, lock: LockFile) {
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

/**
 * Consent lives outside the project, in the person's state directory: a repository could
 * commit its own `.jamcli/plugins.lock.json`, naming a directory inside itself with a
 * matching hash, so a lockfile alone proves nothing about what this person agreed to.
 */
const consentFile = () => path.join(getStateDir(), 'plugin-consents.json');
const consentKey = (scope: PluginScope, projectRoot: string, name: string) => `${scope}:${scope === 'user' ? '' : path.resolve(projectRoot)}:${name}`;
const consentDigest = (plugin: Pick<LockedPlugin, 'integrity' | 'permissions' | 'dir'>) =>
  crypto.createHash('sha256').update(JSON.stringify([plugin.integrity, plugin.permissions, path.resolve(plugin.dir)])).digest('hex');

function readConsents(): Record<string, string> {
  try {
    const data = JSON.parse(fs.readFileSync(consentFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/** Record that the person agreed to this plugin, as it is, with these permissions. */
export function recordConsent(scope: PluginScope, projectRoot: string, plugin: LockedPlugin): void {
  const data = { ...readConsents(), [consentKey(scope, projectRoot, plugin.name)]: consentDigest(plugin) };
  fs.mkdirSync(path.dirname(consentFile()), { recursive: true });
  fs.writeFileSync(consentFile(), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function forgetConsent(scope: PluginScope, projectRoot: string, name: string): void {
  const data = readConsents();
  delete data[consentKey(scope, projectRoot, name)];
  if (fs.existsSync(consentFile())) fs.writeFileSync(consentFile(), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

const insidePluginsDir = (dir: string) => {
  const relative = path.relative(path.resolve(pluginsDir()), path.resolve(dir));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** Why an entry does not load, or nothing when it may: its copy in JamCLI's plugin directory, consented to here. */
export function trustProblem(plugin: LockedPlugin & { scope: PluginScope }, projectRoot: string): string | undefined {
  if (!insidePluginsDir(plugin.dir)) return `its files are at ${plugin.dir}, outside ${pluginsDir()}`;
  if (readConsents()[consentKey(plugin.scope, projectRoot, plugin.name)] !== consentDigest(plugin)) return 'it was not installed with your consent on this machine, as the lockfile describes it';
  return undefined;
}

/** The plugins whose contributions load: enabled, installed by JamCLI, and consented to by this person. */
export const enabledPlugins = (projectRoot: string) =>
  installedPlugins(projectRoot).filter((plugin) => plugin.enabled && fs.existsSync(plugin.dir) && !trustProblem(plugin, projectRoot));

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
