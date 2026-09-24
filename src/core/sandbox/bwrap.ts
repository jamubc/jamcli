import fs from 'fs';
import type { Sandbox, SandboxSettings } from './types.js';
import { existingHidden, expandHome, realDirectory } from './paths.js';

export interface BwrapOptions extends SandboxSettings {
  projectRoot: string;
  /** The bubblewrap executable. */
  executable: string;
  home?: string;
}

/**
 * bubblewrap: the whole file system read-only, the project and any configured directories
 * writable, a private /tmp, fresh /dev and /proc, credentials hidden behind empty mounts,
 * no network unless allowed, its own process tree, and nothing left behind if JamCLI dies.
 */
export function bwrapArgs(options: BwrapOptions, command: string, cwd: string): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp'];
  const writable = [options.projectRoot, ...(options.writable ?? []).map((dir) => expandHome(dir, options.home))];
  for (const dir of new Set(writable.map(realDirectory))) {
    if (fs.existsSync(dir)) args.push('--bind', dir, dir);
  }
  for (const hidden of existingHidden(options.hidden, options.home)) {
    if (hidden.directory) args.push('--tmpfs', hidden.path);
    else args.push('--ro-bind', '/dev/null', hidden.path);
  }
  if (!options.network) args.push('--unshare-net');
  args.push('--unshare-pid', '--die-with-parent', '--new-session', '--chdir', cwd, '--', '/bin/sh', '-c', command);
  return args;
}

export function bwrapSandbox(options: BwrapOptions): Sandbox {
  const widen = options.network ? 'sandbox.writable' : 'sandbox.network or sandbox.writable';
  return {
    kind: 'bwrap',
    reason: `bubblewrap at ${options.executable}`,
    note: `This command ran in a bubblewrap sandbox${options.network ? '' : ' with the network off'}, where only the project and /tmp are writable. If it needed more, the user can set ${widen} in .jamcli/config.json.`,
    wrap: (command, { cwd }) => ({ file: options.executable, args: bwrapArgs(options, command, cwd) }),
  };
}
