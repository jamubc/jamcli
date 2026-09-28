import path from 'path';
import type { CommandAnalysis } from '../permissions/command.js';

/**
 * Programs that only read, when every argument stays inside the project. The list is
 * short on purpose: a program that can be told to write, such as `tee` or `sed -i`, is
 * not on it, and the ones that are have their writing flags refused below.
 */
export const READ_ONLY_COMMANDS = new Set(['cd', 'ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'rg', 'grep', 'find', 'git', 'tree', 'pwd', 'true']);

const GIT_READ_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'branch', 'rev-parse', 'ls-files']);
/** `git branch` flags that change branches. */
const GIT_BRANCH_WRITES = new Set(['-d', '-D', '-m', '-M', '-c', '-C', '-f', '-u', '--delete', '--move', '--copy', '--force', '--set-upstream-to', '--unset-upstream', '--edit-description', '--track', '--no-track']);
/** `find` actions that run something or write. The analyzer already refuses -exec and its kin. */
const FIND_WRITES = new Set(['-delete', '-fprint', '-fprint0', '-fprintf', '-fls', '-exec', '-execdir', '-ok', '-okdir']);

const program = (word: string) => word.replace(/^.*\//, '');

/** Whether a word names somewhere inside the project, or nowhere at all. */
const insideProject = (word: string, root: string): boolean => {
  if (word.includes('$') || word.includes('`') || word.startsWith('~')) return false;
  const resolved = path.resolve(root, word);
  return resolved === root || resolved.startsWith(root + path.sep);
};

/**
 * Why a command line is not read-only, or nothing when it is: every part is a program
 * from the list with no writing flag, every argument stays in the project, nothing is
 * redirected, and nothing runs code the parts do not show.
 */
export function readOnlyReason(analysis: CommandAnalysis, projectRoot: string, commands: Set<string> = READ_ONLY_COMMANDS): string | undefined {
  const root = path.resolve(projectRoot);
  if (analysis.hidden.length) return analysis.hidden[0];
  if (analysis.redirects.length) return `it redirects to ${analysis.redirects[0].target || 'an expansion'}`;
  if (!analysis.parts.length) return 'it runs nothing';
  for (const part of analysis.parts) {
    const words = part.split(/\s+/).filter(Boolean);
    const name = program(words[0] ?? '');
    if (!commands.has(name)) return `${name || part} is not a read-only program`;
    const rest = words.slice(1);
    if (name === 'git') {
      const own = rest.findIndex((word) => !word.startsWith('-'));
      const sub = own === -1 ? undefined : rest[own];
      if (!sub || !GIT_READ_SUBCOMMANDS.has(sub)) return `git ${sub ?? ''} is not a read-only subcommand`.trim();
      const args = rest.slice(own + 1);
      if (args.some((word) => word.startsWith('--output') || word === '-o')) return 'git --output writes a file';
      if (sub === 'branch' && args.some((word) => !word.startsWith('-') || GIT_BRANCH_WRITES.has(word.split('=')[0]))) return 'git branch with that argument changes branches';
    }
    if (name === 'find' && rest.some((word) => FIND_WRITES.has(word))) return `find ${rest.find((word) => FIND_WRITES.has(word))} writes or runs something`;
    if (name === 'tree' && rest.some((word) => word === '-o')) return 'tree -o writes a file';
    if ((name === 'rg' || name === 'grep') && rest.some((word) => word.startsWith('--pre'))) return `${name} --pre runs a command`;
    for (const word of rest) {
      const value = word.startsWith('-') ? (word.includes('=') ? word.slice(word.indexOf('=') + 1) : undefined) : word;
      if (value === undefined || value === '' || value === '.') continue;
      if (!insideProject(value, root)) return `${value} is outside the project or cannot be checked`;
    }
  }
  return undefined;
}
