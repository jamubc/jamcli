## 1. Decide

- [ ] 1.1 Spike a Job Object plus restricted token as the Windows sandbox primitive; record
  what it actually restricts (process/resource limits are straightforward; filesystem
  read-only/writable and network on/off need to be verified, not assumed). Decide between
  that, AppContainer, or shipping the disclosed "no sandbox available" fallback on
  purpose. Record the decision and why in this file.
- [ ] 1.2 Decide the credential storage path: shell out to `cmdkey`/`vaultcmd`, or a
  native DPAPI binding. Verify against a real Windows Credential Manager, not
  documentation alone.
- [ ] 1.3 Confirm a Job Object assigned at process creation is the cancellation and
  timeout mechanism, replacing "kill the process group".

## 2. Build

- [ ] 2.1 Implement the chosen sandbox primitive in `src/core/sandbox/` beside `bwrap.ts`
  and `seatbelt.ts` (whatever that macOS file is actually named), wired through the same
  `detect.ts` dispatch.
- [ ] 2.2 Implement Windows Credential Manager storage and retrieval, matching the
  `jamcli auth set` and `doctor` behavior the Keychain and Secret Service paths already
  have.
- [ ] 2.3 Implement Job Object-based timeout and cancellation for `run_command` and the
  background job path, matching the existing scenarios in "Shell Command Execution".
- [ ] 2.4 Audit and fix the path- and permission-bit assumptions the first CI run
  surfaced: `src/__tests__/exercise.test.ts` (short-path vs long-path temp directories),
  `src/cli/__tests__/config.test.ts` (hardcoded `/` in expected output strings, should be
  `path.sep` or `path.join`), `scripts/__tests__/build.test.ts` (the shebang and
  `mode & 0o111` executable-bit check, meaningless on Windows), and whatever else
  `windows-latest` still flags once 2.1-2.3 land.

## 3. Verify

- [ ] 3.1 `windows-latest` added back to `.github/workflows/ci.yml`'s gate matrix, without
  `continue-on-error`, passing the same suite Linux and macOS pass.
- [ ] 3.2 `windows-x64` added back to `.github/workflows/release.yml`'s compiled targets.
- [ ] 3.3 `docs/feature-matrix.md` and `docs/migration.md` updated to drop the Windows
  gap notes this change closes.
- [ ] 3.4 The four gates, plus a real `jamcli` run on a Windows machine or a Windows CI
  runner: model listing, a tool-using turn, an edit with approval, and a command, the same
  shape as the unit's own live local check.

## 4. Archive

- [ ] 4.1 Apply this change's spec deltas to `openspec/specs/jamcli/spec.md`, move it to
  `openspec/changes/archive/`, run `openspec validate --all --strict`, and update
  `openspec/SEQUENCE.md` and this project's `AGENTS.md` "Known state".
