import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * A stand-in for the GitHub CLI on PATH: it reports a version, answers `auth status` as
 * signed in unless told otherwise, and for `pr create` keeps the body it was given and
 * prints an address. Every call is logged, so a test can check what JamCLI asked of it.
 */
export function fakeGh(options: { signedOut?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-gh-'));
  const log = path.join(dir, 'calls.log');
  const body = path.join(dir, 'body.md');
  fs.writeFileSync(
    path.join(dir, 'gh'),
    [
      '#!/bin/sh',
      `echo "$@" >> '${log}'`,
      'case "$1" in',
      '  --version) echo "gh version 2.99.0"; exit 0 ;;',
      `  auth) ${options.signedOut ? 'echo "You are not logged into any GitHub hosts." >&2; exit 1' : 'exit 0'} ;;`,
      `  pr) cat > '${body}'; echo "https://github.com/example/repo/pull/7"; exit 0 ;;`,
      'esac',
      'exit 1',
      '',
    ].join('\n')
  );
  fs.chmodSync(path.join(dir, 'gh'), 0o755);
  return {
    /** A PATH with this gh first. */
    path: `${dir}${path.delimiter}${process.env.PATH ?? ''}`,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
    body: () => (fs.existsSync(body) ? fs.readFileSync(body, 'utf8') : undefined),
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
