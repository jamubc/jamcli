import path from 'path';

/**
 * Resolve a tool path against the project root and refuse anything that escapes
 * it. The check mirrors the guard the old ToolService.resolvePath enforced.
 */
export function resolveProjectPath(projectRoot: string, target: string): string {
  if (typeof target !== 'string' || !target.length) {
    throw new Error('A path argument is required.');
  }
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, target);
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (absolute !== root && !absolute.startsWith(rootWithSep)) {
    throw new Error(`Path ${target} escapes the project root.`);
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
