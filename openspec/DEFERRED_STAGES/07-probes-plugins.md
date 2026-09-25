## Task 1: Store integrity gaps

**Description:** Rename and symlink handling in the integrity hash are unproven.

**Acceptance criteria:**
- [x] Renaming a file changes the hash; contents-only hash turns it red
- [x] Plugin with a symlink is refused; allowing links turns it red (must prove no outside-file read)

**Verification:**
- [x] Tests pass: `bun test src/core/plugins/__tests__/plugins.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/core/plugins/store.ts`
- `src/core/plugins/__tests__/plugins.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Runtime trust and verify gaps

**Description:** Plugin hooks vs project trust, tamper-before-session, and unsandboxed notice need tests.

**Acceptance criteria:**
- [x] Untrusted project hooks plus a plugin hook: plugin hook still runs; routing plugin hooks through project gate turns it red
- [x] Tampered installed plugin before session start is disabled at startup; skipping `verifyPlugins` turns it red
- [x] Where bubblewrap is absent, unsandboxed notice is asserted (or test documents why it cannot run here)

**Verification:**
- [x] Tests pass: `bun test src/core/plugins/__tests__/plugins.test.ts src/core/runtime/__tests__/plugins.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/plugins/runtime.ts`
- `src/core/runtime/index.ts`

**Estimated scope:** Medium: 3-5 files

## Task 3: CLI scope gap

**Description:** Project-scope install path is untested from the command line.

**Acceptance criteria:**
- [x] CLI test installs with `--scope project` and asserts lockfile location and contents
- [x] `--scope` always-user turns it red

**Verification:**
- [x] Tests pass: `bun test src/cli/__tests__/plugin.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/cli/plugin.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-3
- [x] Caught probes re-run: `..` check, semver engines, widened consent, verify disable, install-before-consent, `.git` strip, network/env/project sandbox, `--yes` handling


## Source verbatim from openspec/DEFERRED.md (lines 322-372)

### Stage 10 plugins (`36b6570`, `fdf6c9d`)

`src/core/plugins/manifest.ts`:

- **break**: drop the `..` check in `inside`.
  - **caught by**: `plugins.test.ts` "a manifest is checked...".
- **break**: skip `semver.satisfies` for `engines`.
  - **caught by**: the same test.
- **break** `widened`: ignore `filesystem`.
  - **caught by**: the same test.

`src/core/plugins/store.ts`:

- **break** `integrityOf`: hash contents without paths, so renaming a file keeps the hash.
  - **gap**: no test renames a file.
- **break**: allow symbolic links in `files`.
  - **gap**: no test installs a plugin with a link, which could point the hash at a file
    outside the plugin.
- **break**: skip consent when `before` exists, even when the permissions grow.
  - **caught by**: "a plugin from git...", which expects the widened request.
- **break** `verifyPlugins`: report but do not disable.
  - **caught by**: the same test, which expects `enabled: false`.
- **break**: install before consent (move the copy above `consent`).
  - **caught by**: "install shows every contribution...", which checks nothing is
    installed after a refusal.
- **break** `fetchSource`: keep `.git` in the copy.
  - **caught by**: the git test.

`src/core/plugins/runtime.ts` and the runtime wiring:

- **break**: `network: true` for every plugin.
  - **caught by**: the hostile test ("network blocked").
- **break**: `envFor([])` instead of the declared names.
  - **caught by**: the hostile test, which expects the declared token.
- **break**: `readOnlyProject: false` for every plugin.
  - **caught by**: the hostile test ("project blocked").
- **break**: plugin hooks subscribed through the project trust gate.
  - **gap**: the hostile test has no project hooks, so it would still pass; add a case
    with untrusted project hooks and a plugin hook that must run.
- **break**: skip `verifyPlugins` at session start.
  - **gap**: no runtime test tampers with an installed plugin before a session.
- **break**: the unsandboxed notice.
  - **gap**: the tests run where bubblewrap works.

`src/cli/plugin.ts`:

- **break**: `--yes` ignored, or consent assumed without a terminal.
  - **caught by**: the git test's last check.
- **break** `--scope`: always `user`.
  - **gap**: the command-line tests install for the user only.

