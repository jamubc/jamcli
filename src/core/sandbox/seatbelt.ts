import fs from 'fs';
import type { Sandbox, SandboxSettings } from './types.js';
import { existingHidden, expandHome, realDirectory } from './paths.js';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export interface SeatbeltOptions extends SandboxSettings {
  projectRoot: string;
  home?: string;
  /** The per-user temporary directory, `$TMPDIR` on macOS. */
  tmpdir?: string;
}

const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * A Seatbelt profile that denies by default, then allows running programs, reading
 * files, writing the project and temporary directories, and the system calls ordinary
 * programs need. Credentials are denied after reading is allowed, because in a profile
 * the last matching rule wins. The network is denied unless allowed.
 */
export function seatbeltProfile(options: SeatbeltOptions): string {
  const writable = [options.projectRoot, ...(options.writable ?? []).map((dir) => expandHome(dir, options.home)), '/private/tmp'];
  if (options.tmpdir) writable.push(options.tmpdir);
  const writableRules = [...new Set(writable.filter((dir) => fs.existsSync(dir)).map(realDirectory))].map((dir) => `  (subpath ${quote(dir)})`);
  const hidden = existingHidden(options.hidden, options.home).map((entry) =>
    entry.directory ? `  (subpath ${quote(entry.path)})` : `  (literal ${quote(entry.path)})`
  );
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-exec process-fork)',
    '(allow signal (target same-sandbox))',
    '(allow process-info* (target same-sandbox))',
    '(allow file-read*)',
    '(allow file-write*',
    ...writableRules,
    '  (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper")',
    '  (regex #"^/dev/tty"))',
    '(allow file-ioctl (regex #"^/dev/tty"))',
    ...(hidden.length ? ['(deny file-read* file-write*', ...hidden, ')'] : []),
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix-shm* ipc-posix-sem)',
    '(allow pseudo-tty)',
    '(allow network-outbound (remote unix-socket))',
    ...(options.network ? ['(allow network*)'] : []),
  ].join('\n');
}

export function seatbeltSandbox(options: SeatbeltOptions): Sandbox {
  return {
    kind: 'seatbelt',
    reason: `Seatbelt through ${SANDBOX_EXEC}`,
    note: `This command ran in a Seatbelt sandbox${options.network ? '' : ' with the network off'}, where only the project and temporary directories are writable. If it needed more, the user can set sandbox.network or sandbox.writable in .jamcli/config.json.`,
    wrap: (command) => ({ file: SANDBOX_EXEC, args: ['-p', seatbeltProfile(options), '/bin/sh', '-c', command] }),
  };
}
