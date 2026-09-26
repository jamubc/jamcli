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

This rule exists because the alternative is already on the record. JamCLI had one
branch, four commits all dated 2025-11-25, and roughly 620 lines of source changes
sitting uncommitted since 2026-09-21 with no record of what they were for. The work was
real; the trail was not.

A unit is done when all of these are true:

- [ ] The feature works end to end **on every surface a user reaches it through**: the
      interface, headless, and ACP. No stubs and no code paths reachable only by a flag
      nobody sets. Stub markers and status files are both disqualifying.
- [ ] Every design decision it depends on is **decided**, not deferred. A chosen library
      is chosen, not "currently wired up".
- [ ] `npx tsc --noEmit` does not exceed the recorded baseline for the unit.
- [ ] `bun test` passes, and the tests can fail. A test that cannot fail is not evidence.
      At least one test per surface drives the assembled product, not only its modules.
- [ ] `bun run build` succeeds.
- [ ] The interface boots and its slash commands work, if the unit touched the core,
      exercised through the interface itself and not only through the headless path.
- [ ] `openspec validate --strict` passes for the unit's change.
- [ ] The unit's change has every task checked and is moved to `openspec/changes/archive/`,
      with its deltas applied into `openspec/specs/`.

Only then does it commit and merge, and only then does the next unit start.

**Code on a branch is not evidence of any of this.** The parked work in this repository
read as finished and was not committed. `claude-code-adapter` reports 87% coverage and
ships 6,400 lines of tests, which is what the claim looks like when it is real.

**Neither is a checked box.** `add-agentic-harness-core` closed with every item above
checked, and its own surfaces then failed on the default path: the interface offered no
tools with Ollama, headless and ACP offered three read tools with empty schemas, and
`write_file` could not write a file. Its tests exercised modules and never a surface. The
per-surface clauses above were added for that reason. The record is in
`openspec/changes/rehaul-jamcli/audit.md`.

## Open unit

None. `rehaul-jamcli` closed 2026-09-26; see Closed units below. `add-windows-support`
is proposed (`openspec/changes/add-windows-support/`) but not started: per the working
rule, it waits for the owner to approve the proposal before any task begins.

## Closed units

### 2. `rehaul-jamcli`

Archived as `2026-09-26-rehaul-jamcli`: 35 added, 30 modified, 0 removed. The rehaul of
JamCLI into a modern coding CLI, as directed by the owner on 2026-09-23. It built one
runtime for every surface with a streaming turn engine and a transcript event log;
permission modes with a sandbox; a model catalog with cost tracking and model-aware
context management; layered configuration, credentials, and observability; the
interface on OpenTUI; git workflows; commands, skills, and hooks; MCP, ACP, and LSP
adapters; and plugins, workflows, and release binaries.

**Owner decisions recorded with it** (2026-09-23): one unit rather than several, with
twelve stages; `replace-ink-with-opentui` folded into stage 6; a plugin system, a git
write path, a workflow engine, and release binaries authorized, previously deferred;
each stage proceeds without a separate proposal review. On 2026-09-25: `12.8` (micro
status mode) folded in, with `JAMCLI_MICRO` as its override instead of a `ui.micro`
config key; the type baseline reached 0 when Ink was removed (6.15) and stayed there.

**What closing it found.** The unit's own first real CI run (2026-09-26, the branch had
never been pushed before) failed on nearly the whole suite on Windows: no sandbox
equivalent to bubblewrap or Seatbelt, no credential-store equivalent to Keychain or
Secret Service, and POSIX process groups assumed for command cancellation. Windows was
dropped from the CI gate and the 2.0.0 release rather than shipped unsandboxed;
`add-windows-support` tracks building it properly. Two real defects surfaced and were
fixed in the same pass: Ubuntu's GitHub-hosted runner blocks the unprivileged user
namespace bubblewrap needs, which silently disabled the sandbox in CI until worked
around, and workflow/`/commit` tests relied on an ambient git identity a fresh runner
does not have. A macOS Seatbelt sandbox escape (a hostile plugin can still write outside
its declared paths) is accepted, documented, load-bearing test evidence, not fixed here;
see `openspec/changes/archive/2026-09-26-rehaul-jamcli/audit.md` and the unit's `tasks.md`
for what `openspec/DEFERRED_STAGES/` still records as open beyond that.

### 1. `add-agentic-harness-core`

Archived as `2026-09-23-add-agentic-harness-core`: 16 added, 8 modified, 1 removed. It
built the core, the registry, generic providers, the Anthropic seam, category routing,
headless invocation, delegation, the trust gate, rules, hooks, policy, audit, and the MCP
and ACP surfaces.

The audit that opened `rehaul-jamcli` found its surfaces assembled inconsistently:

- 6 of its 36 requirements do not hold for a normal user;
- 18 hold only on some surfaces or paths;
- `master` shares no commit with its branch, so it has not been merged.

The measurements are in `openspec/changes/rehaul-jamcli/audit.md`.

## Not in this unit

Anything below takes its position from one question: does it make the harness more
trustworthy, or does it add surface?

### Candidates, in no order

- **A VS Code extension.** ACP already reaches Zed, JetBrains, Neovim, and Emacs.
- **A vim editing mode in the composer.** Waits until the OpenTUI composer is stable.
- **Image input.** Needs a local vision path to keep the local-first promise.
- **An OpenAI Responses API adapter,** if stage 4's optional task does not land.

### Rejected, with reasons

These are recorded so they are not proposed again without new evidence.

- **Memory, consolidation, or a self-improving loop.** Attempted and decommissioned in
  `hermes-plasticity-plugin`: 26 cycles, roughly 138,000 tokens, zero committed
  memories. Its own post-mortem describes it as an LLM writing book reports about what
  another LLM had already done. Revisit only with a hard novelty gate that can be
  demonstrated on real transcripts before any code is written. This also rules out a
  learned preference profile of the kind Command Code calls "taste".
- **Team mode, member visualization, or unbounded parallel agents.** The complexity cost
  is real and the benefit is unproven for a single user. Workflows may run a small,
  capped number of steps in parallel; that is the whole of it.
- **A hosted service, remote sessions, or a background daemon.** Contradicts
  local-first. Scheduled workflows use the operating system's scheduler instead.
- **Building a plugin for another harness as the primary surface.** JamCLI is the host,
  not a guest. Where another tool has something worth having, delegate over ACP instead.
- **Loading third-party code into the JamCLI process.** Plugins run as sandboxed
  subprocesses only, for the reason `vm2` was removed.
- **An npm release.** The project stays unpublished on npm; release binaries go to
  GitHub Releases.

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
