/**
 * Pure helpers for find-and-replace edits. Replacement text is always inserted
 * literally: `String.prototype.replace` with a string replacement interprets `$$`,
 * `$&`, `` $` ``, and `$'`, which silently corrupts shell scripts, regular expressions,
 * and template code.
 */

export type LineEnding = '\n' | '\r\n';

export const detectLineEnding = (content: string): LineEnding => (content.includes('\r\n') ? '\r\n' : '\n');

export const withLineEnding = (text: string, eol: LineEnding): string =>
  eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text;

export interface ReplaceOptions {
  /** Replace every occurrence. */
  all?: boolean;
  /** Replace only this occurrence, counted from 1. */
  occurrence?: number;
}

export interface ReplaceResult {
  content: string;
  replaced: number;
  /** 1-indexed line where the first replacement starts. */
  startLine: number;
  /** 1-indexed line where the first replacement ends. */
  endLine: number;
}

export class FindNotFoundError extends Error {
  constructor(readonly path: string) {
    super(`find_string was not found in ${path}.`);
    this.name = 'FindNotFoundError';
  }
}

/** Raised when a find/replace target matches more than one location. */
export class AmbiguousMatchError extends Error {
  constructor(readonly path: string, readonly matchCount: number) {
    super(
      `find_string matches ${matchCount} locations in ${path}; this edit is ambiguous. Provide a unique snippet, an occurrence number, or replace_all.`
    );
    this.name = 'AmbiguousMatchError';
  }
}

const indexesOf = (content: string, needle: string): number[] => {
  const found: number[] = [];
  let index = content.indexOf(needle);
  while (index !== -1) {
    found.push(index);
    index = content.indexOf(needle, index + needle.length);
  }
  return found;
};

const lineAt = (content: string, index: number): number => content.slice(0, index).split('\n').length;

/**
 * Replace `find` with `replace` in `content`. A file with CRLF line endings keeps
 * them: a snippet written with LF is matched and inserted in the file's convention.
 */
export function replaceLiteral(
  content: string,
  find: string,
  replace: string,
  path: string,
  options: ReplaceOptions = {}
): ReplaceResult {
  const eol = detectLineEnding(content);
  let needle = find;
  if (eol === '\r\n' && !content.includes(needle) && needle.includes('\n')) {
    needle = withLineEnding(needle, eol);
  }
  const insert = withLineEnding(replace, eol);
  const matches = indexesOf(content, needle);
  if (!matches.length) throw new FindNotFoundError(path);

  let targets: number[];
  if (options.all) {
    targets = matches;
  } else if (typeof options.occurrence === 'number') {
    const pick = matches[options.occurrence - 1];
    if (pick === undefined) {
      throw new Error(`occurrence ${options.occurrence} does not exist; find_string matches ${matches.length} locations in ${path}.`);
    }
    targets = [pick];
  } else if (matches.length > 1) {
    throw new AmbiguousMatchError(path, matches.length);
  } else {
    targets = matches;
  }

  let result = '';
  let cursor = 0;
  for (const index of targets) {
    result += content.slice(cursor, index) + insert;
    cursor = index + needle.length;
  }
  result += content.slice(cursor);

  const startLine = lineAt(content, targets[0]);
  const endLine = startLine + insert.split('\n').length - 1;
  return { content: result, replaced: targets.length, startLine, endLine };
}
