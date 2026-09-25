# Implementation Plan: DEFERRED probes and unfinished work

## Overview
`openspec/DEFERRED.md` holds two lists from `rehaul-jamcli`: deferred mutation probes (tests not yet shown able to fail) and unfinished work (tasks 12.1 to 12.9 plus blocked, held, and found-late items). This folder splits that file into ordered, implementable modules. No code changes happen here. Each module is a task list for a future build session.

Source of truth: `openspec/DEFERRED.md` until deletion. After `22-source-provenance.md` lands, that file plus modules 00 through 21 carry the full content and DEFERRED becomes deletable. If a module and DEFERRED disagree before deletion, DEFERRED wins.

Stage 21 (`21-break-on-purpose.md`) is a reminder only. Break-on-purpose testing cannot be fully defined before the code exists, so it runs after each implementation checkpoint and again at archive.

## Architecture Decisions
- One module per DEFERRED heading, so traceability is 1:1. File names use `probes-` for Part 1 and topic names for Part 2.
- Probe modules follow DEFERRED's rule: write the missing test first (gap), then run `bun scripts/probe.ts probes.json`. A survivor gets a new test or a written equivalent-mutant reason.
- Feature modules follow the four gates: `bun install`, `npx tsc --noEmit` (baseline 0), `bun test`, `bun run build`.
- Owner questions go out first and never block probes. Probes assert current behavior; a later ruling adds a follow-up test.
- Blocked-on-hardware items run in parallel and never block code and docs. A module closes with code plus recorded limits; the hardware run is tracked in 15.
- Security-sensitive probes and fixes run before docs and release. Archive is last, then Stage 21 confirms the probe outputs.

## Dependency Graph
```
Phase 0 (ask early, non-blocking): 16 owner decisions
  |
Phase 1 foundations: 01 references, 02 shell, 03 tool search (independent)
  |
Phase 2 protocols: 04 ACP, 05 observer, 06 LSP, 11 LSP sandbox (needs 06),
                   12 web_fetch, 13 lazy loading (all independent of each other)
  |
Phase 3 plugins and workflows: 07 plugins, 10 consent, 08 workflows,
                               09 micro (independent, not blocked on 16),
                               14 crosscutting repeat (needs 07, 08)
  |
Phase 4 finish: 17 features (needs 04, 06, 11, 07, 08 only),
                18 perf/security/CI (prefers CI from 15, accepts local),
                19 docs/release/archive (needs 16 rulings when available, else documents current state),
                15 hardware and 20 found-late run in parallel,
                22 provenance (informational, lands with 19 so deletion is safe)
  |
Phase 5 final: 21 break-on-purpose reminder (runs after code, defines nothing new)
```

## Sanity Check: No Reverse Dependencies
Audited 2026-09-25 against `**Dependencies:**` in every module. Rule: a module may depend only on earlier phases, same-phase siblings completed first, or parallel tracks that do not block closing.

- 09 no longer depends on 16. Fixed: 09 asserts current `auto` fallback; 16 ruling becomes a follow-up.
- 17 no longer depends on 15. Fixed: hardware runs stay in 15; 17 closes on code and docs.
- 17 proxy scope decided inside 17. Fixed: default is record-as-limit.
- 16 sits in Phase 0. Asks go out first; every consumer (09, 17, 18, 19) proceeds on current behavior if unanswered.
- 18 prefers CI but accepts a local bench with runner name, so 15 being blocked does not freeze 18 docs.
- 19 archive depends on all above only in the sense of order; docs tasks record current state when a ruling is pending rather than waiting.
- Result: no case of needing a later stage to finish an earlier one. The only forward pointer is 21, which is intentional and non-blocking.

## Task List

### Phase 0: Ask early (non-blocking)
- [ ] 16 `16-owner-decisions.md`: D14 `#`, 12.8 micro setting, 12.6 version. Send questions now; probes proceed regardless.

### Checkpoint: Asked
- [ ] Questions sent to owner, answers recorded when they arrive
- [ ] No probe module waits on an answer

### Phase 1: Probe foundations
- [ ] 01 `01-probes-mcp-prompts-resources.md`
- [ ] 02 `02-probes-composer-shell.md`
- [ ] 03 `03-probes-tool-search.md`

### Checkpoint: Foundations
- [ ] `bun test` passes for `mcp`, `turns`, `composer`, `toolSearch` suites
- [ ] New gap tests fail without the fix and pass with it
- [ ] Probe JSON for each module runs via `scripts/probe.ts`

### Phase 2: Protocol and system probes
- [ ] 04 `04-probes-acp-sdk.md`
- [ ] 05 `05-probes-acp-observer.md`
- [ ] 06 `06-probes-lsp.md`
- [ ] 11 `11-probes-lsp-sandbox.md` (after 06, shares fake)
- [ ] 12 `12-probes-web-fetch.md`
- [ ] 13 `13-probes-lazy-loading.md`

### Checkpoint: Protocols
- [ ] ACP, observer, LSP, web_fetch suites green
- [ ] No new test touches network or hardware

### Phase 3: Plugin and workflow probes
- [ ] 07 `07-probes-plugins.md`
- [ ] 10 `10-probes-plugin-consent.md`
- [ ] 08 `08-probes-workflows.md`
- [ ] 09 `09-probes-micro-mode.md` (independent of 16)
- [ ] 14 `14-probes-repeat-crosscutting.md` (after 07, 08)

### Checkpoint: Plugins and workflows
- [ ] Hostile plugin, workflow engine, micro suites green
- [ ] Crosscutting repeat probes defined for new callers

### Phase 4: Finish the work
- [ ] 17 `17-unfinished-stages.md` (needs 04, 06, 11, 07, 08 only)
- [ ] 15 `15-blocked-access-hardware.md` (parallel, records outputs elsewhere)
- [ ] 20 `20-found-late-fixes.md` (parallel; Task 4 after 12)
- [ ] 18 `18-stage12-perf-security-ci.md` (after 17; CI preferred, local accepted)
- [ ] 19 `19-stage12-docs-release-archive.md` (last; archive step ends the unit)
- [ ] 22 `22-source-provenance.md` (informational; lands with 19, makes DEFERRED deletable)

### Checkpoint: Complete
- [ ] All acceptance criteria met per module
- [ ] `openspec validate --all --strict` passes at archive
- [ ] Ready for owner review

### Phase 5: Final reminder
- [ ] 21 `21-break-on-purpose.md`: run probes after each checkpoint and confirm survivors have tests or written reasons. Defines nothing new.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Probe list drifts from code | Medium | Each module cites file and construct from DEFERRED; verify path before writing test |
| Gap tests need fixtures | Medium | Build fixtures in `src/testing/` first, reuse across modules |
| Perf and hardware items cannot pass here | High | 15 runs elsewhere; 18 accepts local bench with runner name |
| Owner answers arrive late | Medium | Phase 0 asks early; modules assert current behavior and add follow-ups later |

## Open Questions
- Confirm folder spelling: user asked `DEFERRED_STAGES` (double F). Keep as asked or rename to `DEFERRED_STAGES`?
- Confirm version 2.0.0 before release module runs.
- Confirm `ui.micro` vs `JAMCLI_MICRO` before micro docs finalize (probe itself is unblocked).
- Confirm `#` note to AGENTS.md: approve or strike from D14.

## Parallelization
- Safe to parallelize: 01, 02, 03 independently; 04, 06, 12, 13 independently; 07 and 08 independently; 15, 20, 22 alongside 17 and 18.
- Must be sequential: 11 after 06; 14 after 07 and 08; 17 after 04, 06, 11, 07, 08; 18 after 17; 19 last with 22; 21 after everything with code.
- Needs coordination: 17 plugin net and 18 security finding 5 share the sandbox; 17 decides proxy scope once and 18 follows it.
