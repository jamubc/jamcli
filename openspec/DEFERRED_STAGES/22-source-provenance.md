# Stage 22: Source provenance (lossless preservation)

Purpose: preserve every provenance and operating detail from `openspec/DEFERRED.md`
so that file can be deleted with no information lost. Work-item plans live in
00 through 21. This file holds the hashes, tables, and rules that those modules
summarize but do not repeat.

## 1. Probe operating rules (from DEFERRED Why and How to run a probe)

- Rule until task 9.2: each new test is shown able to fail with a mutation probe
  before it counts as evidence. Source: `openspec/changes/rehaul-jamcli/tasks.md`.
  Every task through 9.2 elicitation was probed. Results in `tasks.md`. Each
  survivor got a test.
- Rule change on 2026-09-25 by owner: finish features first, write down every
  probe that would have run. Work from then on is tested, but tests are not shown
  able to fail. Until probes run, treat those tests as unproven.
- Runner: `scripts/probe.ts` takes a JSON list of probes. Example shape:
  name, file, old, new, tests. Example entry probes denied shell reading as ok
  in `src/core/agent.ts` by replacing a refused branch condition, tested by
  `src/core/runtime/__tests__/turns.test.ts`.
- Command: `bun scripts/probe.ts probes.json`.
- Semantics: replace first `old` with `new`, run named test files, restore file.
  Caught means tests fail or hang. Hang killed after `timeout` seconds, default
  180. Survived means tests still pass. Survivor needs a new test or a written
  reason why the change makes no difference (equivalent mutant; `tasks.md` 5.4
  records one such case).
- Keep each probe small: flip one condition, drop one call, or return early.
  Name the test the probe should turn red. Entries marked gap are expected to
  survive today and show where a test is missing, not only where one needs
  proving.
- Entry schema for Part 1: where (file and construct), break (what to change),
  caught by (test that should fail). Gap means write the test first, then run
  the probe.

## 2. Commit hash map (DEFERRED heading to module)

| Commit | DEFERRED heading | Module |
|--------|------------------|--------|
| `46c4fcb` | 9.2 MCP prompts, resources, and `@` completion | `01-probes-mcp-prompts-resources.md` |
| `9087d23` | Composer `!` shell | `02-probes-composer-shell.md` |
| (no hash) | 9.2 tool search | `03-probes-tool-search.md` |
| `a0f1bff`, `7268f91` | 9.3 ACP on the SDK | `04-probes-acp-sdk.md` |
| `8c1bade` | 9.3a ACP observer | `05-probes-acp-observer.md` |
| `7612e2b` | 9.4 LSP | `06-probes-lsp.md` |
| `36b6570`, `fdf6c9d` | Stage 10 plugins | `07-probes-plugins.md` |
| `9eb27d2`, `cec4b48`, `b79f4a4` | Stage 11 workflows | `08-probes-workflows.md` |
| `a158925` | 12.8 Micro status mode | `09-probes-micro-mode.md`, also `16-owner-decisions.md` Task 2 and `19-stage12-docs-release-archive.md` |
| `8f78615` | Plugin consent outside the project | `10-probes-plugin-consent.md`, also 12.2 fixed list below |
| `74aa7b6` | Language servers in the sandbox | `11-probes-lsp-sandbox.md`, also 9.4 note and 12.2 fixed list |
| `bc62c1a` | `web_fetch` | `12-probes-web-fetch.md`, also `/tools` wait and late task note in `20-found-late-fixes.md` |
| `e01cf10`, `9bc0c2a` | Lazy loading and the compiled binary | `13-probes-lazy-loading.md`, also 12.1 note |
| (no hash) | Probes to repeat once later stages land | `14-probes-repeat-crosscutting.md` |
| `5282c51` | 12.1 session start baseline | `18-stage12-perf-security-ci.md` Task 1 and table below |
| `7268f91` | 12.2 fixed: ACP client FS offer removed | `18-stage12-perf-security-ci.md` Task 2 |
| `2dcefaf` | Staged release job (SBOM, provenance, draft) | `19-stage12-docs-release-archive.md` Task 3 |
| `8fa95e3` | Version 2.0.0 (config and history formats changed) | `16-owner-decisions.md` Task 3 and `19-stage12-docs-release-archive.md` |

Notes preserved from DEFERRED:
- 9.4 parenthetical: servers now run in the session sandbox (`74aa7b6`).
- 12.8 built (`a158925`), tests pass.
- `/tools` wait change landed in (`bc62c1a`).
- `web_fetch` went unbuilt until (`bc62c1a`).

## 3. 12.1 full performance table

After `e01cf10` made the ACP SDK, plugin checks, and workflow engine load only
when used. Medians on the build machine.

| Measure | Now | At `5282c51` (session start) | Budget |
|---------|-----|------------------------------|--------|
| `--version` | 22.5 ms | (not recorded) | 60 ms |
| Headless startup | 168.2 ms | 176 ms | 150 ms |
| First frame | 381.1 ms | 388 ms | 250 ms |
| Keystroke | 7.1 ms | (not recorded) | 16 ms |
| Memory | 151.9 MB | 151.6 MB | 150 MB |

Preserved note: later stages add nothing measurable, so the overage is this
machine or older work. To finish: run the staged `performance` job
(`bun run bench -- --enforce`) on a CI Linux runner. If still over, profile
the first frame (OpenTUI native load) and headless startup, or bring budgets
to the owner.

## 4. 12.2 fixed list (with hashes)

Review done as a review, findings open. Fixed:

- ACP client no longer offers the editor file system to other agents
  (`7268f91`).
- Lockfile committed to a repository can no longer load a plugin, since consent
  lives in the state directory and the copy must be JamCLI own (`8f78615`).
- Language servers run in the sandbox with the session environment (`74aa7b6`).

Review scope note: the review read the diff; it was not a line-by-line audit.
Many probes in Part 1 guard security paths and are unproven until they run.

## 5. 12.6 release provenance

- `bun run compile` built all five targets here once. Checksums came from an
  earlier commit, so they are stale and are not recorded. Linux x64 binary
  passed its `--version` smoke test.
- Staged release job adds CycloneDX SBOM, build provenance, and a draft release
  (`2dcefaf`). None of it has run.
- Version now 2.0.0 (`8fa95e3`), because configuration and history formats
  changed. Owner decision: confirm the number. Pushing the tag is the owner
  action.

## 6. Deletion checklist

DEFERRED.md may be deleted when all of these are true:

- [ ] This file exists with sections 1 to 5 intact.
- [ ] `00-plan.md` lists this file in Phase 4.
- [ ] Grep for hashes finds them here: `46c4fcb`, `9087d23`, `a0f1bff`,
  `7268f91`, `8c1bade`, `7612e2b`, `36b6570`, `fdf6c9d`, `9eb27d2`,
  `cec4b48`, `b79f4a4`, `a158925`, `8f78615`, `74aa7b6`, `bc62c1a`,
  `e01cf10`, `9bc0c2a`, `5282c51`, `2dcefaf`, `8fa95e3`.
- [ ] Grep for `5282c51` full table finds section 3.
- [ ] No module depends on DEFERRED.md at runtime; `21-break-on-purpose.md`
  references its How to run a probe only as history, with the full rules copied
  here.

## Dependencies
None. Informational only. Update alongside any module that changes a hash,
a budget number, or a fixed finding.

## Files likely touched
- `openspec/DEFERRED.md` (source, deletable after this lands)
- `openspec/DEFERRED_STAGES/00-plan.md` (index)


## Source verbatim from openspec/DEFERRED.md (lines 1-59: title, Why, How to run, Part 1 intro)

# Deferred Probes and Unfinished Work

This file keeps two lists so they are not lost:

1. **Deferred mutation probes.** Every place where the code would have been broken on
   purpose to prove a test notices, and was not.
2. **Unfinished work.** Every task, check, or decision the `rehaul-jamcli` unit did not
   finish, with what is needed to finish it.

## Why this exists

Until task 9.2, the unit's rule was: "Each new test is shown able to fail with a mutation
probe before it counts as evidence" (`openspec/changes/rehaul-jamcli/tasks.md`). Every
task through 9.2's elicitation work was probed that way. The results are recorded in
`tasks.md`, and each probe that survived got a test.

On 2026-09-25 the owner changed the rule: finish the features first, and write down every
probe that would have run. From that point the work is still tested, but the tests have not
been shown able to fail. Until the probes below run, treat those tests as unproven.

## How to run a probe

`scripts/probe.ts` takes a JSON list of probes:

```json
[{ "name": "denied shell reads as ok",
   "file": "src/core/agent.ts",
   "old": "return status === 'denied' ? finish('refused'",
   "new": "return false ? finish('refused'",
   "tests": ["src/core/runtime/__tests__/turns.test.ts"] }]
```

```bash
bun scripts/probe.ts probes.json
```

For each probe, the script replaces the first `old` with `new`, runs the named test files,
and restores the file. A probe is **caught** when the tests fail or hang, and a hang is
killed after `timeout` seconds (default 180). A probe **survived** when the tests still
pass. A survivor needs a new test, or a written reason why the change makes no difference
(an equivalent mutant: `tasks.md` 5.4 records one).

Keep each probe small: flip one condition, drop one call, or return early. Name the test
the probe should turn red. Every entry below marks the probes expected to survive today:
they show where a test is missing, not only where one needs proving.

---

## Part 1: deferred mutation probes

Each entry gives:

- **where**: the file and the construct;
- **break**: what to change;
- **caught by**: the test that should fail.

Entries marked **gap** are expected to survive with today's tests. Write the test first,
then run the probe.



## Source verbatim from openspec/DEFERRED.md (lines 531-535: Part 2 intro)

## Part 2: unfinished work

Each item names the task in `openspec/changes/rehaul-jamcli/tasks.md` (or the archived
copy once the unit closes), what is missing, and what finishing it needs.

