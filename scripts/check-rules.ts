/**
 * The hard rules in AGENTS.md that a tool can hold, held on every push:
 *
 * - no em dash (U+2014) in any tracked text file;
 * - each commit in the given range is a conventional commit, lowercase, with no em dash and
 *   no AI attribution.
 *
 *   bun scripts/check-rules.ts [<range>]      e.g. origin/master..HEAD
 *
 * Without a range only the files are checked. Exits 1 and names each breach.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';

const EM_DASH = '\u2014';
const TYPES = 'feat|fix|docs|refactor|perf|test|build|ci|chore|style|revert';
const SUBJECT = new RegExp(`^(${TYPES})(\\([a-z0-9._/,-]+\\))?!?: \\S`);
/** A description that opens on a capitalized word, such as "Add"; a name like "Ctrl+O" is not one. */
const CAPITALIZED = /^[A-Z][a-z]+(\s|$)/;
const ATTRIBUTION = /^(co-authored-by:|generated with|\u{1F916})/imu;

/** Each line of a file's text that holds an em dash. */
export function fileBreaches(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) => (line.includes(EM_DASH) ? [`${file}:${index + 1}: an em dash; use a colon, a comma, or a full stop`] : []));
}

/** What a commit message breaks: the conventional form, lowercase, em dashes, attribution. */
export function commitBreaches(sha: string, message: string): string[] {
  const subject = message.split('\n')[0] ?? '';
  const breaches: string[] = [];
  if (!SUBJECT.test(subject)) breaches.push(`${sha}: "${subject}" is not a conventional commit (type(scope): description)`);
  else if (CAPITALIZED.test(subject.replace(/^[^:]*: /, ''))) breaches.push(`${sha}: "${subject}" opens its description on a capital; commits are lowercase`);
  if (message.includes(EM_DASH)) breaches.push(`${sha}: the message has an em dash`);
  if (ATTRIBUTION.test(message)) breaches.push(`${sha}: the message carries AI attribution; commits carry the owner's identity only`);
  return breaches;
}

if (import.meta.main) {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const breaches: string[] = [];
  for (const file of git('ls-files', '-z').split('\0').filter(Boolean)) {
    let text: Buffer;
    try {
      text = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (!text.includes(0)) breaches.push(...fileBreaches(file, text.toString('utf8')));
  }
  const range = process.argv[2];
  if (range) {
    for (const record of git('log', '--format=%h%x00%B%x1e', range).split('\x1e').map((entry) => entry.trim()).filter(Boolean)) {
      const [sha = '', message = ''] = record.split('\0');
      breaches.push(...commitBreaches(sha, message));
    }
  }
  if (breaches.length) {
    process.stderr.write(`${breaches.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`The hard rules hold${range ? ` for ${range}` : ''}.\n`);
}
