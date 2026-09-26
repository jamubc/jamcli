# Change: Windows support

## Why

`windows-x64` has been a declared release target since `scripts/compile.ts` was written,
and the 2.0.0 release notes name it as dropped rather than shipped. It was never actually
exercised until `rehaul-jamcli`'s first real CI run (2026-09-26), which failed on nearly
the whole suite on `windows-latest`. The cause is not a handful of path bugs: three
requirements the spec already states in platform-neutral terms have no Windows
implementation at all.

- **Command Sandbox** falls back to its documented "no sandbox available" scenario on
  Windows, which is honest but is not the parity the requirement's title implies.
- **Credential Storage** names "the operating system's credential store" but only reads
  macOS Keychain and Linux Secret Service; there is no Windows Credential Manager path.
- **Shell Command Execution** terminates "its process group" on timeout or cancellation,
  which does not exist on Windows; nothing stands in for it there.

Shipping a `windows-x64` binary without these is shipping a name, not the thing the name
promises: an unsandboxed agent with real file and command access, silently.

## What Changes

- A real Windows sandbox primitive, or an explicit, disclosed decision that none exists
  yet and commands run unsandboxed there by design, not by omission.
- Provider credentials stored in Windows Credential Manager, matching the Keychain and
  Secret Service paths already built.
- Command timeout and cancellation implemented with a Windows equivalent (a Job Object is
  the leading candidate; see `design.md`) so a timed-out or cancelled command actually
  stops, including anything it spawned.
- The path- and permission-bit assumptions the first CI run surfaced in the test suite
  itself (hardcoded `/` separators, `mode & 0o111` executable checks, short-path/long-path
  mismatches) corrected where they are test bugs, or turned into real platform code where
  they are not.
- `windows-latest` back in `.github/workflows/ci.yml`'s gate matrix, and `windows-x64`
  back in `.github/workflows/release.yml`'s compiled targets, once the above hold.
- `docs/feature-matrix.md` updated to drop the Windows gap notes this change closes.

## Impact

- Affected specs: `jamcli` (Command Sandbox, Credential Storage, Shell Command
  Execution).
- Affected code: `src/core/sandbox/` (a new Windows sandbox module beside `bwrap.ts`),
  wherever credential storage's Keychain/Secret Service paths live, `src/core/tools/`'s
  command execution and timeout path, and the test files the first CI run flagged
  (`src/__tests__/exercise.test.ts`, `src/cli/__tests__/config.test.ts`,
  `scripts/__tests__/build.test.ts`, and others found once `windows-latest` runs again).
- Affected CI/release: `.github/workflows/ci.yml`, `.github/workflows/release.yml`,
  `docs/feature-matrix.md`.
- Not affected: the local-first path (Ollama, no network) is already platform-neutral and
  is not touched by this change.
