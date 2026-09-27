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

`add-surface-parity`, on `feat/surface-parity`. The owner opened it on 2026-09-27 while
`add-session-reflection` waits at its task 6.2, an exception to the working rule made by
the owner and recorded here. The reason: 6.2 asks for `/reflect` on 10 or more real
sessions, `/reflect` exists only in the interface, and nothing lets anyone but the person
at the terminal use JamCLI. Every "run jamcli and try this" handed back to the owner came
from the same gap. `add-surface-parity` moves the built-in commands out of the interface so
every surface runs one set. `add-mcp-server`, next in `ROADMAP.md`, lets other agents
delegate to JamCLI and use its interface through the same program a person runs, and its
acceptance is 6.2 run that way, the owner approving each lesson. Both are stacked on
`feat/agentic-harness-core`, which is not yet merged to `master`.

`add-session-reflection` stays open. Its code is committed and its task 6.1 ran end to end
on OpenCode Go. What remains is 6.2: `/reflect` on at least 10 of the owner's real
sessions, the approved novel edits counted against the 0 of 26 baseline, which only the
owner's approvals can produce. `add-agents`, `reconcile-shipped-behavior`, and
`fix-observed-session-defects` closed 2026-09-27; see Closed units below.
`add-windows-support` is shelved, not in the active changes tree: it waits for the owner to
approve it before any task begins, and `git checkout 9d9f5c6 --
openspec/changes/add-windows-support` restores its proposal from the commit that recorded
it.

## Closed units

### 6. `fix-observed-session-defects`

Archived as `2026-09-27-fix-observed-session-defects`: 1 requirement added (Delegated
Approvals), 3 modified (Terminal User Interface, Tool Output Trust Gate, Observability).
It came from reading the logs of the owner's latest session in `monaco-code-editor`
(`2026-09-27-5c20fef9`), in auto mode on OpenCode Go, rather than from a plan. Every fix
has a test that fails on the code before it: `fba0ded` to `7439f21`.

**What the session showed.** Twice a subagent's command needed a person, and its prompt
could not be answered; the owner stopped both turns, after 4 and 12 minutes. A child's
answered prompt was never announced, so the first stayed on screen and each later one
queued behind it (fixed in `fba0ded`). The prompt also cut each line of a command to
one row, so the command being allowed could not be read. The trust gate withheld the
model's own todo list as irrelevant and withheld results for being duplicates, and
`trust.dedupe` was read by nothing. The TypeScript language server died three seconds
in under Seatbelt: it watched JamCLI's process, which the sandbox hides, and took it for
gone. The global log recorded none of it beyond a bare "tool call" warning, so it now
names why a call failed, how long each prompt waited, and any prompt left unanswered.

**Left alone, on purpose.** Command substitution, `$(...)`, still asks in auto mode:
the engine cannot see what it runs, so no rule can be checked against it. That is why
the child's commands asked at all, and it is the design, not a defect.

### 5. `reconcile-shipped-behavior`

Archived as `2026-09-27-reconcile-shipped-behavior`: 8 requirements modified, none added
or removed. After `add-agents` closed, owner-directed work landed on this branch without
a change of its own, and the spec stopped describing it: the interface's thinking window
of fixed size, its expanded view, a permission prompt that leaves the transcript in view,
`/note`, and selection and clicking; `/model` saving its choice to the user
configuration; a denial that lets the turn go on; indicator styles that follow the theme;
a trust gate that screens only in auto mode, on the classifier `trust.model` names,
TypeSafe's Jev included; models.dev in the catalog; and keys kept out of project files.
The unit records that behavior and adds no code. It closed while `add-session-reflection`
stays open, as `add-agents` did, since that unit's last task waits on the owner.

**What closing it found.** Seven sessions had worked the one checkout at once and left 66
files uncommitted, several concerns interleaved in single files, and tests that matched a
wording no session wrote: the owner's own edit of the denial message, which ended in two
full stops. The work went in as 17 commits by concern (`d510087` to `eedfc70`), each
state passing the four gates on its own. One defect surfaced: the prompt measured a diff
by its raw lines rather than the rows the diff view draws, so a short diff was padded out
with blank rows and said it continued (fixed in `da128fc`). The same pass met the one ACP
scenario the spec stated and jamcli did not: an editor that lends its files and
terminals now gets the session's reads, writes, and commands (`e73563e`), the command
under `env -i` so the editor's environment never reaches it. Its live check in a real
editor waits on the owner (`openspec/DEFERRED_STAGES/17-unfinished-stages.md`).

### 4. `add-agents`

Archived as `2026-09-27-add-agents`: 3 requirements added (Agent Definitions, Delegation
Choice Presentation, Delegation Settings), 2 modified (Category-Based Model Routing,
Delegated Task Execution). An agent is `agents/<name>.md` in the project, the user
directory, or a plugin: a description the model reads, a model chain, and a rules body
only its child reads, before the project's rules. The `task` tool lists each routable
agent with its description and the chain it runs on, names the default
(`delegation.default_agent`), and says when and how to delegate; `reasoning` on a call
reaches the child, which it had not. The built-ins `quick`, `intelligent`, `explore`, and
`writing` have no chain and run on the session's model, whatever provider serves it.
`/agents` replaced `/categories`. Configured `categories` still load, as agents without
descriptions or rules.

**What closing it found.** Session `2026-09-26-de8c4d4a` in `monaco-code-editor` started
it: three background delegations each failed raw on a local Ollama that was not running.
`resolveRoute` had a reachability check nothing passed (fixed for delegation in `9272739`
and workflows in `0f86978`). Building on it found a `delegation` block that set only some
keys left the rest unbounded (`7c03fa9`). Testing on a real endpoint, OpenCode Go, found
jamcli sent no user agent of its own and no per-conversation id, both of which that
provider requires (`141abac`, `30d76de`); `${session_id}` in an endpoint header now
carries the session's id.

**Owner decisions recorded with it**: the model chooses among configured agents, never a
raw `provider:model`; built-in names `quick`, `intelligent`, `explore`, `writing`; a
project's `AGENTS.md` wins over an agent's rules; the built-ins run on the session's
model, since Ollama is one provider among many, not one a person must have; tests on a
real provider use OpenCode Go, not Ollama. Work stayed on `feat/agentic-harness-core`, as
for the last unit.

### 3. `improve-web-tools`

Archived as `2026-09-26-improve-web-tools`: 2 requirements added, 1 modified, 0 removed.
Modern web research for JamCLI: `web_fetch` gained link-preserving extraction, a
main-content preference, an in-process 15 minute response cache, and a real user agent;
`web_search` was added over a configured LangSearch provider, offered only when a key
resolves, gated by the provider's host through the existing `domain:` rule matcher; both
tools pass through an identity refinement stage that names the TypeSafe System One gate
(`jev-latest`) as its intended later occupant. Built in `src/core/tools/web/`, one new
directory of four files, plus ten mechanical edits and two deletions named in `design.md`.

**Owner decisions recorded with it**: no worktree and no new branch, work stayed on
`feat/agentic-harness-core`, knowingly setting aside the per-unit branch rule for this
unit; the refine stage ships empty rather than wired to a summarizer, so no extra process
call is paid until `jev` lands; extending `jamcli auth` to manage search-provider keys
was kept out of scope.

**What closing it found.** `providers.ts`'s two relative imports in the plan's own draft
were one directory level short (`../providers/factory.js` and `../../types/config.js`),
caught by `tsc` rather than by inspection. `providers.test.ts` scrubbed the developer's
real `LANGSEARCH_API_KEY` only in `afterEach`, so a filtered or reordered run picked up
the actual production key from the shell instead of failing closed; fixed with a matching
`beforeEach`. `design.md` asserted a four-tier key precedence ending in the OS credential
store, but the call site never passed an account name, so that tier was dead code for
every search provider; fixed by passing the provider's name as the account.

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
  Reopened 2026-09-26 by the owner as `add-session-reflection`, under the gates that
  proposal names: on demand only, evidence cited from the log, known lessons dropped,
  delta edits the user approves. Its close must report approved novel edits against this
  0 of 26. A learned preference profile stays rejected. Cross-session insights are a
  candidate for after it closes.
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
