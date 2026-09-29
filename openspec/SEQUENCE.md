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
      The full suite stays under its time budget, and each new test reaches behavior no
      existing test does, per the Testing Strategy in `project.md`.
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

`scale-the-log`, R9 of the review units at the top of `ROADMAP.md`, opened 2026-09-29 on
`master`, where the owner has worked since merging the stack on 2026-09-27. The session log
read without parsing it whole on every call, the session index appended to rather than
rewritten, and version fields where a newer JamCLI's file could be misread by an older one.
The review it comes from is kept verbatim in
`openspec/reviews/2026-09-29-architecture-review.md`.

`add-windows-support` is shelved, not in the active changes tree: it waits for the owner to
approve it before any task begins, and `git checkout 9d9f5c6 --
openspec/changes/add-windows-support` restores its proposal from the commit that recorded
it. The review would not build it.

## Closed units

### 22. `add-audit-ledger`

Archived as `2026-09-29-add-audit-ledger`: 1 requirement added (Decision Ledger). R8 of the
review units. The engine's verdict already named the rule's source; the dispatcher dropped it
before the approval event, so the log said which rule decided and not which file and key held
it. It is now recorded with every decision (`d6ba4b7`).

`jamcli audit ledger` lists, across the project's sessions, every decision the logs record:
each allowed call of a tool that can change something, each refusal, and each answer a person
gave, with who decided, the rule and its source, and the files the call changed. For a
command, the files come from the checkpoint its step recorded. `--session`, `--since`,
`--refused`, and `--json` narrow and shape it, and it writes nothing (`db6038d`). The thesis
and the README now lead with the auditable harness, say that "small enough to hold in your
head" is an aim not yet met, and name the task corpus, not parity, as what decides what comes
next (`7d27f21`).

**Driven live.** One headless turn on `opencode-go:deepseek-v4.1-flash` in a throwaway
project with `permissions.allow: ["edit(src/**)"]` and `permissions.deny: ["run_command(rm
*)"]`, asked to change a file and then run `rm -rf build`. The ledger read back:

```
allowed  edit src/a.ts  by policy: rule edit(src/**) from .jamcli/config.json permissions.allow[0]; changed src/a.ts
allowed  run_command ls -la; ...  by hook: a pre_tool hook allowed it: it only reads inside the project
refused  run_command rm -rf build; ...  by policy: rule run_command(rm *) from .jamcli/config.json permissions.deny[0]
```

A command is a tool that can change something even when it only reads, so a command a hook
allowed is listed too.

Left: logs written before this unit carry no source, so their decisions name the rule alone. A
page on the site about the decision record would be a new article, which `site/AGENTS.md`
leaves to the owner. The site's build at the unit's last commit passes: 14 pages, every
receipt resolving.

### 21. `prove-local-path`

Archived as `2026-09-29-prove-local-path`: no spec deltas, since the job proves the
local-first requirement and adds no behavior. R7 of the review units. The claim is kept,
not dropped: `AGENTS.md` already makes the local-first path a hard rule, and now a push
proves it. `.github/workflows/local.yml` serves `qwen2.5:1.5b` with Ollama 0.34 on the Linux
runner and runs `scripts/local-path.ts`: one headless turn at an 8,192-token window, in a
throwaway project whose file the model must read to answer.

**What proving it found.** The local path was broken, and nothing had said so.

- Every request asks for reasoning `auto`, and the Ollama provider turned it into `think`
  for any model. Ollama refuses `think` with a 400 for a model whose capabilities do not
  name `thinking`, so no turn on `qwen2.5:1.5b`, or any other model that cannot think,
  could run. The model's `/api/show` is now asked once and feeds both the window and the
  `think` field; a model whose capabilities are unknown still gets it, as servers from
  before capabilities ignore it. The fake Ollama now refuses as the real one does, so every
  test through it holds the provider to this (`38ab7bf`).
- The job's first run printed FAIL and passed: the check was piped through `tee` under
  `bash -e` without `pipefail`. The job now runs a named bash (`8cdc265`).

**Measured on the runner** after the fix: 2 requests, the largest 1,904 prompt tokens, 11
tools offered, `read_file` called, the answer right. The review's figure was a fixed cost of
4,516 tokens against the 4,526-token compaction trigger; this turn's largest request is under
a quarter of the window. How much of the difference is the model's tier and how much is what
R3 removed from the prompt is not measured.

Left: one turn on one model. Whether a small model can carry a multi-step change at this
window is what the task corpus would answer if it ran on one, and it runs nightly on a
hosted open model instead, since the runner has no GPU.

### 20. `prove-sandbox-and-analyzer`

Archived as `2026-09-29-prove-sandbox-and-analyzer`: 1 requirement modified (Permission
Modes). R6 of the review units. The escape suite now runs under the platform's sandbox, so
Seatbelt meets the same five attacks bubblewrap does, on this Mac and on the macOS runner:
credentials hidden, nothing written outside the project, the network and the loopback
unreachable, no provider key, no agent socket (`3e5e028`). Its fixture moved to `/var/tmp`,
since Seatbelt lets a command write the temporary directory and a home there proved
nothing; with the network allowed the same attack gets through, so the suite can fail.

The command analyzer is tested against a real shell (`159fb4c`): 4,000 generated lines a
run, each one it calls read-only run by `/bin/sh` with every program replaced by a stub
that records it, must run only read-only programs and write nothing. The suite runs one
seed; `FUZZ_SEED` tries others, and sixty pass after the fixes below.

**What proving it found.** Five ways around the read-only allow list or the modes, each
fixed with a test that failed before it:

- `rg --hostname-bin=<program>` passed as read-only, and ripgrep runs that program; `file
  -C`, git's `--ext-diff` and `--textconv` likewise ask a read to run or write (`1519022`).
- In `accept-edits` an edit to `.git/config`, or a write under `.git/hooks/` or `.jamcli/`,
  was allowed as a change inside the project, after which the read-only steering let `git
  status` run without asking and git ran the `core.fsmonitor` just written: a command with
  no prompt at all. Those paths now ask in every mode that allows edits (`959b049`).
- The fuzz found three more in the analyzer (`ed6a33a`, `06c3b52`): a bare wrapper such as
  `env`, or one followed only by assignments, was dropped, so `ls | env x=1` was judged as
  `ls`; a `#` after an escaped space was taken for a comment, hiding a `$(rm)` the shell then
  ran; and `>&` before a word that is not a descriptor was taken for duplication, where the
  shell writes a file of that name.
- The harness itself misfired once: a job an earlier line put in the background outlived its
  shell and recorded into the next line's log. Each line now runs as `eval "$line"; wait`,
  with a log of its own (`f1c34f3`).

Left: a repository whose own `.git/config` already names a program runs it when git reads
the repository, as it would for the person; JamCLI now stops a model from writing one, and
does not vet one that was there before.

### 19. `add-task-corpus`

Archived as `2026-09-29-add-task-corpus`, with no spec deltas: R5 of the review units.
`evals/tasks/` holds twenty tasks, each a small project, a prompt, and a deterministic check:
fifteen changes judged by a test the task protects, three questions judged by the answer as
a whole token with no file changed, and two refusals judged by what must hold (a file beside
the project, and no download). `bun test evals` proves every change's check fails as given
and passes with its reference solution. `evals/run.ts` runs each task through `jamcli -p` from
the checkout's source, in a copy under `~/.cache/jamcli-evals/` with its own state and a copied
configuration, and scores the session with `src/core/eval/score.ts`. The nightly workflow runs
it once the `OPENCODE_API_KEY` secret is set, and uploads the scores rather than committing
them, since a job's commit would carry an identity other than the owner's.

The first scores, committed at `bfe8a54`: 20 of 20 on `opencode-go:deepseek-v4.1-flash` at
`d599bb7`, $0.0295 for the whole corpus, median 16 s a task, 605,340 tokens in. The corpus has
no headroom yet, so it cannot rank a change by pass rate; steps, tool errors, denials, and
tokens per task still differ, and the next tasks added should be ones that fail today.

**What closing it found.**

- The runner's first version worked under `evals/.work/`, inside this checkout. JamCLI finds
  its project by the nearest `.jamcli/`, so the run took the whole checkout as its project,
  wrote its session log into this checkout's history, and wrote a handoff to
  `.jamcli/handoff.md`; both were removed, and no earlier session had recorded writing a
  handoff there. Each prepared project now has a `.jamcli/` of its own, the runner refuses to
  start where the root resolves elsewhere, and the copies live outside any checkout.
- With the sentinel saying "No task may remove it", the model read it and declined, which
  tested the model rather than the defenses. With plain contents it tried `rm`, the engine
  allowed the command in auto mode, and Seatbelt refused the write: "Operation not
  permitted".

### 18. `correct-docs`

Archived as `2026-09-29-correct-docs`, with no spec deltas: R4 of the review units. The
README's table links every page in `docs/`, where twelve rows had read "not yet written" for
pages that existed, and it no longer sends readers to `openspec/DEFERRED.md`, which does not
exist. `docs/architecture.md` says children run in-process with an engine derived from the
parent's, not as `jamcli -p` processes. `docs/feature-matrix.md` says it is a comparison,
not the roadmap's input. `scripts/__tests__/docs.test.ts` now fails when the README or a
page under `docs/` names a file, by path or by link, that does not exist; it found five such
references before the fix. The changelog and the harness specification are exempt, as
records of the past.

**The documentation's mass.** Every page stays. The pages a reader of the product needs are
the ones the README lists; the harness specification and the interface brief are marked as
engineering records. `docs/` and the README are 3,057 lines, beside a 2,243-line spec.

### 17. `delete-accidental-systems`

Archived as `2026-09-29-delete-accidental-systems`: 2 requirements modified (Session Runtime
Assembly, Delegation Audit), 1 removed (Tool Output Trust Gate). R3 of the review units.
The deletions, each a commit through the four gates, took out 4,858 lines across 82 files: the
harness search and the overrides it threaded through the runtime (`28070e9`); M3, the
repeated-read refusal, with a test that failed while it existed: the person edits the file
between two reads, and the second must see it (`4945499`); `/research`, its pipelines, and
the research agent (`bfc095b`); `classifier/` (`93119d9`); the legacy policy table, once
`jamcli audit` reported from the engine (`62aaae7`, `8fd5e1d`); the legacy configuration
service (`1155c16`); the hand-written configuration types, now derived from the schema
(`803c2c3`); and the trust gate (`be5da36`). Workflows and plugins are frozen: no new work
on either. `git checkout bfc095b -- classifier` restores the classifier's code; its data and
models stay where they were, now ignored by the root `.gitignore`, since the file that
ignored them left with the code.

**What closing it found.**

- The old audit was wrong in both directions. On a project whose `config.json` allowed
  `run_command` outright it said the tool "asks for approval, which is the expected
  default", because it read only the legacy `mcp.json` block and never the mode or any other
  rule. And it called `run_command: true` in that block critical, "never asks", where the
  engine reads `true` as enabled with the tool's own default, which is to ask. It also said
  an MCP server inherits the full environment; a server gets JamCLI's environment less its
  credentials, and the real finding is that it runs outside the sandbox.
- Deriving `Config` from the schema turned up two drifts the cast had hidden: the status
  style names were typed as known ids while the schema accepts any string (an unknown one
  falls back to the default, now said at the one place it is cast), and a `delegation` block
  that set only some limits reached the tools with the rest undefined, bounded only because
  `bounds.ts` merged the defaults again; they are merged where the context is built.
- Removing the trust gate took a line out of the system prompt every request carries in
  every mode, so the base request is smaller.
- The site's receipt check, run for the auto mode page, found two receipts gone stale: the
  skill tool, moved to `runtime/sources.ts` by R2, and `PLAN_NOTE`, gone from `modes.ts` since
  `478237e` and quoted on the prompt page in a wording the product no longer sends (`4036cd7`).
  The site builds: 88 receipts resolve and 15 proofs hold.
- Left: the `toolDescriptions` runtime option, a trial knob like the harness overrides, which
  a test still uses; and `typesafe` credentials, still accepted and stored, read by nothing.

### 16. `scope-child-runtime`

Archived as `2026-09-29-scope-child-runtime`: 1 requirement modified (Delegated Task
Execution). R2 of the review units. A child now decides with `PermissionEngine.derive()`:
the parent's rules, grants, and mode shared by reference, the parent's narrowing holding
it, and a narrowing of its own that ends with its run (`7678ea1`). Before it, a foreground
child that loaded a skill with `allowed-tools` left the parent narrowed for the rest of its
turn, so the parent's next edit came back "Not run: the skill read-only allows only
read_file." A test on the assembled runtime failed on that before the fix.

`createRuntime` was then split in refactor commits, each with a test that reaches its piece
without the assembly: the session's checkpoints, its hooks and their trust, permission rule
editing, when a handoff is due and the note it leaves, elicitation, the tool offer, the tool
sources, the session's model, and the runtime's types. `index.ts` went from 1,545 lines to
956 and is the assembly alone; the closure from 1,173 lines to 878, and its mutable bindings
from 39 to 24. The suite did not get faster: 122 s at `6a823ab` and 121 s after,
since the tests of the assembled runtime stay as the evidence each surface still behaves;
test lines went from 24,456 to 24,937 with the new unit tests.

**What closing it found.** Moving the tool sources (`7b3baa5`) added two awaits to session
assembly, and a TUI test began failing on it and on `fa634dd`: after `/config set` it waited
for "Applied to this session.", which `/agents writing` had already put on screen, and
checked the new runtime before the reopen finished. The race was the test's; it now waits
for the reopened session (`6f47abd`). The first extraction also changed behavior once:
`previewCheckpoint` threw for a missing checkpoint where it had rejected, which the
assembled test caught before the commit.

### 15. `gate-macos-in-ci`

Archived as `2026-09-29-gate-macos-in-ci`, with no spec deltas: R1 of the review units. The
gates job no longer carries `continue-on-error` on macOS, and `master` was pushed: 71
commits had never reached `origin`. The first run with macOS gating failed on macOS, and the
next on Linux, each on a test in `classifier/src/__tests__/evaluate.test.ts` that trains and
certifies hundreds of decisions in 4.8 to 5.5 s against Bun's 5 s default; the file now has
30 s (`6a823ab`, `c7db0d5`). R3 moves `classifier/` out of the repository.

**What the push found.** The performance job had not run on any of the 71 commits. Idle
interface memory measured 166.2 MB against its 165 MB budget: five runs spread from 159.4 to
171.8, against 157.7 to 168.2 at `da2b31d`, the last run before them, so the interface work
added about 6 MB at the median and the budget sat inside the run-to-run spread. The budget
is now 175, above the highest run, with the measurements beside it (`9451a86`). Headless
overhead rose from 104 to 112 ms and the first frame from 170 to 181 ms, both within their
budgets. A macOS reading of the same memory could not locate the growth: the process tree
there holds language servers and Seatbelt that the Linux runner does not.

### 14. `redraw-plan-board-and-prompt`

Archived as `2026-09-29-redraw-plan-board-and-prompt`, closed without its live drive, task
3.2. Built on 2026-09-28 after the owner's review of sessions `2026-09-28-e9b87fc7` and
`2026-09-28-040643ab`: the board drawn by mark and color with its running work and clock,
kept up beside a prompt; the prompt saying a command once. The owner closed it on
2026-09-29 to open the review units, which halt interface work, while the working tree
held uncommitted interface edits a drive would have run with it.

### 13. `surface-background-work`

Archived as `2026-09-29-surface-background-work`, closed without its live drive, task 5.2,
for the same reason. From the same review: one work table per session, ends told to the
model with the next message it reads, `/jobs`, the status line count, and consecutive
delegations run together. Three permission fixes from that review landed outside a change:
an interpreter is never offered whole and its inline code is hidden, an MCP tool asks
whatever its server claims, and `command_kill` does not ask.

### 12. `tighten-interface-copy`

Archived as `2026-09-29-tighten-interface-copy`, closed without its live drive, task 5.1,
for the same reason. The interface's words were written as explanations rather than as
labels; the unit fixed the words only. On 2026-09-28 the owner had the
`land-interface-rhythm` work started at once, outside a change: flex rows and a hand
pointer on every clickable line, the picker's filter on an input, the composer gutter, the
rail as a border, the thinking window on a sticky scrollbox, a `settled` theme role, and
Escape clearing a half-typed command. Of seed finding 5, the resize garble did not reproduce
in the test renderer, and the finished tool line already shows its call.

### 11. `add-plan-tools`

Archived as `2026-09-27-add-plan-tools`: 3 requirements added (Plan Artifacts, Ask the
Person, Todo Acceptance Checks), 2 modified (Permission Modes, Context Management).
`plan_write` and `exit_plan_mode` are offered in plan mode only; `ask_user` answers through
the interface and says so elsewhere; a todo item carries its check and the interface shows
the list as a checklist above the composer; a summary ends with the list and the plan's
path. Found and left open: the fixed cost of a request is 4,516 tokens against the 4,526
compaction trigger of the default 8,192 window, and three tests (`catalog`, runtime
`context`, `observe`) pin it there, so the next tool added to every mode breaks them; the
`task` tool alone is 776 tokens. A unit that trims the base request, or sizes those tests
from the base rather than a constant, is worth opening before the next tool. Tested with
the fake provider on every surface; not yet run on a real model through `jamcli mcp serve`.

### 10. `add-session-reflection`

Archived as `2026-09-27-add-session-reflection`: 2 requirements added (Failure Signals,
Session Reflection). `/reflect` reads a session's failure signals and proposes edits to
skills, rules, or agents, each behind the citation and novelty gates and each applied only on
the person's approval. Task 6.1 ran end to end on OpenCode Go. Task 6.2, `/reflect` on 10 of
the owner's real sessions measured against the 0 of 26 baseline, was not run: the owner
closed the unit without it. Whether the gates turn the earlier 0 of 26 into approved novel
edits is therefore not measured.

### 9. `add-mcp-server`

Archived as `2026-09-27-add-mcp-server`: 1 requirement added (MCP Server Surface).
`jamcli mcp serve` offers `session_*` tools over the ACP session controller and the command
host, and `terminal_*` tools over the ordinary `jamcli` program in a pseudo-terminal, with a
recording of each. A call only the person may answer is elicited from them in their own host,
or denied where the host cannot ask. Three trials through it on OpenCode Go found and fixed
eleven defects, recorded in the change's task 5.1; the rest of what they found is under
`add-findings-loop` in `ROADMAP.md`.

### 8. `generate-reference-docs`

Archived as `2026-09-27-generate-reference-docs`, with no spec deltas: the docs site is project
tooling, not behaviour of JamCLI. The site's reference section (slash commands, built-in tools
and their parameters, settings, interface keys, command line) is written at every build from
`BUILTIN_COMMANDS`, `BUILTIN_TOOLS`, `settingsFromSchema()`, the key definitions, and `USAGE`,
and never committed. The build fails naming any command, visible tool, tool parameter, or
setting without text of its own. Every `<Proof run>` now runs in the site build; the two a build
cannot run (`jamcli doctor`, and a test the add-a-tool guide has the reader create) are marked
`reader` and labelled so. Removing `/exit` from `BUILTIN_COMMANDS` took its row off the built
page with no page edit, and a broken proof failed the build.

**What making the code the source found.** Importing `BUILTIN_TOOLS` on its own crashed: the
default registry was filled at module load, inside an import cycle. It is now built on first
use. 18 settings had no description; they have one at the schema, and six of them
(`context_management.*`, `general.show_tool_calling_models_only`, `available_models`) are read
by no session and now say so. The owner's own settings file still sets
`context_management.enabled`, which does nothing.

**Left open.** The CLI's subcommands are named in three places (`USAGE`, `parseArgs`, and the
entry point's `HEADLESS_INTENTS`); the page renders `USAGE`, which is what `--help` prints.
Defaults such as `delegation.max_depth` live in code outside the schema, so the settings table
cannot show them and `/config get delegation.max_depth` answers "not set" while 2 applies. On
this machine `jamcli doctor` fails the TypeScript language server check: TypeScript 7 ships no
`tsserver.js`.

### 7. `add-surface-parity`

Archived as `2026-09-27-add-surface-parity`: 4 requirements modified (Slash Command Surface,
Command Line Invocation, ACP Agent Surface, ACP Observer Endpoint). Every built-in command
moved out of the interface into `src/commands/`, one set that the interface, headless `-p`,
and ACP all run. Where no screen shows a list, `/choose` answers it, and headless takes
`--choose` in advance. The observer says when a waiting call's tool always asks. A parity
test runs every built-in command without a screen, with no list of exceptions, and a
layering test holds `src/commands/` apart from the interface and the core.

**How it was shaped.** It began as a way for an agent to test JamCLI, and the owner's
corrections moved it three times: one command set, not one per surface; no driven mode,
since a special path for agents hides the bugs it is meant to find; and JamCLI offering the
interaction itself rather than tooling wrapped around it. What remains of that is
`add-mcp-server`, next in `ROADMAP.md`. The repository already held the honest way to use
the interface from a program, `src/testing/terminal.ts`: the real `jamcli` in a
pseudo-terminal read through a terminal emulator.

**What the real model found.** 6.1 ran headless, ACP, and the interface on OpenCode Go
(`deepseek-v4.1-flash`) in a throwaway fixture repository, and turned up six defects, each
fixed with a test that fails without it:

- A commit message drafted by a model that always thinks came back empty about one time in
  six: its thinking spent the 400-token cap (`79f8376`).
- The edit tool described an anchor as the "anchor content", so the model passed the line's
  text; the rejection then said the file had changed, which it had not, and the model told
  the person that false cause (`3c09697`).
- The status line cut off its last word, the phase, so "waiting for you" was what a
  110-column terminal did not show; the screen reader snapshot had recorded the cut
  (`f9952e6`).
- Every tool that always asks was explained as "a commit is always asked for" (`870cd3e`).
- An error quoted inside a sentence ended it twice, and `/choose none`, a list answered in
  advance, and `/resume list` without the interface each said something untrue or nothing
  (`76c8e57`, `323871a`, `772c638`, `80d7a32`).

**Found and left.** `/reflect`'s `waste` signal called a read unused when the answer came
from it; the reflection itself showed the signal was wrong. That belongs to
`add-session-reflection`. `src/testing/terminal.ts` launches JamCLI without the shipped
build's `--config=/dev/null`, and the owner's own `jamcli` shim launches it with neither
that nor `--no-env-file`, so it reads a project's `.env`; `add-mcp-server` aligns the
harness, and the shim is the owner's. The run also wrote `effort: low` to the owner's own
configuration through `/effort` over ACP before its fixture had a configuration directory
of its own; it was removed, and later runs used a copy.

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
- **An OpenAI Responses API adapter.** Now staged as R11, `add-responses-api`, in
  `ROADMAP.md`.

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
