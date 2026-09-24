import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import type { Sandbox, SandboxSettings } from './types.js';
import { bwrapSandbox } from './bwrap.js';
import { SANDBOX_EXEC, seatbeltSandbox } from './seatbelt.js';

export const unsandboxed = (reason: string): Sandbox => ({
  kind: 'none',
  reason,
  wrap: (command) => ({ file: '/bin/sh', args: ['-c', command] }),
});

const onPath = (name: string, env: NodeJS.ProcessEnv): string | undefined => {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return undefined;
};

/** Whether a sandbox can really start here, which a container without namespaces can prevent. */
const works = (file: string, args: string[]): string | undefined => {
  const probe = spawnSync(file, args, { timeout: 5_000, encoding: 'utf8' });
  if (probe.status === 0) return undefined;
  return (probe.stderr || probe.error?.message || `exit ${probe.status}`).trim().split('\n')[0];
};

const probed = new Map<string, string | undefined>();

export interface DetectOptions {
  projectRoot: string;
  settings?: SandboxSettings;
  platform?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The sandbox commands run in: bubblewrap on Linux and Seatbelt on macOS when they
 * start here, and none otherwise, always with the reason. Probes are cached per process.
 */
export function detectSandbox(options: DetectOptions): Sandbox {
  const settings = options.settings ?? {};
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (settings.enabled === false) return unsandboxed('the sandbox is turned off by sandbox.enabled');

  if (platform === 'linux') {
    const bwrap = onPath('bwrap', env);
    if (!bwrap) return unsandboxed('bubblewrap (bwrap) is not installed');
    if (!probed.has(bwrap)) {
      probed.set(bwrap, works(bwrap, ['--ro-bind', '/', '/', '--unshare-net', '--unshare-pid', '--die-with-parent', '--', '/bin/true']));
    }
    const failure = probed.get(bwrap);
    if (failure) return unsandboxed(`bubblewrap is installed but cannot start here: ${failure}`);
    return bwrapSandbox({ ...settings, projectRoot: options.projectRoot, executable: bwrap });
  }

  if (platform === 'darwin') {
    if (!fs.existsSync(SANDBOX_EXEC)) return unsandboxed(`${SANDBOX_EXEC} is missing`);
    if (!probed.has(SANDBOX_EXEC)) probed.set(SANDBOX_EXEC, works(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '/usr/bin/true']));
    const failure = probed.get(SANDBOX_EXEC);
    if (failure) return unsandboxed(`Seatbelt cannot start here: ${failure}`);
    return seatbeltSandbox({ ...settings, projectRoot: options.projectRoot, tmpdir: env.TMPDIR });
  }

  return unsandboxed(`there is no sandbox for ${platform}`);
}
