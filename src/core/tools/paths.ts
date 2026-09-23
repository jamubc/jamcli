import fs from 'fs';
import path from 'path';

/**
 * Resolve a path through symbolic links. When the path does not exist yet, resolve its
 * nearest existing ancestor and re-append the rest, so a file about to be created is
 * judged by where it would really land.
 */
export function realpathOfNearest(target: string): string {
  let current = target;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch (error: any) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      const parent = path.dirname(current);
      if (parent === current) return target;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

const isInside = (candidate: string, base: string): boolean => {
  if (candidate === base) return true;
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return candidate.startsWith(prefix);
};

export interface ResolvePathOptions {
  /** Further directories, absolute or relative to the project root, that tools may reach. */
  additionalRoots?: string[];
}

/**
 * Resolve a tool path against the project root and refuse anything that escapes it,
 * either lexically (`../`) or through a symbolic link that points outside. The
 * returned path is the lexical absolute path; the check uses the real one.
 */
export function resolveProjectPath(projectRoot: string, target: string, options: ResolvePathOptions = {}): string {
  if (typeof target !== 'string' || !target.length) {
    throw new Error('A path argument is required.');
  }
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, target);
  const roots = [root, ...(options.additionalRoots ?? []).map((entry) => path.resolve(root, entry))];

  const lexicallyInside = roots.find((base) => isInside(absolute, base));
  if (!lexicallyInside) {
    throw new Error(`Path ${target} escapes the project root.`);
  }
  const realAbsolute = realpathOfNearest(absolute);
  const reallyInside = roots.some((base) => isInside(realAbsolute, realpathOfNearest(base)));
  if (!reallyInside) {
    throw new Error(`Path ${target} escapes the project root through a symbolic link.`);
  }
  return absolute;
}

/**
 * Count non-overlapping occurrences of a snippet. Used to reject an ambiguous
 * find/replace before it silently edits the first match.
 */
export function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = content.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }
  return count;
}
