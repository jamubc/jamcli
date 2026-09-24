/**
 * The environment every process JamCLI starts gets: commands, MCP servers, external
 * agents, and later hooks and language servers. No credential reaches one unless a
 * setting names it.
 */

/** How much of JamCLI's own environment a process inherits. */
export type EnvPolicy = 'scrubbed' | 'minimal';

export interface SubprocessEnvOptions {
  /**
   * `scrubbed`, the default, passes everything except variables whose names look like
   * credentials. `minimal` passes only what a shell needs to run.
   */
  policy?: EnvPolicy;
  /** Names passed even when they look like credentials, such as a server's declared key. */
  passthrough?: string[];
  /** Names never passed unless listed in `passthrough`, such as each provider's `key_env_var`. */
  withheld?: string[];
  /** Values set for this process, such as an MCP server entry's `env`. Applied last. */
  extra?: Record<string, string>;
}

/** A name that says its value is a credential. */
export const CREDENTIAL_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)|_PAT$/i;

const MINIMAL = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'TMPDIR',
  'TZ',
  // Windows needs these for programs to start at all.
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'HOMEDRIVE',
  'HOMEPATH',
]);

const inMinimal = (name: string) => MINIMAL.has(name) || name.startsWith('LC_') || name.startsWith('JAMCLI_');

export function subprocessEnv(
  parent: Record<string, string | undefined>,
  options: SubprocessEnvOptions = {}
): Record<string, string> {
  const passthrough = new Set(options.passthrough ?? []);
  const withheld = new Set(options.withheld ?? []);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (typeof value !== 'string') continue;
    if (passthrough.has(name)) {
      env[name] = value;
      continue;
    }
    if (withheld.has(name)) continue;
    if (options.policy === 'minimal' ? !inMinimal(name) : CREDENTIAL_NAME.test(name)) continue;
    env[name] = value;
  }
  return { ...env, ...(options.extra ?? {}) };
}
