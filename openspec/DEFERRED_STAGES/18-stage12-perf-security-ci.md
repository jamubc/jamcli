## Task 1: 12.1 Performance budgets

**Description:** Medians on the build machine miss headless, first frame, and memory budgets. Later stages add nothing measurable.

**Acceptance criteria:**
- [ ] Run `bun run bench -- --enforce` on a CI Linux runner
- [ ] If still over: profile first frame (OpenTUI native load) and headless startup, or bring revised budgets to the owner
- [ ] Record table: version 22.5 ms / 60, headless 168.2 / 150, first frame 381.1 / 250, keystroke 7.1 / 16, memory 151.9 / 150, with runner name

**Verification:**
- [ ] Tests pass: `bun run bench -- --enforce` on CI
- [ ] Manual check: numbers pasted with runner specs

**Dependencies:** `15-blocked-access-hardware.md` Task 1 (needs CI)

**Files likely touched:**
- `scripts/bench/`
- `src/tui/start.tsx`
- `src/cli.ts`

**Estimated scope:** Medium: 3-5 files

## Task 2: 12.2 Security findings, highest first

**Description:** Review done, five findings open. Fix or record each.

**Acceptance criteria:**
- [ ] 1. Project MCP trust gate: gate `.jamcli/mcp.json` on digest like project hooks, ask on first start
- [ ] 2. Workflow agent `mode: auto` cap: cap step mode at session mode or require trusted workflow file
- [ ] 3. Git hook digest: record workflow digest at `hook install`, refuse on change
- [ ] 4. Observer socket dir: refuse world-writable dir or bind inside 0700 state dir
- [ ] 5. Per-host net: see `17-unfinished-stages.md` Task 3
- [ ] Note: review was diff-only, not line-by-line; Part 1 probes guard paths until they run

**Verification:**
- [ ] Tests pass: `bun test src/services/__tests__/McpManager.test.ts src/core/workflows/__tests__/ src/tui/__tests__/observer.test.ts`
- [ ] Manual check: hostile cases for 1-4 fail before fix, pass after

**Dependencies:** Tasks in 14 and 17 for shared sandbox and trust code

**Files likely touched:**
- `src/services/McpManager.ts`
- `src/core/workflows/runners.ts`
- `src/core/workflows/triggers.ts`
- `src/tui/observer.ts`
- `src/core/hooks/trust.ts`

**Estimated scope:** Large: 5-8 files (split one finding per task if needed)

## Task 3: 12.3 CI staged, never run

**Description:** `ci.yml` and `release.yml` staged but unpushed. Security job misses D22 items.

**Acceptance criteria:**
- [ ] Copy staged workflows into `.github/workflows/`, fix first-run findings
- [ ] Run gates on Linux, macOS, Windows
- [ ] Add secret scanning, dependency review, `bun audit` per D22

**Verification:**
- [ ] Manual check: green CI run linked, with OS matrix

**Dependencies:** `15-blocked-access-hardware.md` Task 1

**Files likely touched:**
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-3
- [x] Perf numbers or revised budgets accepted
  - Recorded 2026-09-25 on macOS 27.0 arm64: `bun run bench -- --enforce` exits 0 with --version 12.7 ms (60), headless 54 ms (150), grep 371.9 ms (500); first frame, keystroke, and memory are measured on Linux only. The budgets stay as they are; the CI Linux run of the performance job awaits the owner's push.
- [x] Security findings fixed or recorded with owner sign-off
  - Fixed: finding 4, the observer refuses a socket path whose directory is group- or world-writable (observer.test.ts, probe 18a caught). Fixed: finding 2, a workflow agent step's mode is capped at the session's (workflows.test.ts, probe 18b caught). Recorded with plans: finding 1, the project MCP trust gate (behavior change for existing projects; plan below), and finding 3, the git hook digest (plan below). Finding 5, per-host network, is recorded in `17-unfinished-stages.md`.
- [ ] CI green on three OSes or failures filed as tasks
  - The workflows are landed and the D22 `security-scan` job is added. The first run awaits the owner's push; its findings are not filed yet.

## Record (2026-09-25): security findings
- Finding 1, project MCP trust gate (open, highest): gate `.jamcli/mcp.json` on a digest like project hooks. Plan: reuse `HookTrust` with a digest of the mcp file, refuse untrusted project servers at startup with a notice, add `jamcli mcp trust`, and ask on first start in the interface. Recorded rather than landed because it changes behavior for every existing project: its project MCP servers would stop starting until trusted, which needs the owner's decision.
- Finding 3, git hook digest (open): `installGitHook` computes the workflow file's sha256 and writes `--expect-digest <d>` into the hook; the `workflow run` action refuses when the file's digest changed and says to reinstall the hook. Recorded with the plan because it changes the hook script's exact text and the existing triggers test must move with it.


## Source verbatim from openspec/DEFERRED.md (lines 600-647)

### Stage 12: where each task stands

None of 12.1 to 12.9 is checked in `tasks.md`. What was done, and what is left:

- **12.1 Performance budgets: not met here.** Medians on the build machine, after
  `e01cf10` made the ACP SDK, plugin checks, and the workflow engine load only when used:

  | Measure | Now | At `5282c51` (this session's start) | Budget |
  |---|---|---|---|
  | `--version` | 22.5 ms | | 60 ms |
  | Headless startup | 168.2 ms | 176 ms | 150 ms |
  | First frame | 381.1 ms | 388 ms | 250 ms |
  | Keystroke | 7.1 ms | | 16 ms |
  | Memory | 151.9 MB | 151.6 MB | 150 MB |

  The later stages add nothing measurable, so the overage is this machine or older
  work. To finish: run the staged `performance` job (`bun run bench -- --enforce`) on a
  CI Linux runner. If it is still over, profile the first frame (OpenTUI's native load)
  and headless startup, or bring the budgets to the owner.
- **12.2 Security review: done as a review, with findings open.**
  - Fixed: the ACP client no longer offers the editor file system to other agents
    (`7268f91`); a lockfile committed to a repository can no longer load a plugin, since
    consent lives in the state directory and the copy must be JamCLI's own (`8f78615`);
    language servers run in the sandbox with the session's environment (`74aa7b6`).
  - Open, highest first:
    1. **Project MCP servers have no trust gate** (predates this unit, high). A cloned
       repository's `.jamcli/mcp.json` starts its commands when JamCLI opens. Fix: gate
       them on the same digest as project hooks (`trusted-hooks.json`, `jamcli hooks
       trust`), and ask on first start in the interface.
    2. **A project workflow's agent step may set `mode: auto`**, so a repository raises
       the mode of its own steps. Fix: cap a step's mode at the session's, or require the
       workflow file to be trusted as hooks are.
    3. **An installed git hook runs whatever the workflow file says now.** Editing the
       workflow changes what the hook runs with no review. Fix: record the file's digest
       at `hook install` and refuse to run when it changed.
    4. **The observer socket** (`JAMCLI_ACP_ENDPOINT=unix:<path>`) may be placed in a
       shared directory, with a window between checking the path and binding it. Fix:
       refuse a path whose directory is writable by others, or always bind inside a 0700
       directory under the state directory.
    5. **Plugin network access is not per host** (stage 10 above).
  - The review read the diff; it was not a line-by-line audit. Many probes in Part 1
    guard security paths and are unproven until they run.
- **12.3 CI: staged, never run.** `openspec/changes/rehaul-jamcli/workflows/ci.yml` and
  `release.yml` could not be pushed (see 1.1).
  - To finish: copy them into `.github/workflows/` and fix what their first run finds.
    Windows and macOS have never run the gates.
  - Missing from the staged security job, against design D22: secret scanning,
    dependency review, and `bun audit`.
