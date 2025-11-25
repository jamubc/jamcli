import fs from 'fs';
import path from 'path';

const JAMCLI_DIRECTORY = '.jamcli';

/**
 * Search upward from the provided starting directory to find the nearest `.jamcli`
 * directory. Returns the directory that contains `.jamcli`, or the resolved
 * starting directory if no ancestor contains it.
 */
export function resolveJamcliProjectRoot(startingDir: string = process.cwd()): string {
  const normalizedStart = path.resolve(startingDir);
  const rootPath = path.parse(normalizedStart).root;
  let current = normalizedStart;

  while (true) {
    const candidate = path.join(current, JAMCLI_DIRECTORY);
    if (fs.existsSync(candidate)) {
      return current;
    }
    if (current === rootPath) {
      break;
    }
    current = path.dirname(current);
  }

  return normalizedStart;
}
