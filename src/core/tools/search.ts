import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import ignore, { type Ignore } from 'ignore';

/**
 * File listing and text search for the `glob` and `grep` tools. ripgrep is used when it
 * is on PATH; otherwise a directory walk with the same rules takes over. Both honor
 * `.gitignore` and `.ignore` files, the configured ignore patterns, and hidden-file
 * rules, and both use gitignore-style globs, so a pattern means the same thing
 * whichever backend runs. Neither stops silently: every limit that cuts a result short
 * is reported in it.
 */

export type SearchBackend = 'auto' | 'ripgrep' | 'builtin';

export interface SearchScope {
  root: string;
  /** A directory or file under the root to search instead of the whole root. */
  start?: string;
  includeHidden?: boolean;
  ignorePatterns?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  backend?: SearchBackend;
}

export interface ListOptions extends SearchScope {
  glob?: string;
  includeDirs?: boolean;
  /** Stop after this many paths. */
  limit: number;
}

export interface ListResult {
  paths: { rel: string; isDir: boolean }[];
  /** True when the limit or the time budget cut the listing short. */
  incomplete: boolean;
  reason?: string;
  backend: 'ripgrep' | 'builtin';
}

export type GrepOutputMode = 'content' | 'files' | 'count';

export interface GrepOptions extends SearchScope {
  pattern: string;
  caseSensitive?: boolean;
  glob?: string;
  context?: number;
  mode?: GrepOutputMode;
  limit: number;
}

export interface GrepLine {
  line: number;
  text: string;
  match: boolean;
}

export interface GrepFileResult {
  rel: string;
  lines: GrepLine[];
  count: number;
}

export interface GrepResult {
  files: GrepFileResult[];
  matchCount: number;
  filesScanned?: number;
  incomplete: boolean;
  reason?: string;
  backend: 'ripgrep' | 'builtin';
  note?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BUILTIN_FILE_BYTES = 5 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_000;
const MAX_LINE_CHARS = 500;

let ripgrepPath: string | null | undefined;

/** Locate ripgrep on PATH once. */
export function findRipgrep(): string | null {
  if (ripgrepPath !== undefined) return ripgrepPath;
  const names = process.platform === 'win32' ? ['rg.exe', 'rg'] : ['rg'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        ripgrepPath = candidate;
        return candidate;
      } catch {
        // Keep looking.
      }
    }
  }
  ripgrepPath = null;
  return null;
}

const useRipgrep = (backend: SearchBackend | undefined): string | null =>
  backend === 'builtin' ? null : findRipgrep();

const toPosix = (value: string) => value.split(path.sep).join('/');

const clip = (text: string) => (text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text);

/** A gitignore-style matcher for one glob, used to include rather than exclude. */
const globMatcher = (glob: string | undefined): ((rel: string) => boolean) => {
  if (!glob || glob === '**/*' || glob === '**') return () => true;
  const matcher = ignore().add(glob);
  return (rel: string) => matcher.ignores(rel);
};

interface Rule {
  base: string;
  ig: Ignore;
}

const readRules = (dir: string): Rule | null => {
  const ig = ignore();
  let found = false;
  for (const name of ['.gitignore', '.ignore', '.rgignore']) {
    try {
      ig.add(fs.readFileSync(path.join(dir, name), 'utf8'));
      found = true;
    } catch {
      // No such file here.
    }
  }
  return found ? { base: dir, ig } : null;
};

/** Ignore files from the project root's ancestors, up to the enclosing git repository root. */
const ancestorRules = (root: string): Rule[] => {
  const rules: Rule[] = [];
  let current = path.dirname(root);
  let depth = 0;
  if (fs.existsSync(path.join(root, '.git'))) return rules;
  while (depth < 32) {
    const rule = readRules(current);
    if (rule) rules.unshift(rule);
    if (fs.existsSync(path.join(current, '.git'))) return rules;
    const parent = path.dirname(current);
    if (parent === current) return [];
    current = parent;
    depth += 1;
  }
  return [];
};

const isIgnored = (rules: Rule[], abs: string, isDir: boolean): boolean => {
  for (const rule of rules) {
    const rel = toPosix(path.relative(rule.base, abs));
    if (!rel || rel.startsWith('..')) continue;
    if (rule.ig.ignores(isDir ? `${rel}/` : rel)) return true;
  }
  return false;
};

interface WalkEntry {
  rel: string;
  abs: string;
  isDir: boolean;
}

/** Walk the tree depth first, pruning ignored directories before entering them. */
async function* walk(scope: SearchScope, deadline: number): AsyncGenerator<WalkEntry> {
  const root = path.resolve(scope.root);
  const configRule: Rule = { base: root, ig: ignore().add(scope.ignorePatterns ?? []) };
  const baseRules = [...ancestorRules(root), configRule];
  const start = scope.start ? path.resolve(root, scope.start) : root;

  const startStat = await fs.promises.stat(start);
  if (startStat.isFile()) {
    yield { rel: toPosix(path.relative(root, start)), abs: start, isDir: false };
    return;
  }

  // Ignore files between the root and `start` still apply to everything under `start`.
  const inherited: Rule[] = [...baseRules];
  if (start !== root) {
    let dir = root;
    for (const part of path.relative(root, start).split(path.sep)) {
      const rule = readRules(dir);
      if (rule) inherited.push(rule);
      dir = path.join(dir, part);
    }
  }

  const stack: { dir: string; rules: Rule[] }[] = [{ dir: start, rules: inherited }];
  while (stack.length) {
    if (scope.signal?.aborted) throw Object.assign(new Error('Search cancelled.'), { name: 'AbortError' });
    if (Date.now() > deadline) return;
    const { dir, rules: parentRules } = stack.pop()!;
    const own = readRules(dir);
    const rules = own ? [...parentRules, own] : parentRules;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      if (!scope.includeHidden && entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      const isDir = entry.isDirectory();
      if (!isDir && !entry.isFile() && !entry.isSymbolicLink()) continue;
      if (isIgnored(rules, abs, isDir)) continue;
      const rel = toPosix(path.relative(root, abs));
      if (isDir) {
        subdirs.push(abs);
        yield { rel, abs, isDir: true };
      } else {
        yield { rel, abs, isDir: false };
      }
    }
    for (const sub of subdirs.reverse()) stack.push({ dir: sub, rules });
  }
}

const deadlineFor = (scope: SearchScope) => Date.now() + (scope.timeoutMs ?? DEFAULT_TIMEOUT_MS);

const ripgrepScopeArgs = (scope: SearchScope, glob: string | undefined): string[] => {
  const args = ['--no-require-git', '--no-config', '--no-messages'];
  if (scope.includeHidden) args.push('--hidden');
  // ripgrep lets the last matching --glob win, so the include glob comes first and the
  // exclusions after it; otherwise `**/*.ts` would re-include `node_modules/x.ts`.
  if (glob && glob !== '**/*') args.push('--glob', glob);
  if (scope.includeHidden) args.push('--glob', '!.git');
  for (const pattern of scope.ignorePatterns ?? []) args.push('--glob', `!${pattern}`);
  return args;
};

/** Run ripgrep and hand each stdout line to `onLine`; `onLine` returns false to stop early. */
const runRipgrep = (
  rg: string,
  args: string[],
  cwd: string,
  scope: SearchScope,
  onLine: (line: string) => boolean
): Promise<{ stopped: boolean; timedOut: boolean; stderr: string; code: number | null }> =>
  new Promise((resolve, reject) => {
    const child = spawn(rg, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    let stopped = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, scope.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => child.kill('SIGTERM');
    scope.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (data: Buffer) => {
      if (stopped) return;
      buffer += data.toString('utf8');
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!onLine(line)) {
          stopped = true;
          child.kill('SIGTERM');
          return;
        }
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      scope.signal?.removeEventListener('abort', onAbort);
      if (!stopped && buffer.trim()) onLine(buffer);
      if (scope.signal?.aborted) {
        reject(Object.assign(new Error('Search cancelled.'), { name: 'AbortError' }));
        return;
      }
      resolve({ stopped, timedOut, stderr, code });
    });
  });

const startDir = (scope: SearchScope): { cwd: string; target: string } => {
  const root = path.resolve(scope.root);
  return { cwd: root, target: scope.start ? toPosix(path.relative(root, path.resolve(root, scope.start))) || '.' : '.' };
};

/** List files, and optionally directories, matching a glob. */
export async function listPaths(options: ListOptions): Promise<ListResult> {
  const rg = options.includeDirs ? null : useRipgrep(options.backend);
  if (rg) {
    const paths: { rel: string; isDir: boolean }[] = [];
    const { cwd, target } = startDir(options);
    const outcome = await runRipgrep(rg, ['--files', ...ripgrepScopeArgs(options, options.glob), target], cwd, options, (line) => {
      const rel = toPosix(line.replace(/^\.\//, ''));
      if (rel) paths.push({ rel, isDir: false });
      return paths.length < options.limit;
    });
    return {
      paths,
      incomplete: outcome.stopped || outcome.timedOut,
      reason: outcome.timedOut ? 'the time limit was reached' : outcome.stopped ? `the limit of ${options.limit} paths was reached` : undefined,
      backend: 'ripgrep',
    };
  }

  const matches = globMatcher(options.glob);
  const deadline = deadlineFor(options);
  const paths: { rel: string; isDir: boolean }[] = [];
  let limited = false;
  for await (const entry of walk(options, deadline)) {
    if (entry.isDir && !options.includeDirs) continue;
    if (!matches(entry.rel)) continue;
    paths.push({ rel: entry.rel, isDir: entry.isDir });
    if (paths.length >= options.limit) {
      limited = true;
      break;
    }
  }
  const timedOut = !limited && Date.now() > deadline;
  return {
    paths,
    incomplete: limited || timedOut,
    reason: timedOut ? 'the time limit was reached' : limited ? `the limit of ${options.limit} paths was reached` : undefined,
    backend: 'builtin',
  };
}

const compile = (pattern: string, caseSensitive: boolean): RegExp => {
  try {
    return new RegExp(pattern, caseSensitive ? '' : 'i');
  } catch (error: any) {
    throw new Error(`grep pattern is not a valid regular expression: ${error?.message ?? error}`);
  }
};

const looksBinary = (buffer: Buffer): boolean => buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);

async function grepBuiltin(options: GrepOptions): Promise<GrepResult> {
  const regex = compile(options.pattern, options.caseSensitive ?? true);
  const matches = globMatcher(options.glob);
  const deadline = deadlineFor(options);
  const context = Math.max(0, options.context ?? 0);
  const mode = options.mode ?? 'content';
  const files: GrepFileResult[] = [];
  let matchCount = 0;
  let filesScanned = 0;
  let limited = false;
  let skippedLarge = 0;

  outer: for await (const entry of walk(options, deadline)) {
    if (entry.isDir || !matches(entry.rel)) continue;
    let buffer: Buffer;
    try {
      const stat = await fs.promises.stat(entry.abs);
      if (stat.size > MAX_BUILTIN_FILE_BYTES) {
        skippedLarge += 1;
        continue;
      }
      buffer = await fs.promises.readFile(entry.abs);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;
    filesScanned += 1;
    const lines = buffer.toString('utf8').split(/\r?\n/);
    const found: number[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      if (regex.test(lines[i])) found.push(i);
    }
    if (!found.length) continue;

    const result: GrepFileResult = { rel: entry.rel, lines: [], count: found.length };
    if (mode === 'content') {
      const chosen: number[] = [];
      for (const index of found) {
        if (matchCount >= options.limit) {
          limited = true;
          break;
        }
        matchCount += 1;
        chosen.push(index);
      }
      if (!chosen.length) break outer;
      const matchSet = new Set(chosen);
      const include = new Set<number>();
      for (const index of chosen) {
        for (let j = Math.max(0, index - context); j <= Math.min(lines.length - 1, index + context); j += 1) {
          include.add(j);
        }
      }
      result.count = chosen.length;
      result.lines = [...include]
        .sort((a, b) => a - b)
        .map((index) => ({ line: index + 1, text: clip(lines[index]), match: matchSet.has(index) }));
    } else {
      matchCount += found.length;
    }
    files.push(result);
    if (limited || (mode !== 'content' && files.length >= options.limit)) {
      limited = true;
      break outer;
    }
  }
  const timedOut = !limited && Date.now() > deadline;
  const notes: string[] = [];
  if (skippedLarge) notes.push(`${skippedLarge} files over 5 MB were skipped`);
  return {
    files,
    matchCount,
    filesScanned,
    incomplete: limited || timedOut,
    reason: timedOut ? 'the time limit was reached' : limited ? `the limit of ${options.limit} results was reached` : undefined,
    backend: 'builtin',
    note: notes.length ? notes.join('; ') : undefined,
  };
}

const rgText = (value: any): string => {
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.bytes === 'string') return Buffer.from(value.bytes, 'base64').toString('utf8');
  return '';
};

async function grepRipgrep(rg: string, options: GrepOptions): Promise<GrepResult | null> {
  const mode = options.mode ?? 'content';
  const { cwd, target } = startDir(options);
  const args = ['--json', ...ripgrepScopeArgs(options, options.glob)];
  if (!(options.caseSensitive ?? true)) args.push('--ignore-case');
  else args.push('--case-sensitive');
  if (mode === 'content' && options.context) args.push('--context', String(options.context));
  args.push('--regexp', options.pattern, '--', target);

  const byFile = new Map<string, GrepFileResult>();
  const order: string[] = [];
  let matchCount = 0;
  let limited = false;
  const outcome = await runRipgrep(rg, args, cwd, options, (line) => {
    if (!line.trim()) return true;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return true;
    }
    if (event.type !== 'match' && event.type !== 'context') return true;
    const rel = toPosix(rgText(event.data?.path).replace(/^\.\//, ''));
    let file = byFile.get(rel);
    if (!file) {
      if (mode !== 'content' && order.length >= options.limit) {
        limited = true;
        return false;
      }
      file = { rel, lines: [], count: 0 };
      byFile.set(rel, file);
      order.push(rel);
    }
    const text = clip(rgText(event.data?.lines).replace(/\r?\n$/, ''));
    if (event.type === 'match') {
      if (mode === 'content' && matchCount >= options.limit) {
        limited = true;
        return false;
      }
      matchCount += 1;
      file.count += 1;
      if (mode === 'content') file.lines.push({ line: event.data.line_number, text, match: true });
    } else if (mode === 'content') {
      file.lines.push({ line: event.data.line_number, text, match: false });
    }
    return true;
  });

  if (outcome.code === 2 && !byFile.size && /regex|parse error|syntax/i.test(outcome.stderr)) {
    // ripgrep's regex dialect rejected the pattern; the JavaScript engine may accept it.
    return null;
  }
  const files = order.map((rel) => byFile.get(rel)!).filter((file) => mode !== 'content' || file.count > 0);
  for (const file of files) {
    const seen = new Set<number>();
    file.lines = file.lines.filter((entry) => (seen.has(entry.line) ? false : (seen.add(entry.line), true)));
    file.lines.sort((a, b) => a.line - b.line);
  }
  return {
    files,
    matchCount,
    incomplete: limited || outcome.timedOut,
    reason: outcome.timedOut ? 'the time limit was reached' : limited ? `the limit of ${options.limit} results was reached` : undefined,
    backend: 'ripgrep',
  };
}

/** Search file contents for a regular expression. */
export async function grepFiles(options: GrepOptions): Promise<GrepResult> {
  compile(options.pattern, options.caseSensitive ?? true);
  const rg = useRipgrep(options.backend);
  if (rg) {
    const result = await grepRipgrep(rg, options);
    if (result) return result;
    const fallback = await grepBuiltin(options);
    return { ...fallback, note: 'ripgrep rejected the pattern, so the JavaScript regex engine was used' };
  }
  return grepBuiltin(options);
}

/** Render grep results in ripgrep's familiar shape. */
export function formatGrep(result: GrepResult, mode: GrepOutputMode, pattern: string): string {
  const lines: string[] = [];
  if (!result.files.length) {
    lines.push(`No matches for /${pattern}/${result.filesScanned !== undefined ? ` across ${result.filesScanned} files` : ''}.`);
  } else if (mode === 'files') {
    for (const file of result.files) lines.push(file.rel);
  } else if (mode === 'count') {
    for (const file of result.files) lines.push(`${file.rel}:${file.count}`);
  } else {
    const groups: string[] = [];
    for (const file of result.files) {
      let group: string[] = [];
      let previous = -1;
      for (const entry of file.lines) {
        if (previous !== -1 && entry.line > previous + 1) {
          groups.push(group.join('\n'));
          group = [];
        }
        const separator = entry.match ? ':' : '-';
        group.push(`${file.rel}${separator}${entry.line}${separator}${entry.text}`);
        previous = entry.line;
      }
      if (group.length) groups.push(group.join('\n'));
    }
    lines.push(groups.join('\n--\n'));
  }
  if (result.incomplete) {
    lines.push(`\n[Search stopped early: ${result.reason}. Narrow the pattern, the path, or the glob to see the rest.]`);
  }
  if (result.note) lines.push(`\n[${result.note}.]`);
  return lines.join('\n');
}
