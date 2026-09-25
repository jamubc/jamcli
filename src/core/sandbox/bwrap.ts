import fs from 'fs';
import type { Sandbox, SandboxSettings } from './types.js';
import { existingHidden, expandHome, realDirectory } from './paths.js';

const isRealDirectory = (target: string) => {
  try {
    return fs.lstatSync(target).isDirectory();
  } catch {
    return false;
  }
};

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
export function bwrapArgs(options: BwrapOptions, command: string, cwd: string, env: Record<string, string> = {}): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp'];
  // A read-only mount does not stop connecting to a Unix socket, so the directories that
  // hold the Docker, containerd, podman, and user session sockets are replaced with empty ones.
  if (fs.existsSync('/run')) args.push('--tmpfs', '/run');
  if (options.network && fs.existsSync('/run/systemd/resolve')) args.push('--ro-bind', '/run/systemd/resolve', '/run/systemd/resolve');
  if (isRealDirectory('/var/run')) args.push('--tmpfs', '/var/run');
  const writable = [...(options.readOnlyProject ? [] : [options.projectRoot]), ...(options.writable ?? []).map((dir) => expandHome(dir, options.home))];
  for (const dir of new Set(writable.map(realDirectory))) {
    if (fs.existsSync(dir)) args.push('--bind', dir, dir);
  }
  // Read-only, but visible even under the private /tmp.
  const readable = [...(options.readOnlyProject ? [options.projectRoot] : []), ...(options.readable ?? [])];
  for (const dir of new Set(readable.map(realDirectory))) {
    if (fs.existsSync(dir)) args.push('--ro-bind', dir, dir);
  }
  const agent = env.SSH_AUTH_SOCK ? [env.SSH_AUTH_SOCK] : [];
  for (const hidden of existingHidden([...(options.hidden ?? []), ...agent], options.home)) {
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
    wrap: (command, { cwd, env }) => ({ file: options.executable, args: bwrapArgs(options, command, cwd, env) }),
  };
}
