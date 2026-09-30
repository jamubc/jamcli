# Roadmap

What comes after `v2.0.0`, as units, in order. `SEQUENCE.md` carries the working rule: one
unit in flight, on its branch, finished only when archived. This file says which unit is
next and why, and records the owner decisions that shape all of them, so no unit has to
re-ask.

Written 2026-09-26 from session `2026-09-26-de8c4d4a`, the Claude Code source at
`claude-code-main/src` (2026-03-31 snapshot), the models.dev registry, LiteLLM's router
documentation, and Guardrails AI's validator model. Paths into this repository are cited
so each claim can be checked.

## Units from the 2026-09-29 review (these come first)

Staged 2026-09-29 from a whole-tree review of `master` at `949f99c`, kept verbatim in
`openspec/reviews/2026-09-29-architecture-review.md`. Its finding: the units further down
this file are parity-driven, taken from `docs/feature-matrix.md`, and one person with
agents chasing three funded teams on breadth produces a weaker copy by construction. The
defensible wedge is already in the code and nowhere in the positioning: the auditable
harness. Every action explained by a rule, every run reconstructible from one log, every
surface identical and driven through the real program, on open models.

R1 to R8 are the review's three months, in its order. R9 to R12 stage the rest of what it
found. Each is one openspec change, opened only when the one before it is archived. Every
unit recorded below this section waits behind them.

**Before R1.** The working rule holds. `tighten-interface-copy`,
`surface-background-work`, and `redraw-plan-board-and-prompt` are open, and the working
tree carries an uncommitted interface and wording diff with 14 failing tests. They close,
green and archived, before R1 opens. HEAD passes: 1,199 tests, 0 type errors.

### R1. `gate-macos-in-ci` (archived 2026-09-29)

- Push `master`. 71 commits are not on `origin`, which is the only copy off this machine.
  The owner pushes.
- Remove `continue-on-error` for macOS (`.github/workflows/ci.yml:23`), so red on the
  platform JamCLI is developed on is red, and fix what that turns up.

Done when a macOS failure fails CI and `master` equals `origin/master`.

### R2. `scope-child-runtime` (archived 2026-09-29)

Split `createRuntime` into owned pieces, and give a child its own engine derived from the
parent's rather than the parent's object.

`src/core/runtime/index.ts` is 1,545 lines: one closure with about 50 mutable bindings and
60 imports, returning about 50 methods. Nothing can be tested short of the whole assembly,
so the suite takes 159 s and 23,966 lines. Children take the parent's `PermissionEngine`
and `WorkTable` by reference (`children.ts:24-26`, `index.ts:587`). A skill's
`allowed-tools` narrows that shared engine (`index.ts:469`), and only a run with no parent
lets go of it (`index.ts:1435`). Checked 2026-09-29, from the code: this reaches a
foreground child as well as a background one, so once the child returns, the parent is
held to the child's skill for the rest of its turn.

1. A test that fails today: a child loads a skill with `allowed-tools`; the parent's next
   call after the child returns is not refused; a background child's narrowing never
   reaches the parent; the parent's turn ending does not lift the child's.
2. The child's engine, derived from the parent's so nothing it is configured with widens
   what the parent allows, holding its own narrowing. One behavior commit.
3. The split, in refactor commits kept apart from behavior, each piece testable without
   the whole assembly. The suite's time and size are measured before and after.

### R3. `delete-accidental-systems` (archived 2026-09-29)

Delete the legacy config and policy systems, `classifier/`, `HarnessOverrides`, and the
research pipelines. Freeze workflows and plugins. One deletion per commit, the four gates
at each, and the spec's requirements for removed behavior removed at archive.

- **Legacy config.** `src/services/ConfigService.ts`, still imported by the core runtime
  (`index.ts:16`, `index.ts:513`) and by children (`children.ts:8`) beside
  `src/core/config/load.ts`; the hand-written `Config` in `src/types/config.ts` beside the
  Zod `ConfigFile` in `src/core/config/schema.ts`. One system, one shape.
- **Legacy policy.** `src/core/policy/`, a per-tool table beside `src/core/permissions/`.
  Checked 2026-09-29: `jamcli audit` (`src/cli/audit.ts:4`) reports each tool's decision
  from that table (`src/core/policy/audit.ts:49`), not from the engine that decides, so
  what it shows can differ from what runs. `audit` moves onto `PermissionEngine`, which R8
  builds on.
- **`classifier/`.** Research that reached AUC 0.51 on 252 decisions, imported by nothing
  in `src/`. It moves out of the repository.
- **`HarnessOverrides` and `scripts/harness-search`.** An LLM prompt-search loop threaded
  through `RuntimeOptions` (`index.ts:82`, `index.ts:125`) into the prompt, verify, steer,
  and tool paths, expecting dev and held-out task splits that are not in the repository.
  Trials stay outside the product.
- **Research pipelines.** `src/core/research/pipeline.ts` and `/research`
  (`src/commands/builtin/research.ts`).
- **The trust gate.** A relevance filter at threshold 0.3 (`src/core/trust/index.ts:86`)
  doing duty as an injection defense, flagging the owner's own skill at 62%. It becomes a
  classifier measured through R5, or it goes. The sandbox and the network-off default are
  the real defenses.
- **M3, the repeated-read refusal** (`src/core/runtime/steer.ts:53`). Keyed on `lastTree`,
  which only a changing step moves (`index.ts:1011`), so an edit in the person's editor
  between two reads does not move the key and a legitimate re-read is refused with a stale
  first line. It goes, or is keyed on what was read.
- **Frozen, not deleted.** Workflows (`src/core/workflows/`) and plugins
  (`src/core/plugins/`): no new work on either.

### R4. `correct-docs` (archived 2026-09-29)

Fix the README table and the architecture claim about children.

- `README.md:73-84` marks twelve pages "not yet written"; every one is in `docs/`.
- `docs/architecture.md:80` says delegated children are `jamcli -p` processes;
  `src/core/runtime/children.ts` runs them in-process.

The docs are diverging at one week old: 5,096 lines of docs, a 2,141-line spec, and a
927-line harness spec beside `SEQUENCE.md` and this file. The review counts that mass as
accidental; which of it stays is decided in this unit.

### R5. `add-task-corpus` (archived 2026-09-29)

Check in twenty tasks with deterministic checks, run them nightly on a real open model,
and commit the scores. The scores become this file's input in place of
`docs/feature-matrix.md`.

Done: `evals/` holds the corpus and its runner, `evals/scores/` the scores, and
`.github/workflows/evals.yml` runs it nightly once the `OPENCODE_API_KEY` secret is set. The
first scores are 20 of 20 on `opencode-go:deepseek-v4.1-flash`, so the corpus has no headroom
yet: the next units add tasks that fail today before they are used to rank a change.

Before it, no task corpus was checked in, the trials tooling lived in the owner's gitignored
skills, and `src/core/eval/score.ts` ran in CI nowhere. Regressions were caught only by
scripted fake-provider tests, which test the harness, not the model. Live runs use
`opencode-go:deepseek-v4.1-flash` unless the owner names another model; its key is a CI
secret, never a file.

### R6. `prove-sandbox-and-analyzer` (archived 2026-09-29)

Run the Seatbelt escape suite on a Mac. Fuzz the command analyzer.

- macOS is the least defended platform and the one JamCLI is developed on. The Seatbelt
  profile (`src/core/sandbox/seatbelt.ts`) allows reading everywhere except the hidden
  list, and the hostile-plugin write escape is accepted and documented
  (`docs/security.md:63`). The suite's results are recorded against it.
- The read-only allow list in `src/core/tools/readonly.ts` is the one place a parser miss
  becomes unprompted execution. It is conservative and no hole was found, but it has
  seven test cases and no property or fuzz test. A fuzz test joins the suite, and it can
  fail.

### R7. `prove-local-path` (archived 2026-09-29)

Make Ollama on an 8k window a CI job with a real small model, or drop the claim.

"Local by default" is the least exercised path. The fixed cost of a request is 4,516
tokens against the 4,526 compaction trigger of the default 8,192 window (`SEQUENCE.md`,
unit 11), and every test fakes Ollama. The job runs on a CI runner, never on the owner's
machine. Keeping the claim or dropping it is the owner's decision, made when this unit
opens.

### R8. `add-audit-ledger` (archived 2026-09-29)

A command that answers what this agent changed, under which rule, from which source,
across sessions, shipped as the reason to use JamCLI.

The parts exist: every verdict names who decided, the rule, its scope, and its source
(`Verdict`, `src/core/permissions/engine.ts`), and the transcript records it (the approval
event, `src/core/transcript/events.ts`). `jamcli audit` today is a configuration and
secrets check. After R3 it reads the engine; this unit makes it the decision ledger. The
thesis in `openspec/project.md` and the README move onto the auditable harness here,
since "small enough to hold in your head" and "local by default" are contradicted by the
code as it stands.

### R9. `scale-the-log` (archived 2026-09-29)

- `SessionLog.events()` re-reads and re-parses the whole file on every call
  (`src/core/transcript/log.ts:136`), from checkpoint listing, notes, handoff, the gate
  ledger, fork, and close.
- The global session index is one JSONL rewritten whole on every update
  (`src/core/transcript/sessions.ts:85`).
- Schema evolution inside v2 is ad hoc, with one migration shim from v1. Config, the
  state index, the plugin lockfile, and checkpoint refs carry no version field.
- At ten times the use, five in-process children at depth two share one process, one
  engine, and one set of MCP connections, so one runaway child is the parent's memory. At
  ten times the code: custom grep and glob in `src/core/tools/search.ts` (548 lines) with
  ripgrep optional, and a git checkpoint on every changing step.

### R10. `add-contributor-gates` (archived 2026-09-29)

A linter, a formatter, and `CODEOWNERS`, so rules that live in prose today are held by a
tool. "One unit in flight" is a one-person rule, and the history is linear with zero
merges, so "units on branches" is not what the history shows.

### R11. `add-responses-api` (archived 2026-09-29)

Reverse the "will not do" in `docs/conformance.md:34` and `docs/feature-matrix.md:40`. It
records an agent's sandbox limitation, OpenAI's docs blocked from the build environment,
as a product decision. The internal canonical is the OpenAI function-call shape.

### R12. `run-release` (archived 2026-09-29, the tag left to the owner)

The release job with SBOM and provenance has never run (`docs/conformance.md`). It runs
once, end to end. There is no auto-update and no package manager path; both stay the
owner's decision.

### Recorded from the review, with no unit

- **Harness behavior as hook subscribers.** Steering, verification, LSP diagnostics,
  family tools, and handoff are 14 internal `hooks.on` registrations across three files,
  ordered by registration, on the bus user and plugin hooks share, so `agent.ts` no
  longer says what happens on `post_tool`. The hardest decision to reverse; R2 and R3
  shrink it.
- **Bun only, OpenTUI 0.5.12 pinned, TypeScript 7.** 19 files import OpenTUI and about
  4,000 lines of interface sit on a 0.5 API. The four frame snapshots are the flakiest
  tests in the suite and will churn at every upgrade.
- **`web_fetch` outside auto mode** hands web content to the model unscreened. What R3
  decides for the trust gate decides this.
- **Approval volume.** 58 prompts in four default-mode sessions, recorded as seed finding
  1 under `add-findings-loop`. The children's share of it is addressed by
  `label-and-batch-child-approvals` (D below).

### What the review would not build

A learned approval mode, since the data says no (AUC 0.51 on 252 decisions); more
reflection or research features, since reflection's own exit task, 6.2, was never run;
Windows; any new tool, since each costs the 8k path; and more interface polish, since the
last 200 commits are interface work. Against the units below, that names
`land-interface-rhythm` (B) and `add-btw` (C) as interface work and the shelved
`add-windows-support` as Windows. The owner confirms whether they are dropped.

### The question before the roadmap goes further

Who is JamCLI for besides the owner, and what will they run it on? Every real decision in
the record is one person, one project, 2.6 days, on cloud models. Until a second person
runs it on an open model for a week and their transcripts are in hand, the roadmap is
guessing. After R5, this file's input is the corpus's scores and those transcripts, not
the feature matrix. The second question is what the process costs: the spec and sequence
documents are half the size of the code.

## The thesis in one paragraph

jamcli's harness is sound: layered configuration with origins, a credential store, a model
chain per category, hooks that can rewrite a call or block it, rules, skills, sessions,
and a trust gate. What it lacks is the language and the seams that let a person shape it
without reading source. The model delegates blind (`src/core/runtime/index.ts:514` offers
category names and nothing else). A person can hold one key per provider and cannot name
a second account. A rate limit ends the conversation. Nothing stands between an agent's
answer and its reader. Each unit below adds one of those seams, on top of a part that
already exists, and none of them invents a mechanism another tool has not already proved.

## Owner decisions (2026-09-26)

Recorded once here. A unit that needs to revisit one says so in its proposal.

1. **The model chooses among configured agents, never a raw `provider:model`.** A list of
   thousands of ids is a guess, not a choice. Claude Code's own override is a three-value
   enum (`tools/AgentTool/AgentTool.tsx:86`).
2. **Built-in agents are `quick`, `intelligent`, `explore`, `writing`.** `deep` is gone.
3. **One concept, agents, folded in before any code is written.** Categories become the
   compatibility form of an agent with no rules body.
4. **Rules and stages apply to delegated agents only**, not the main conversation, in the
   first cut. The main conversation keeps today's behavior.
5. **A connection's name is a ref prefix.** `work:anthropic/claude-sonnet-4.5`. No new
   grammar: `resolveModel` (`src/core/runtime/model.ts:18-30`) already treats a custom
   endpoint id as a prefix through `knownProvider`. Built-in providers are connections
   with fixed names.
6. **Credentials: several accounts across several providers, many endpoints, rotation and
   fallback, team-shared config without secrets.** Nothing invented: the provider table
   is models.dev's, the failover semantics are LiteLLM's, the failure actions are
   Guardrails AI's.
7. **Settings and configuration are one store.** No parallel settings file. A command
   that changes a setting writes the configuration file and names it.
8. **Everything a person configures is observable**: listed by a command, recorded in the
   transcript when it acts, testable on sample input. No invisible force.

## Units, in order

Each unit is one openspec change. Its number is its order. A unit may start only when the
one before it is archived. Every unit from here on waits behind R1 to R12 above.

### 1. `add-agents` (archived 2026-09-27)

Done as below, with one change: the built-ins have no chain and run on the session's
model, not a local one. See `openspec/SEQUENCE.md`.


The open proposal, reframed. An agent is one markdown file, `agents/<name>.md` under the
user or project `.jamcli` directory, the way skills already load
(`src/core/ext/skills.ts:39-47`). Frontmatter carries `description`, `models` (the chain,
each entry with optional `reasoning`), and later fields other units add. The body is the
agent's rules: text the child reads as part of its system prompt and nothing else reads.
The four built-ins are agents with descriptions and no body, overridable by a file of the
same name. The `categories` configuration key keeps loading as an agent with no body.

The `task` tool lists agents to the model one line each, `- name: description (runs on
chain)`, inside guidance on when to delegate, when not to, and how to brief a child.
`agent` is optional and `delegation.default_agent` names the default. `reasoning` on the
call overrides the entry's level. The level actually reaches the child, which it does not
today (`src/core/runtime/children.ts:104-108` passes the model alone). `/agents` lists
them and sets the default through the configuration writer.

Why first: it is the smallest unit, it fixes the session that started this, and every
later unit hangs fields off the agent file.

### 2. `add-surface-parity` (archived 2026-09-27)

Opened by the owner on 2026-09-27, ahead of the units below. See `openspec/SEQUENCE.md`. Built-in commands move out of
the interface into `src/commands/`, one set every surface runs: the interface, headless
`-p`, and ACP. Where no screen offers a list, `/choose` answers it. The ACP observer says
when a waiting call's tool always asks. See the change for the whole of it.

### 3. `add-mcp-server` (archived 2026-09-27)

`jamcli mcp serve`: JamCLI as a tool for other agents, the way `claude mcp serve` is, so an
agent host (OpenCode, Claude Code, or JamCLI itself) can delegate work to JamCLI, and an
agent can use JamCLI's interface to find what is wrong with it, with nothing hand-rolled
around it. Two groups of tools on one stdio server:

- `session_*` (`start`, `send`, `answer`, `state`, `stop`): delegated work, built directly
  on the ACP session controller and the command host, so MCP means what ACP means. A turn
  that needs an answer returns the question; long turns report progress.
- `terminal_*` (`start`, `type`, `keys`, `screen`, `wait`, `resize`, `stop`): the ordinary
  `jamcli` program in a pseudo-terminal, read through a terminal emulator, from the harness
  the end-to-end tests use. There is no driven mode: the program is the one a person runs,
  launched as the shipped build launches. Each session is kept as an asciinema recording.

The person's answers stay the person's: a call to a tool that always asks is put to the
person through MCP elicitation in their own agent host, never answered by the calling agent,
and denied where the host cannot ask. Whether Claude Code and OpenCode support elicitation
is to be verified before the spec claims it. The bypass confirmation and the hooks trust
question show only on screen and are the person's by rule. A driven JamCLI never runs in
JamCLI's own checkout: it runs in a throwaway worktree of a fixture project, so its sessions
do not land in this repository's history and `/reflect` never learns from its experiments.

The harness it builds on launches JamCLI without the shipped build's `--config=/dev/null`;
it launches exactly as the shipped build does before any agent relies on it.

Acceptance: task 6.2 of `add-session-reflection` runs through `jamcli mcp serve`, an agent
driving `/reflect` over the owner's sessions and the owner approving each lesson by
elicitation. `jamcli-trials`, which imports JamCLI's source rather than using the product,
moves onto it.

### 4. `add-findings-loop`

What an agent finds while using JamCLI becomes an openspec proposal through the same gates
as any change, citing the recording and the session that show it, and the agent goes on to
the next thing to try. Findings about JamCLI's behavior are defects to fix in code, not
lessons for `AGENTS.md`; lessons stay with `/reflect`. The person reviews every proposal.
It needs `add-mcp-server`.

**Seed findings, 2026-09-28.** Four agents used JamCLI through `jamcli mcp serve` in
`monaco-code-editor` on `opencode-go:deepseek-v4.1-flash`, all in default mode. Sessions
`2026-09-28-c465faeb` (reading), `-cb7a64cb` (edits), `-8302e556` (commands), and
`-cd20d039` (the interface, recorded as `mcp-terminals/t1.cast` under that run's state
directory). Every answer and edit they checked was correct. What stands between that and
a person trusting it:

1. Approval volume. 58 approvals in four sessions, 43 of them `run_command`, 41 answered
   once. About half ran nothing that writes or executes. Two causes, both checked in code:
   the only built-in allow rules are `run_command(cd *)` and `run_command(pwd)`
   (`src/core/permissions/config.ts`, `BUILTIN_RULES`), so `git status`, `ls`, `wc`, and
   `grep` ask in default mode; and neither `run_command`'s description
   (`src/core/tools/command.ts`) nor `toolGuidance` steers the model to `read_file`,
   `grep`, and `glob`, which never ask. Candidates: a built-in allow list of read-only
   commands where the analyzer finds no redirect and no hidden part, and a description
   that sends reads and searches to the read tools.
2. Measured on 2026-09-28 in auto mode, the same three session trials (sessions
   `2026-09-28-5d352209`, `-83f8f987`, and the edits run): 12 approvals against 57 in
   default mode, with the answers and edits still correct. Every one left came from a
   command the analyzer marks hidden (`$(...)` or `xargs`), which offers no pattern to
   grant, or from a network tool. A grant for `web_fetch` did not cover `web_search`,
   though both asked with the same reason, "auto mode asks before tools that reach the
   network". So auto mode answers the volume, and the candidates above are for default
   mode and for read-only hidden commands.
3. One logical change to one file arrived as three approvals; one small feature spent
   many read-only and `web_fetch` calls before its first edit. Candidates: one approval
   for a turn's edits to one file, and a nudge after a run of calls with no change.
4. `/diff` shows the whole working tree, other sessions' edits included, while `/rewind`
   is the session's own. Candidate: a diff from the session's first checkpoint, over the
   files it touched.
5. The interface: growing the terminal from 60x20 to 120x40 shows a garbled frame for
   about three seconds; Escape on the `/` list leaves the filter text in the composer;
   long lines at 60 columns are cut with no mark; a finished tool line hides its
   arguments.
6. `/export` reports the path relative to the project (`../../../../tmp/...`) where it
   was given an absolute one.
7. The trust gate, seen only in auto mode. A removal notice names the tool but not the
   call, so with two `grep` calls in a turn it cannot be checked which was withheld.
   `/cost` leaves the classifier out of the total when it has no price
   (`typesafe:jev-latest`, 27 requests in one session). The log now keeps what was
   withheld as the removal notice's detail (`6f22d4d`).
8. `/rewind` to an early checkpoint undoes that step only, as D15 records as built; a
   file a later step created stays. The list labels a checkpoint "before edit
   find-replace.js", which reads as a point in time. Either the label or the restore
   should change.
9. From session `2026-09-28-22b86a6d` in the owner's home directory, the model reasoned
   wrongly from what JamCLI did not tell it. Turns on `openrouter:inception/mercury-2.5`
   said they were Mercury, which was true; after a `/model` switch DeepSeek owned those
   messages and called them a confabulation, since nothing says which model is running
   or that it changed. A `skill` result was withheld in auto mode, and after the mode went
   back to default the same call passed, which the model took for a random gate. The
   owner's own skill was flagged as an injection at 62%. The skill's
   `disable-model-invocation: true` is read nowhere in `src/`, so the skill was listed and
   loaded. The log shows each of these; `/copy` did not, which is why `/copy debug`
   exists. Four decisions for the owner: whether the environment block names the running
   model and a `/model` or `/mode` switch is told to the model; whether results of skills
   from the person's own directories skip screening as `state` does (a project's skills
   in a cloned repository are a real way in); how `disable-model-invocation` is honored
   when the model is the only one that loads skills; whether a resumed session restores
   its recorded mode, which it does not today.
10. The log did not hold the system prompt or the tool definitions a request carried. It
    now records them from the request as sent, whenever they change (`6f22d4d`), and
    `/copy debug` shows them.

### 5. `add-connections`

A connection is a named way to reach a provider: a provider kind, a base URL, a dialect,
and a credential filed under the connection's name in the store
(`src/core/config/credentials.ts:20`, `SERVICE = 'jamcli'`, account = connection name).
`api_registry.endpoints` (`src/types/config.ts:23-30`) is already this shape minus the
provider kind; the unit adds `provider` so an entry can say "this is Groq" and inherit
the base URL and environment variable from a bundled provider table.

The table is models.dev's provider list, checked in as a small JSON (223 providers on
2026-09-26: id, name, API URL, environment variable, dialect), regenerated by a script,
never hand-edited. 182 of the 223 are served by an OpenAI-compatible client, which
jamcli already has (`src/core/providers/openai-compat.ts`), so the unit adds no provider
code for them. Models are not bundled: `listModels` asks the endpoint, as it does now.

`jamcli auth set <connection>` stores under the connection name. `jamcli auth list`
shows each connection, its provider, and where its key comes from. Project configuration
may declare a connection with no key, which each teammate fills with `jamcli auth set`.
The wizard is a later unit; this one is flags and files.

Why second: agents name refs, and this unit widens what a ref can name without changing
how one is written.

### 6. `add-fallback`

A conversation should survive a rate limit or an exhausted key. Semantics are LiteLLM's,
reduced to one process: a connection that answers 429 or 402 is cooled down for a
configured time; while cooled, a chain skips it the way `resolveRoute` already skips an
unconfigured or unreachable entry (`src/core/routing/resolve.ts:33-51`), and the session
model falls through `session.fallbacks`, an ordered list of refs, with a notice naming
what happened and what is serving the turn now. Two keys for one account are two
connections in one chain. `ProviderError` already carries `status` and `retryable`
(`src/core/providers/http.ts:25-44`), so the classification exists.

Why third: it needs connections to have identity, and it is the second half of the
credentials decision.

### 7. `add-stages`

The observable pipeline. An agent file gains `input` and `output` lists. A stage is a
script (JSON on stdin, JSON on stdout, the hook contract at
`src/core/hooks/commands.ts:11-49`) or a prompt (a small model call on a named agent).
Each has `on_fail`: `fix` (default, replace the text), `block`, or `reask`, Guardrails'
vocabulary with `reask` opt-in because it is the loop that burns tokens. Output stages
run on the child's final text before the parent reads it, so the parent never sees a
broken rule. `jamcli agents test <name> "text"` runs sample text through the stages and
shows what each changed. The transcript records each stage that acted. `refine.ts` from
the web unit is the seam this occupies.

Why fourth: it needs agents to attach to, and the settle order (final text only, or hold
the stream) is decided here with the stream in hand.

### 8. `add-setup-wizard`

`jamcli setup` and `/setup`: an interactive path that writes the same files the flags
write, then shows what it wrote and where. Connections, keys, agents, fallbacks, stages.
It is an addition: headless, ACP, and the flags keep working with no TTY, as the auth
CLI does today (`src/cli/auth.ts:7-8`).

Why last: it has nothing to write until the shapes above exist.

## Inserted unit: `add-plan-tools` (archived 2026-09-27)

Raised by the owner on 2026-09-27, opened and archived the same day as
`openspec/changes/archive/2026-09-27-add-plan-tools`, ahead of unit 4. Its proposal carries
the sources; `SEQUENCE.md` carries what it found and left open. Each names what already exists so a
proposal starts from the seam, not from scratch. Sources: Ronacher, "What is plan mode"
(2025-12-17); Columbia DAPLab, "9 critical failure patterns of coding agents"
(2026-01-08); claude-world.com tutorials S03, S06, S07, S22.

- **Plan file.** Claude Code's plan is a markdown file the model may edit in plan mode and
  reads back on exit, and the person can edit it by hand. jamcli has no plan artifact.
  The nearest seam is `todo_write` (`src/core/tools/todo.ts`): `state`-classed, so it is
  already the one write plan mode allows, persisted under `.jamcli/`. A plan file would be
  a second `state`-classed tool or a `state`-classed path exception for `write_file`.
- **Exit-plan-mode tool.** Today the model cannot leave plan mode; the person cycles it
  (`src/tui/app/controller.ts` `MODE_CYCLE`) or an ACP client sets it. An exit tool would
  be a `state`-classed tool that raises an approval request carrying the plan, and the
  approval switches the mode. The approval path exists (`approval_request` events).
- **Ask-user tool.** No tool; the model asks by ending its turn with text. A tool would let
  the interface render options and would record the answer in the transcript. claude-world
  S22 frames the rule the prompt should carry either way: resolve, inform, ask, or stop,
  by consequence.
- **Task tracking that survives long sessions.** `todo_write` already persists to
  `.jamcli/todos.json` and is offered in plan mode, so `PLAN_NOTE` now tells the model to
  put the plan's steps there. Gaps against claude-world S03/S07: no per-item acceptance
  check, no `blockedBy` dependencies, and compaction (`src/core/context/compact.ts`) does
  not pin the list in the summary; the model must call `todo_read` to recover it.

## Inserted units: the interface

Raised by the owner on 2026-09-27. The interface reads as one long growing list: every
transcript row is drawn flush at column 0, and `marginTop={1}` on a user message is the
only vertical spacing in `src/tui/app/Rows.tsx`. Nothing groups a turn, and no tone
separates a settled row from the live one.

The cause is that the interface never landed its own brief. `docs/ux.md` is the stage-6
brief for it, and its mock already carries the `you` gutter, the blank line between groups,
tool calls indented under a `●` assistant bullet, a `│` rail for detail, status
right-aligned at the margin, and noun-led labels. The owner decided: two units, copy
first, and the brief is the floor rather than the ceiling.

### A. `tighten-interface-copy` (archived 2026-09-29)

The words only, so its snapshot diff is purely wording. Tool lines lead with the call and
carry state as the leading mark; phase words are one word each; the compaction line is a
fact; the composer invites instead of listing keys; a saved setting says it applied rather
than how. `describeCall` (`src/core/approval.ts`) is left alone, being already noun-led
and shared by every surface, and core diagnostics keep the what, why, fix shape
`docs/ux.md` prescribes for errors.

### B. `land-interface-rhythm`

Opens when A archives. Lands the brief's shape: grouping and spacing through OpenTUI's
flex props rather than the `padEnd` string padding the lists use today
(`Picker.tsx:95-98`, `Palette.tsx:37-41`, `Prompt.tsx:90-93`); `justifyContent`
`space-between` for right-aligned state, the pattern `Prompt.tsx:115` already uses for the
`[Esc]` badge; the `│` detail rail; and the composer gutter, which `App.tsx:877` sets to
zero against `framed()`'s default of one, so the placeholder sits flush on the border
while every overlay has a space.

Past the brief, tone and depth: new roles on `Theme` rather than new themes, built from
`mix()` and `sample()` in `src/tui/app/motion.ts`, which already blend hex and step at the
halfway point for the terminal's own foreground, and which only the spinner uses today. A
settled row and the live turn should read differently. Every role needs a value in all four
themes, and `monochrome` collapses them to `TERMINAL`, so the grouping has to carry itself
structurally and take tone as reinforcement only. The `NO_COLOR` frame is what catches that
being backwards.

It also folds in the interface defects in seed finding 5 above, being the same surface:
long lines cut with no mark at 60 columns, a finished tool line hiding its arguments,
Escape on the `/` list leaving its filter text in the composer, and the garbled frame for
about three seconds after a large resize.

### B2. `surface-background-work` and `redraw-plan-board-and-prompt`

Inserted 2026-09-28 from the owner's review of sessions `2026-09-28-e9b87fc7` and
`2026-09-28-040643ab`, and built the same day. The first gives each session one table of
what runs beside the turn (`src/core/work.ts`), tells the model when any of it ends with
the next message it reads, runs consecutive `task` calls together, and adds `/jobs` and
the status line count. The second draws the board by mark and color with its running work
and a clock, keeps it up beside a prompt, and has the prompt say a command once. What B
still owes after them: the flex-prop lists, tone layers beyond `settled`, and the resize
garble, which did not reproduce.

### C. `add-btw`

Raised by the owner on 2026-09-27, after A and B. `/btw` is a side exchange that does not
accumulate into the main thread: the conversation stays as it was, and the aside is scoped
to itself. JamCLI's own turn on it is that the recipient is chosen, interactively or typed,
so a named model answers at that point in the conversation's context and a person can ask
a second opinion of a different model without leaving the session.

It needs a system prompt that tells the recipient what it is: asked one thing, as a
bystander, not a worker with a task and not the session's agent. The seam is the delegation
path, `src/core/runtime/children.ts` and the agent files from `add-agents`, so a recipient
is an agent name before it is a ref. Source:
`mindstudio.ai/blog/claude-code-btw-command-save-tokens`, which describes the branch rather
than extension behavior and the token claim, and does not describe the responder's prompt,
so that part is ours to design and to justify.

## Inserted units: the report of 2026-09-29

The owner's report of 2026-09-29, after the review units closed, ordered two units, one at
a time, once the message queue was committed green. It decided both designs: pre-flight
grants for children rather than a mode that denies their asks without asking, and spinner
verbs as an opt-in style rather than a default or a new setting.

### D. `label-and-batch-child-approvals` (archived 2026-09-29)

A child is labeled by a title the model gives it; an approval request names the child that
asks; a grant settles every waiting ask it now allows; asks for the same call are one prompt;
and before a fan-out the person is asked once about what its children need. A grant scoped
to one fan-out's children was deferred until the ledger shows the need.

### E. `add-spinner-verbs` (archived 2026-09-29)

Plain phase words stay the default. A verb pool per phase is an optional part of a text
style in `custom_status_styles`, so no new configuration key is added (`src/types/config.ts`,
`src/styles/statusStyles.ts`), with one builtin style that bundles verbs. One pick per phase
change, from a counter seed; `retrying` and `compacting` stay literal; screen reader and
reduced motion unchanged; the status line's width measured on the displayed word. A global
verb list without phases is refused, since it hides what the agent is doing.

### F. `add-composer-recall`

Raised by the owner on 2026-09-29, after D and E. The composer loses the person's words and
place: a click on the transcript takes focus from it, Ctrl+C on a draft counts toward exit, and
nothing recalls what was sent. Opens as unit 29 (`SEQUENCE.md`). It adds a `prompt` event to
the session log as the record of what was typed, Up and Down recall, drafts kept on disk across
leaving, paste chips, a composer that grows, and a one-line row per agent on the board with
Down to choose one. No configuration key.

## Deliberately not planned

- Graded effort beyond `off | on | auto`. Only Anthropic exposes it; a provider unit if
  ever.
- Reloading configuration in a running session. A session holds one snapshot so the model
  is never told one set of routes and served another.
- Bundling the models.dev model table (4.9 MB). Endpoints list their own models.
- A visual canvas for stages. The configuration file, the list command, the test command,
  and the transcript are the observability. A canvas can render them later if wanted.
- Per-agent tool allowlists. Claude Code has them; nothing here needs them yet.

## Sources

- Claude Code source, 2026-03-31 snapshot: `tools/AgentTool/prompt.ts:43,66,101,112,235`;
  `tools/AgentTool/AgentTool.tsx:82-86`; `tools/AgentTool/loadAgentsDir.ts:76-92`;
  `utils/model/agent.ts:37-78`; `types/hooks.ts:64-125`.
- models.dev, `https://models.dev/api.json`, fetched 2026-09-26: 223 providers, 8,174
  models, 182 providers served by `@ai-sdk/openai-compatible`.
- LiteLLM router: `https://docs.litellm.ai/docs/routing` and
  `https://docs.litellm.ai/docs/proxy/reliability` (cooldown on 429, `allowed_fails`,
  ordered fallbacks).
- Guardrails AI validator actions:
  `https://guardrailsai.com/guardrails/docs/concepts/validator_on_fail_actions`
  (`fix`, `reask`, `filter`, `refrain`, `noop`, `exception`).
- OpenAI Agents SDK guardrails: `https://openai.github.io/openai-agents-python/guardrails/`
  (tripwires block; they never repair).
