# Work Sequence

The order changes land in, and what "landed" means. Individual changes live in
`openspec/changes/`; this file says which one is open, what precedes it, and what
follows.

No dates. Nothing here is scheduled. A unit is open until it is done, and the next one
does not start before that.

## Working rule

**One unit in flight. It lives on its branch until it is complete.**

While a unit is open it is not merged, not set aside to start something else, and not
split across branches. Stages and slices inside the unit are committed as checkpoints,
and every checkpoint must install, typecheck, test, and build, because a checkpoint is
where the unit can be abandoned safely and picked up again. A checkpoint is never a
merge candidate: the unit is finished only when its change is archived, and only then
does the next unit start.

This rule exists because the alternative is already on the record. JamCLI has one
branch, four commits all dated 2025-11-25, and roughly 620 lines of source changes
sitting uncommitted since 2026-09-21 with no record of what they were for. The work was
real; the trail was not.

A unit is done when all of these are true:

- [ ] The feature works end to end. No stubs and no code paths reachable only by a flag
      nobody sets. `devloop`'s harness slot still reads `// REPLACE THIS LINE`, and its
      `test-results/.last-run.json` reports `passed` with no spec files present. Stub
      markers and status files are both disqualifying.
- [ ] Every design decision it depends on is **decided**, not deferred. A chosen library
      is chosen, not "currently wired up".
- [ ] `npx tsc --noEmit` does not exceed the recorded baseline for the unit.
- [ ] `bun test` passes, and the tests can fail. A test that cannot fail is not evidence.
- [ ] `bun run build` succeeds.
- [ ] The TUI boots and its slash commands work, if the unit touched the core.
- [ ] `openspec validate --strict` passes for the unit's change.
- [ ] The unit's change has every task checked and is moved to `openspec/changes/archive/`,
      with its deltas applied into `openspec/specs/`.

Only then does it commit and merge, and only then does the next unit start.

**Code on a branch is not evidence of any of this.** The parked work in this repository
read as finished and was not committed. `claude-code-adapter` reports 87% coverage and
ships 6,400 lines of tests, which is what the claim looks like when it is real.

## Open unit

### 1. `add-agentic-harness-core`

The whole harness rebuild: one tool protocol, a headless core, a tool registry, generic
providers, category routing, delegation, a tool output trust gate, rules, hooks, policy,
sessions, and the MCP and ACP surfaces. Full scope in
`openspec/changes/add-agentic-harness-core/`.

This unit is deliberately large because its stages are not independent: the protocol
defect and the trapped loop are the reason nothing else here is possible, and splitting
them across units would mean shipping a protocol migration twice.

**Insertion rule for this unit.** The stages in `tasks.md` are ordered by dependency and
are not reorderable within stages 1 and 2. After stage 2, work may interleave freely,
with one exception: `task` delegation requires both headless mode and category routing,
so it cannot precede either.

**Partial completion is identifiable, not ambiguous.** If this unit stalls, the stopped
point is the last checked task, the uncompleted stages are listed above it, and the
branch holds a state that either boots or does not. Stage 1 alone removes the protocol
defect that causes most visible unreliability, so stopping after it is a real outcome
rather than a failure.

## Not in this unit

Anything below takes its position from one question: does it make the harness more
trustworthy, or does it add surface? Only the first kind is listed as a candidate at
all. None of these have a change proposal, and none should start before unit 1 closes.

### Candidates, in no order

- **Single-binary distribution.** `bun build --compile` per platform. Deferred because
  a working build is the prerequisite, and because the project is personal and not
  published.
- **Committing on the user's behalf.** `git_status` and `git_diff` are read-only in unit
  1 by design. A write path would need its own approval design.
- **A plugin or extension API.** Deferred until the registry and hook bus have been used
  long enough to know what a stable extension point even is.
- **Remote or hosted sessions.** Contradicts local-first.

### Rejected, with reasons

These are recorded so they are not proposed again without new evidence.

- **Memory, consolidation, or a self-improving loop.** Attempted and decommissioned in
  `hermes-plasticity-plugin`: 26 cycles, roughly 138,000 tokens, zero committed
  memories. Its own post-mortem describes it as an LLM writing book reports about what
  another LLM had already done. Revisit only with a hard novelty gate that can be
  demonstrated on real transcripts before any code is written.
- **Team mode, parallel member orchestration, tmux visualization.** The complexity cost
  is real and the benefit is unproven for a single user.
- **A hosted service or remote session store.** Contradicts local-first.
- **Building a plugin for another harness as the primary surface.** JamCLI is the host,
  not a guest. Where another tool has something worth having, delegate over ACP instead.

## Cross-cutting rules that apply to every unit

- **No AI attribution.** Commits and documents are authored under the owner's identity.
  No `Co-Authored-By` trailers, no "generated with" lines.
- **No em dashes in authored text.** Commits, specs, docs, and release notes.
- **Conventional commits**, lowercase and imperative, with a scope when it helps.
- **One concern per commit.** A dependency bump is its own commit. A refactor and a
  behavior change do not share one.
- **Secrets never enter the repository.** `.jamcli/` is gitignored, and provider keys
  are read from the environment through `key_env_var` wherever the provider allows it.
- **The local-first path stays working.** A change that breaks Ollama with no network is
  not done, regardless of what else it does.
