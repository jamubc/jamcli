# Tasks

## 1. The escape suite on macOS

- [x] 1.1 `escape.test.ts` runs its attempts under the platform's sandbox: bubblewrap or
  Seatbelt, with a directory outside every writable path to aim at.
- [x] 1.2 Run it on this Mac, and on the macOS runner, and record what held.

## 2. The analyzer

- [x] 2.1 A test that fails today for each hole: `rg --hostname-bin`, `file -C`, git's
  `--ext-diff` and `--textconv`; the read-only list refuses them.
- [x] 2.2 A test that fails today: in `accept-edits`, an edit to `.git/config` or a write under
  `.git/hooks/` or `.jamcli/` asks; the engine makes it so.
- [x] 2.3 The differential fuzz test against `/bin/sh` with recording stubs.

## 3. Close

- [x] 3.1 `docs/security.md` says what the suites prove and what stays open.
- [x] 3.2 Record the unit in `SEQUENCE.md`.
