import os from 'os';
import path from 'path';
import type { ToolCall } from '../types.js';
import { realpathOfNearest } from '../tools/paths.js';
import { analyzeCommand, type CommandAnalysis } from './command.js';
import type { Subject } from './rules.js';

/** Tools whose rules are about paths, keyed by their canonical name. */
const PATH_TOOLS = new Set(['read_file', 'write_file', 'edit', 'apply_patch', 'glob', 'grep']);

const posix = (value: string) => value.split(path.sep).join('/');
const expandHome = (value: string) => (value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);

const pathSubject = (absolute: string, base: string): Subject => {
  const relative = path.relative(base, absolute);
  const inside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  return { kind: 'path', absolute, ...(inside ? { relative: relative === '' ? '.' : posix(relative) } : {}) };
};

/**
 * A path as rules see it: its project-relative form when it is inside the project, and
 * its absolute form. The real path is a second subject, so a symbolic link cannot carry a
 * call past a rule about where it points.
 */
export function pathSubjects(projectRoot: string, target: string): Subject[] {
  const root = path.resolve(projectRoot);
  const realRoot = realpathOfNearest(root);
  const lexical = path.resolve(root, expandHome(target));
  const subjects = [pathSubject(lexical, root)];
  const real = realpathOfNearest(lexical);
  if (real !== lexical) subjects.push(pathSubject(real, realRoot));
  return subjects;
}

/** The files a unified diff names, old and new. */
export function patchPaths(patch: string): string[] {
  const files = new Set<string>();
  for (const match of patch.matchAll(/^(?:---|\+\+\+) (?:[ab]\/)?([^\t\n]+)/gm)) {
    const file = match[1].trim();
    if (file && file !== '/dev/null') files.add(file);
  }
  return [...files];
}

export interface CallSubjects {
  subjects: Subject[];
  /** Present for a command, which is judged part by part. */
  command?: CommandAnalysis;
}

/** What a call touches, for the tool it is really calling. */
export function subjectsOf(call: ToolCall, canonical: string, projectRoot: string): CallSubjects {
  const args = call.arguments ?? {};
  if (canonical === 'run_command') {
    const command = analyzeCommand(typeof args.command === 'string' ? args.command : '');
    return { subjects: command.parts.map((value) => ({ kind: 'command', value })), command };
  }
  if (PATH_TOOLS.has(canonical)) {
    const targets =
      canonical === 'apply_patch'
        ? patchPaths(typeof args.patch === 'string' ? args.patch : '')
        : [typeof args.path === 'string' && args.path ? args.path : '.'];
    return { subjects: targets.flatMap((target) => pathSubjects(projectRoot, target)) };
  }
  if (typeof args.url === 'string') {
    try {
      return { subjects: [{ kind: 'domain', value: new URL(args.url).hostname }] };
    } catch {
      return { subjects: [] };
    }
  }
  return { subjects: [] };
}
