import { execFile } from 'child_process';

/**
 * The working copy's changes by file and hunk, and the three things a person can do with a
 * hunk: stage it, unstage it, or revert it (D15). Each goes through `git apply` with a
 * patch of that one hunk, so git checks it against the index or the file first and
 * refuses a hunk that no longer fits.
 */

export interface Hunk {
  /** The file, from the repository's top. */
  file: string;
  /** Whether it is in the index rather than only in the working copy. */
  staged: boolean;
  /** The `@@ -a,b +c,d @@` line. */
  header: string;
  /** The file's header and this hunk alone, as `git apply` takes it. */
  patch: string;
  added: number;
  removed: number;
}

export interface FileChange {
  file: string;
  staged: boolean;
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary';
  /** The whole diff of the file. */
  diff: string;
  /** Empty for a binary file, which is staged or reverted whole. */
  hunks: Hunk[];
}

export interface Changes {
  /** The repository's top directory; paths are relative to it. */
  root: string;
  staged: FileChange[];
  unstaged: FileChange[];
  /** Files git does not track and does not ignore. */
  untracked: string[];
}

function git(args: string[], cwd: string, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Split `git diff` output into files, and each file into hunks it can apply alone. */
export function parseDiff(text: string, staged: boolean): FileChange[] {
  const files: FileChange[] = [];
  const sections = text.split(/^(?=diff --git )/m).filter((section) => section.startsWith('diff --git '));
  for (const section of sections) {
    const lines = section.replace(/\n$/, '').split('\n');
    const first = lines.findIndex((line) => line.startsWith('@@'));
    const head = first < 0 ? lines : lines.slice(0, first);
    const plus = head.find((line) => line.startsWith('+++ '));
    const minus = head.find((line) => line.startsWith('--- '));
    const named = (line: string | undefined) => line?.slice(4).replace(/^[ab]\//, '').trim();
    const fromGit = /^diff --git a\/(.+) b\/(.+)$/.exec(head[0]);
    const file = (plus && named(plus) !== '/dev/null' ? named(plus) : named(minus)) ?? fromGit?.[2] ?? '';
    const kind: FileChange['kind'] = head.some((line) => line.startsWith('Binary files') || line === 'GIT binary patch')
      ? 'binary'
      : head.some((line) => line.startsWith('new file mode'))
        ? 'added'
        : head.some((line) => line.startsWith('deleted file mode'))
          ? 'deleted'
          : head.some((line) => line.startsWith('rename from'))
            ? 'renamed'
            : 'modified';
    const hunks: Hunk[] = [];
    if (first >= 0 && kind !== 'binary') {
      let start = first;
      for (let index = first + 1; index <= lines.length; index += 1) {
        if (index < lines.length && !lines[index].startsWith('@@')) continue;
        const body = lines.slice(start, index);
        hunks.push({
          file,
          staged,
          header: body[0].replace(/^(@@[^@]*@@).*$/, '$1'),
          patch: `${[...head, ...body].join('\n')}\n`,
          added: body.filter((line) => line.startsWith('+')).length,
          removed: body.filter((line) => line.startsWith('-')).length,
        });
        start = index;
      }
    }
    files.push({ file, staged, kind, diff: `${section.replace(/\n$/, '')}\n`, hunks });
  }
  return files;
}

/** The repository's top directory, or nothing outside a repository. */
export async function repositoryRoot(projectRoot: string): Promise<string | undefined> {
  return git(['rev-parse', '--show-toplevel'], projectRoot).then(
    (out) => out.trim() || undefined,
    () => undefined
  );
}

export async function readChanges(projectRoot: string): Promise<Changes> {
  const root = await repositoryRoot(projectRoot);
  if (!root) throw new Error('This project is not a git repository, so there is nothing to review with /diff.');
  const flags = ['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U3'];
  const [unstaged, staged, untracked] = await Promise.all([
    git(flags, root),
    git([...flags, '--cached'], root),
    git(['ls-files', '--others', '--exclude-standard', '-z'], root),
  ]);
  return {
    root,
    staged: parseDiff(staged, true),
    unstaged: parseDiff(unstaged, false),
    untracked: untracked.split('\0').filter(Boolean),
  };
}

/** Put an unstaged hunk in the index. */
export const stageHunk = (root: string, hunk: Hunk) => git(['apply', '--cached', '--whitespace=nowarn', '-'], root, hunk.patch);

/** Take a staged hunk out of the index; the working copy keeps it. */
export const unstageHunk = (root: string, hunk: Hunk) => git(['apply', '--cached', '-R', '--whitespace=nowarn', '-'], root, hunk.patch);

/** Undo an unstaged hunk in the working copy. */
export const revertHunk = (root: string, hunk: Hunk) => git(['apply', '-R', '--whitespace=nowarn', '-'], root, hunk.patch);

/** Stage or unstage a whole file, for a binary or untracked one. */
export const stageFile = (root: string, file: string) => git(['add', '--', file], root);
export const unstageFile = (root: string, file: string) => git(['reset', '-q', '--', file], root);
/** Put a whole file back as the index has it, for a binary one. */
export const revertFile = (root: string, file: string) => git(['checkout', '-q', '--', file], root);
