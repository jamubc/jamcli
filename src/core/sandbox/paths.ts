import fs from 'fs';
import os from 'os';
import path from 'path';

/** Credentials commonly kept in a home directory. A sandboxed command sees these as empty. */
export const DEFAULT_HIDDEN = [
  '~/.ssh',
  '~/.gnupg',
  '~/.aws',
  '~/.azure',
  '~/.config/gcloud',
  '~/.config/gh',
  '~/.docker/config.json',
  '~/.kube',
  '~/.netrc',
  '~/.npmrc',
];

export const expandHome = (value: string, home = os.homedir()) =>
  value === '~' ? home : value.startsWith('~/') ? path.join(home, value.slice(2)) : value;

/** The real path of a directory, or of its nearest existing ancestor joined with the rest. */
export const realDirectory = (value: string): string => {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
};

export interface HiddenPath {
  path: string;
  directory: boolean;
}

/** The hidden paths that exist, as real paths, so a mount or rule can cover each one. */
export function existingHidden(extra: string[] = [], home = os.homedir()): HiddenPath[] {
  const out: HiddenPath[] = [];
  for (const entry of [...DEFAULT_HIDDEN, ...extra]) {
    const absolute = expandHome(entry, home);
    try {
      const stat = fs.statSync(absolute);
      out.push({ path: realDirectory(absolute), directory: stat.isDirectory() });
    } catch {
      // Nothing there to hide.
    }
  }
  return out;
}
