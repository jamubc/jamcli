# Harness specification

The runtime under `src/core/` treated as one searchable surface: observation, context,
control, action, state, verification, recovery, handoff. The model is fixed. Every gain
comes from what surrounds it.

Grounded in the source at commit `31ab5ad` (branch `tighten-interface-copy`, 2026-09-28).
Paths and numbers are cited so each claim can be checked. **Exists** marks what the code
does today. **Add** marks what this document specifies. Every added rule, hook, or prompt
line cites a row of the failure register (F1 to F16) or a constraint carried from
`AGENTS.md` and `openspec/project.md`.

Constraints carried from the repository, not restated below:

- The control loop in `src/core/agent.ts` (`CoreAgent.turn`) is fixed. It is not a search
  variable. Prompt parts and middleware are.
- Nothing changes state without consent. A command the harness runs on its own goes
  through the same permission engine and sandbox as a command the model runs.
- No new configuration keys. A behavior is switched off by a deny rule or a tool mode.
- No memory, learning, or preference profile in the product. Durable state is a
  projection of the session log, the way exports and provider messages already are
  (`src/core/transcript/events.ts`).
- The local-first path stays working. Every addition must fit an 8,192-token Ollama
  window or step out of the way on one.

## 0. Failure register

Each row is a failure observed in this repository's record or a hard constraint. Sections
2 to 5 cite rows by id. A proposal that cites no row is not in this document.

| Id | Failure | Evidence |
|---|---|---|
| F1 | Approval volume from read-only shell commands. 58 approvals in four default-mode sessions, 43 of them `run_command`, about half running nothing that writes. | `openspec/ROADMAP.md` seed findings 1 and 2. `BUILTIN_RULES` in `src/core/permissions/config.ts:40` allows only `cd` and `pwd`. `toolGuidance` in `src/core/runtime/prompt.ts` never sends reads to `read_file`, `grep`, `glob`. |
| F2 | Read churn and split edits. One logical change to one file arrived as three approvals; one small feature spent many reads and fetches before its first edit. | ROADMAP seed finding 3. |
| F3 | Fixed request cost. The system prompt and 27 tool definitions cost 4,516 tokens against a 4,526-token compaction trigger on the default 8,192 window; the `task` tool alone is 776 tokens. Tool definitions estimate at 3,822 tokens by the runtime's own counter (measured 2026-09-28 with `estimateText` over `BUILTIN_TOOLS`). | `openspec/SEQUENCE.md` unit 11, found and left open. `src/core/context/estimate.ts`. |
| F4 | The model reasons from what the harness did not tell it. After a `/model` switch the new model called the old one's messages a confabulation; a result withheld in auto mode read as a random gate. | ROADMAP seed finding 9. `buildRuntimePrompt` names no model; `permission_mode` and `model` transcript events reach no message the model reads. |
| F5 | Trust gate false positives and unattributable removals. The owner's own skill flagged at 62 percent; a removal notice names the tool but not the call. | ROADMAP seed findings 7 and 9. `screen()` in `src/core/agent.ts`. |
| F6 | Compaction is a model call or nothing. `compact()` summarizes with one request over the whole older conversation and falls back to dropping it. No deterministic elision runs first. A summary request costs about the budget in input tokens. | `src/core/context/compact.ts`: `summaryPrompt`, `strategy: 'drop'`. |
| F7 | A tool description caused the wrong argument shape, and the error asserted a false cause. The edit tool called an anchor "anchor content", the model passed the line's text, the rejection said the file had changed, and the model told the person that. | `openspec/SEQUENCE.md` unit 7, commit `3c09697`. |
| F8 | Silent truncation at the output limit. A commit draft came back empty about one time in six because thinking spent the 400-token cap. | `openspec/SEQUENCE.md` unit 7, commit `79f8376`. |
| F9 | Completion asserted without a run. `todo_write` carries a `check` per item but nothing runs it; the description says "completed only after its check passed" and the runner accepts any status. A stop with unverified edits is accepted. | `src/core/tools/todo.ts` (`normalizeItem`, `todoWriteRunner`). `stop` hook in `src/core/agent.ts` has no built-in subscriber (`grep "on('stop'" src/core` finds none). `openspec/project.md`: "Status files and prose are not evidence; a fresh run is." |
| F10 | Repeated identical calls and unused reads are detected after the fact and never acted on. | `src/core/reflection/signals.ts` (`retry`, `waste`) is read by `/reflect` only. |
| F11 | Delegation failed raw on an unreachable provider; a partial `delegation` block left children unbounded; a child's approval prompt could not be answered and the owner stopped turns after 4 and 12 minutes. | `openspec/SEQUENCE.md` units 4 and 6, commits `9272739`, `7c03fa9`, `fba0ded`. |
| F12 | Resume loses state. A resumed session does not restore its recorded permission mode; `/diff` shows the whole tree, other sessions' edits included; `/rewind` to an early checkpoint undoes that step only. | ROADMAP seed findings 4, 8, 9. |
| F13 | No structured handoff. The only carriers across a context reset are the compaction summary and `pinnedState` (the todo list and the plan path, 4,000 characters). Nothing records which gates passed on which tree. A fresh session starts from the request alone. | `src/core/tools/plan.ts` (`pinnedState`, `PINNED_BUDGET`). `src/core/runtime/index.ts:795`. |
| F14 | Cache-hit rate is recorded and never reported. `cached_tokens` lands on every `usage` event; nothing in `/cost`, the trial report, or the log states the hit rate or counts prefix breaks. | `src/core/catalog/cost.ts`, `src/core/observe/session.ts`. |
| F15 | The eval driver imports the source. `jamcli-trials` scores by `contains`, `regex`, `fileContains`, `command`, and a judge; it has no trajectory scores, no failure taxonomy, and no held-out split. | `.claude/skills/jamcli-trials/trial.ts`, `SKILL.md`. `openspec/ROADMAP.md` unit 3 acceptance. |
| F16 | Small-window models cannot run. With 27 tools offered in every mode, the base request leaves an 8,192 window no room for a conversation. | F3, `openspec/SEQUENCE.md` unit 11. `createToolSet` in `src/core/runtime/tools.ts` offers every visible tool the mode allows. |

Two constraints act as rows: **C1**, nothing changes state without consent (`openspec/project.md`, promise 3), and **C2**, the local-first path stays working (`AGENTS.md`, hard rules).

## 1. Architecture

Six planes over one loop. The loop is `CoreAgent.turn`: project the transcript into
messages, stream a step, record one assistant message, run its calls through
`executeBatch`, record one result per call, repeat until no calls, a limit, a denial, or
a cancel. Nothing below changes that order.

```
                       ┌────────────────────────── observation ──────────────────────────┐
                       │ transcript/ (JSONL event log, v2)   observe/ (spans, log lines)  │
                       │ ADD gate, elision, steer, handoff events; cache-break counter    │
                       └───────────────────────────────┬─────────────────────────────────┘
                                                       │ projections
   ┌──────── context ────────┐   ┌────────── control ──────────┐   ┌──────── action ────────┐
   │ runtime/prompt.ts        │   │ agent.ts  (fixed loop)      │   │ tools/registry.ts      │
   │ rules/ ext/skills        │   │ hooks/ (in-process bus)     │   │ tools/dispatch.ts      │
   │ context/budget estimate  │──▶│ ADD middleware handlers on   │──▶│ permissions/ sandbox/  │
   │ context/compact          │   │   pre_tool post_tool stop   │   │ trust/                 │
   │ ADD context/inject.ts    │   │   pre_compact session_end   │   │ ADD tool tiers, wire   │
   │ ADD context/elide.ts     │   │ routing/ delegation/        │   │   schemas, error shape │
   └─────────────┬───────────┘   └──────────────┬──────────────┘   └───────────┬────────────┘
                 │                              │                              │
   ┌─────────────▼──────────────────────────────▼──────────────────────────────▼────────────┐
   │ state:  git/checkpoints.ts (refs/jamcli/checkpoints/<session>)  tools/todo.ts  plan.ts  │
   │         ADD verify/ledger (gate results keyed by checkpoint tree)  ADD handoff.md        │
   └─────────────────────────────────────────────┬───────────────────────────────────────────┘
                                                 │
   ┌─────────────────────────────────────────────▼───────────────────────────────────────────┐
   │ verification and governance:  ADD verify/gates.ts (detect)  verify/run.ts (execute)     │
   │   verify/middleware.ts (post_tool, stop backpressure)   permissions/ (unchanged engine) │
   │   eval/ (trajectory scores, taxonomy, clustering)  scripts/harness-search (outer loop)  │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Components by plane

**Observation.** Exists: `src/core/transcript/` (events: `session`, `message`, `approval`,
`usage`, `notice`, `context`, `screening`, `model`, `permission_mode`, `compaction`,
`checkpoint`, `end`); `src/core/observe/` (OpenTelemetry spans with `gen_ai.*`
attributes, log lines, prompt waits). Add: four event types (`gate`, `elision`, `steer`,
`handoff`) in `events.ts`; a cache-break count derived from `context` events; a session
summary line at `end` with tokens, cached share, gates run, steer count.

**Context.** Exists: `runtime/prompt.ts` (identity, rules, skills index, tool guidance,
plan note, environment), `rules/` (AGENTS.md, CLAUDE.md, `.jamcli/rules.md`, `# when:`
sections by path), `context/budget.ts` (window less output reserve less 10 percent margin,
trigger at 85 percent), `context/estimate.ts` (`TokenCounter` learning the provider's
ratio within 0.5 to 3), `context/compact.ts` (pair-safe boundary, `KEEP_SHARE` 0.3,
pinned state). Add: `context/inject.ts` (on-start facts under a fixed token cap) and
`context/elide.ts` (deterministic stages that run before any summary).

**Control.** Exists: `agent.ts`, `hooks/index.ts` (in-process bus: `session_start`,
`user_prompt_submit`, `turn_start`, `pre_tool`, `post_tool`, `stop`, `pre_compact`,
`compaction`, `notification`, `session_end`; verdicts merge deny over ask over allow,
block wins, `updatedInput` is schema-checked), `hooks/commands.ts` (user shell hooks on
eight of those events), `routing/`, `delegation/`. Add: six in-process handlers
registered by the runtime, listed in section 2. They are the middleware. User hooks keep
their protocol and run after them.

**Action.** Exists: `tools/registry.ts` (`RegisteredTool`: name, description,
`inputSchema`, `policy`, `runner`, `hidden`, `aliasOf`, `modes`, `alwaysAsks`),
`tools/dispatch.ts` (`executeBatch`: pre_tool verdict, decision, ask, checkpoint before
the first changing call, concurrent read-only groups, grouped delegations),
`runtime/tools.ts` (`createToolSet`: `deferred`, `alsoOffer`, `descriptions`),
`permissions/` (modes, rules with precedence, command analyzer), `sandbox/`, `trust/`.
Add: tool tiers chosen from the context budget; a wire schema separate from the
validation schema; error output shaped as cause and remedy; a built-in read-only command
allow list.

**State.** Exists: `git/checkpoints.ts` (a commit of the working copy on
`refs/jamcli/checkpoints/<session>` before a step's first change; `after` is the tree
once the step is done), `tools/todo.ts` (`.jamcli/todos.json`, items with `check`),
`tools/plan.ts` (`.jamcli/plan.md`), `session/store.ts`. Add: `verify/ledger.ts`, a
projection of `gate` and `checkpoint` events answering "which gates passed on which
tree"; `.jamcli/handoff.md`, rendered from the log at session end and at a fresh-context
reset; a `verified` field on a todo item set by the harness, never by the model.

**Verification and governance.** Exists: the permission engine and sandbox; `/reflect`
with citation and novelty gates (`src/core/reflection/`); `jamcli-trials`. Add:
`verify/gates.ts` (detect the project's own check commands from its manifests),
`verify/run.ts` (run one, bounded, through the permission path, shape its output),
`verify/middleware.ts` (post_tool and stop handlers), `eval/` (trajectory scorer,
taxonomy, clustering) and `scripts/harness-search/` (the outer loop, off product).

### What is deliberately absent

No planner and executor split, no critic agent, no debate, no self-refine pass, no
learned memory, no background process. Each is either measured inferior to an external
check at equal cost (section 4) or rejected in `openspec/project.md`.

## 2. System prompt skeleton and middleware intercept points

### 2.1 Prompt skeleton

The prefix a request carries is the system prompt and the tool definitions. Both must be
byte-identical from step to step within a session, because every provider's cache keys
on the prefix (Anthropic through `cache_control` on the system text and the last tool,
`src/core/providers/anthropic.ts:211-219`; OpenAI-compatible and Ollama by prefix match).
Anything that changes per turn goes into the newest user message, as `news` already does
(`src/core/agent.ts`, `[Work ended since your last turn: ...]`).

```
S1  identity                      exists  profile override or DEFAULT_IDENTITY
S2  project rules                 exists  rulesPromptText(rules): AGENTS.md, CLAUDE.md, .jamcli/rules*
S3  agent rules (child only)      exists  before S2 so the project's AGENTS.md wins
S4  skills index                  exists  names and descriptions only
S5  session_start hook context    exists  fixed for the session once collected
S6  tool guidance                 exists  ADD lines T1..T5 below
S7  verification note             ADD     the gates detected for this project, one line each
S8  mode note                     exists  plan mode only
S9  environment                   exists  root, cwd, platform, date; ADD model ref
```

Added lines, each with the row it answers:

```
S6 T1  Read, search, and list with read_file, grep, and glob. They never ask.           F1
       Use run_command for commands, not for reading files or listing directories.
S6 T2  Read a file once, then make every change to it in one edit or one apply_patch.   F2
       Re-read only what an error says changed.
S6 T3  A step is done when its check ran and passed. Say what ran and what it showed.   F9
       If a gate fails, fix it before saying anything is done.
S6 T4  A result that reads "withheld by the trust gate" was removed by a screen on      F4
       tool output, not by chance. Ask for it another way or tell the person.
S6 T5  When the note says the model or the mode changed, earlier messages were written  F4
       under the old one. Do not describe them as errors.

S7     This project checks itself with: typecheck `npx tsc --noEmit` (about 40 s),      F9
       tests `bun test` (about 130 s), build `bun run build`. The harness runs the
       typecheck after your edits and the tests before a turn ends with edits; a
       failure comes back to you as a result.

S9     - Model: opencode-go:deepseek-v4.1-flash                                          F4
```

S9's model line changes only on `/model`, which already rebuilds the agent
(`reassemble()` in `src/core/runtime/index.ts`), so it adds no cache break the switch did
not already cause. S7 is detected once at session start and never changes within one.

Per-turn dynamic notes, appended to the user message in the bracket form `news` uses:

```
[Model changed: X to Y. Messages above were written by X.]        on the turn after /model    F4
[Mode changed: default to auto.]                                  on the turn after /mode     F4
[Gate typecheck failed on your last edits: <shaped output>]       post_tool, section 4        F9
[Handoff from the previous session: <ledger tail, ≤ 600 tokens>]  first turn after a reset    F13
```

### 2.2 Intercept points

All six handlers register on the in-process bus at runtime creation
(`createRuntime`, beside where `session_start` hooks are collected,
`src/core/runtime/index.ts:930`). They run before user hooks. Each is a pure function of
the payload plus the ledger. Each emits a `steer` or `gate` event when it acts, so the
transcript shows every intervention.

| # | Event | Handler | Condition | Action | Row | Cost |
|---|---|---|---|---|---|---|
| M1 | `session_start` | `injectEnvironment` | always | Add S7 (detected gates) and the model line to the prompt; on a fresh-context reset add the handoff note to the first user message. Cap 600 tokens. | F4 F9 F13 | one `git status --porcelain=v2 --branch`, one `git log -5 --oneline`, manifest reads |
| M2 | `pre_tool` | `steerReads` | `run_command` whose analyzed parts are all in the read-only list and touch no redirect | Return `decision: allow` with `by: 'builtin'` so default mode stops asking; record `steer`. | F1 | none |
| M3 | `pre_tool` | `dedupeCall` | a call identical in name and arguments to one already answered this turn, tool class `read` | Return `block` with the earlier result's first line and "same call, same result; the file has not changed since" when the ledger tree is unchanged, else let it run. | F10 | none |
| M4 | `post_tool` | `gateAfterEdit` | the step's `afterChange` settled a checkpoint whose `after` tree has no `gate` row for tier T1 | Run tier T1 (typecheck or equivalent) through the permission path; append shaped output to the last result of the step; record `gate`. Skip and record `skipped` when the last T1 run took longer than 60 s. | F9 | one process, bounded |
| M5 | `stop` | `backpressure` | the turn changed files and the current tree has no passing T2 row, or a todo item is `completed` without a `verified` stamp | Return `decision: deny` with the failing gate's shaped output as `reason`. At most twice per turn (`stopHookActive` is already passed to the handler); on the third, allow and emit a warn notice naming what is unverified. | F9 | one process per re-ask |
| M6 | `pre_compact` | `elideBeforeSummary` | always | Run elision stages E1 to E4 (section 3) on the older messages; add "the todo list and gate results are pinned; do not restate them" to the focus. | F6 F13 | none |

A seventh handler, `writeHandoff`, runs on `session_end` and after `compaction` with
`strategy: 'drop'`: it renders `.jamcli/handoff.md` from the log (section 3.4). It is a
projection, so it has no failure mode of its own beyond disk errors, which are notices.

Switching a handler off needs no key. M2 is off when a deny rule covers the command. M4
and M5 are off when a deny rule covers the gate command (`"deny":
["run_command(bun test *)"]`), because the gate runs through the engine. M3 and M6 have
no side effect and stay on.

### 2.3 Tool surface changes

**Wire schema versus validation schema.** Exists: `RegisteredTool.inputSchema` is both
what the model sees and what `validateAgainstSchema` checks. Add: an optional
`wireSchema` on `RegisteredTool`; `createToolSet` offers `wireSchema ?? inputSchema`,
`ToolRegistry.execute` validates against `inputSchema`. Legacy parameters (`start_line`
"kept for older callers" in `src/core/tools/read_file.ts:102`) and rarely used ones leave
the wire and stay accepted. Target: `edit` from 311 to under 180 tokens, `grep` from 275
to under 150, `todo_write` from 203 to under 120. Measured by the script in section 7.
Row: F3, F16.

**Tiers.** Add: a `tier` on each built-in, `core` or `extended`. Core: `read_file`,
`glob`, `grep`, `edit`, `write_file`, `run_command`, `todo_write`, `todo_read`,
`command_output`, `command_kill`. Extended: everything else. `createToolSet` offers the
extended tier when `budget.budget - baseCost(core) >= 2 × outputReserve`, else offers
core and defers extended behind `search_tools`, the mechanism MCP tools already use
(`ToolSetOptions.deferred`). The decision is made once per session from the model's
window, so it is not a setting. Row: F3, F16, C2.

**Family gating.** Add: `task_status`, `task_result`, `task_cancel`, `delegate_status`,
`delegate_result`, `delegate_cancel` are offered from the step after the first background
task or delegation starts (the work table already knows, `src/core/work.ts`), not before.
This is one prefix break per session, at a moment the conversation changes anyway. Row:
F3.

**Read-only command allow list.** Add to `BUILTIN_RULES`: `ls`, `cat`, `head`, `tail`,
`wc`, `file`, `stat`, `rg`, `grep`, `find` without `-exec` or `-delete`, `git status`,
`git diff`, `git log`, `git show`, `git branch`, `tree`. The analyzer already splits on
`&&`, `||`, `;`, and pipes and asks on anything hidden (`$(...)`, `eval`, dynamic
redirects), so the list applies only to lines it can read whole. A redirect to a file is
a write and is not covered. Row: F1.

**Error shape.** Add to every built-in error: cause first, then remedy, then the data the
remedy needs. `edit` on no match: the three nearest lines by trigram similarity with
their numbers. `edit` on ambiguity: the matching line numbers (exists in part:
`AmbiguousMatchError`). `edit` on stale anchors: fresh anchors (exists:
`StaleAnchorError`). `run_command` on non-zero exit: the first line that matches
`error|failed|Error:` before the head. Never assert a cause the tool did not observe.
Row: F7, F2.

**Output limit.** Add: any harness-initiated completion with a cap (`draftPrompt` at 400
tokens, the judge, the summary) passes `reasoning: 'off'` when the model accepts it, and
retries once at double the cap when `stopReason` is `max_tokens` or `length` with an empty
body. Row: F8.

## 3. Context management policy

### 3.1 Injection at start

Budget: 600 tokens total for M1, measured by `estimateText`. Order of precedence when the
budget is short: gates, then model line, then handoff tail, then git facts.

```
gates      S7, one line per detected gate with its command and last measured duration
model      S9 model line
handoff    first turn only, after a reset: the ledger tail (section 3.4)
git        branch, ahead/behind, count of modified and untracked files; never the file list
```

Not injected: directory listings, file contents, the todo list (the model reads it with
`todo_read`; the summary pins it), recent commits (one `git log` is one read tool call
away and would go stale).

### 3.2 Budget arithmetic

Exists and unchanged: `contextBudget(window, outputReserve)`; trigger at 85 percent of
budget; `TokenCounter` corrected by reported prompt tokens except from Ollama; proactive
compaction off when the window is a guess. Add: one lower threshold, `ELIDE_AT = 0.6 ×
trigger`, at which stage E runs once per crossing. Two crossings per session are the
expected case: once at 60 percent, once inside compaction.

Why a threshold and not per step: elision rewrites older messages, and a rewritten
message invalidates the cached prefix from that point on. Elision therefore runs only at
moments a break is paid anyway (compaction) or at one planned moment (the 60 percent
crossing). Never at every step. Row: F14, F6.

### 3.3 Compaction stages

```
E   deterministic elision      add      no model call, runs at ELIDE_AT and inside pre_compact
S   model summary              exists   summaryPrompt over renderForSummary, pinned state appended
D   drop                       exists   when S fails; now runs after E so less is lost
R   reset with handoff         add      a fresh session whose first message carries the handoff
```

**Stage E**, in order, over messages older than the `KEEP_SHARE` window. Each rewrite
replaces a tool result's `content` with a stub that names what it was and why it is gone.
The stub is under 200 characters. The `message` event for the original stays in the log;
a new `elision` event names the message index, the stage, and the tokens removed.

```
E1  superseded reads     a read_file result for a path that a later read_file, edit,     F6
                         write_file, or apply_patch touched. Stub: "[read <path> lines
                         a-b; superseded by <tool> at step n]"
E2  settled commands     a run_command result with exit 0 older than 6 steps. Stub keeps  F6
                         the command, the exit code, and the last 3 lines.
E3  failed commands      a run_command result with non-zero exit older than 6 steps.      F6
                         Keep the command, the exit, the first line matching an error
                         pattern, and the last 5 lines.
E4  duplicates           two results with identical content: the second becomes           F6 F10
                         "[same as the result of call <id>]".
E5  large results        any result above 4,000 characters older than 10 steps: head      F6
                         1,000 and tail 500, through HeadTailBuffer.
```

Never elided: the latest result of any tool for a path still in the todo list; any
result the model quoted by path in a later assistant message (the `waste` detector's
mention test, reused); results younger than the `KEEP_SHARE` boundary; the request
message; summaries.

**Stage S** is unchanged except that its input is the elided conversation, so the
summary request costs less and the summary has less to lose. The pinned block gains one
line per gate, from the ledger: `typecheck passed on tree 3f9a at step 14`.

**Stage R** is the long-horizon reset (section 3.4). It is chosen over S when a session
has compacted twice already, or by the person with `/handoff`, or by a workflow step's
end. It never runs on its own inside a turn.

### 3.4 Externalization rules

What lives on disk and what lives in context:

| State | Owner | Where | Read by the model how |
|---|---|---|---|
| The plan | model | `.jamcli/plan.md` (exists) | `read_file`; path pinned in summaries |
| Steps and their checks | model | `.jamcli/todos.json` (exists) | `todo_read`; list pinned in summaries |
| Which gate passed on which tree | harness | ledger: projection of `gate` and `checkpoint` events (add) | pinned line per gate; handoff tail |
| `verified` stamp per todo item | harness | `todos.json` (add field) | shown by `todo_read` as `[verified: bun test, tree 3f9a]` |
| Working copy before each change | harness | `refs/jamcli/checkpoints/<session>` (exists) | not read; `/undo`, `/rewind`, `/diff` |
| Handoff | harness | `.jamcli/handoff.md` (add), rendered from the log | first user message after a reset |
| The conversation | harness | session JSONL (exists) | projected into requests |

The handoff file is a rendering, never a source of truth. It is regenerated from the log
each time and holds:

```
# Handoff <session id> <timestamp>
Request: <the latest user request, verbatim, as latestRequest() finds it>
Steps: <todo list with status, check, and verified stamp>
Gates: <one line per gate: name, command, tree, result, step>
Changed: <files touched since the session's first checkpoint, from the checkpoint events>
Open: <the last failing gate output, shaped, if any>
```

It contains facts from the log and nothing the model or harness inferred. It carries no
lessons; lessons stay with `/reflect`. It is per project, under `.jamcli/`, which is
gitignored. These three properties are what keep it outside the rejected memory
category in `openspec/project.md`.

### 3.5 Cache-stability rules

1. The prefix (system prompt, tools) changes only on `/model`, `/mode`, a rules file
   change the person makes, a tier change at session start, and the one family-gating
   break. Each is recorded as a `context` event, which exists, so breaks are countable.
2. Per-turn facts go in the newest user message.
3. Earlier messages are rewritten only at `ELIDE_AT` and inside compaction.
4. `descriptions` overrides (`task` listing agents) are computed once per session.
5. The date in S9 changes at midnight. Accepted.
6. Ollama's `cached_tokens` is not reported, so on Ollama the hit rate is inferred from
   prefix stability alone; the estimate says so.

Metric: `cache_hit = Σ cached_tokens / Σ prompt_tokens` per session, and `cache_breaks =
count(context events) - 1`. Both are reported by `/cost` and in the trial report. Row:
F14.

## 4. Verification and backpressure protocol

### 4.1 Gate detection

Once per session, from manifests only. A gate is a command the project already declares
about itself. Nothing is invented.

| Manifest | Gate tier | Command |
|---|---|---|
| `package.json` scripts | T1 typecheck if `typecheck` or `tsc` appears; T2 `test`; T3 `build`; T1 `lint` when present | the script, through the detected package runner (`bun`, `pnpm`, `npm`) |
| `tsconfig.json` without a script | T1 | `npx tsc --noEmit` |
| `pyproject.toml` or `setup.cfg` | T1 `ruff check .` or `mypy` if configured; T2 `pytest -x -q` | as configured |
| `Cargo.toml` | T1 `cargo check`; T2 `cargo test` | fixed |
| `go.mod` | T1 `go vet ./...`; T2 `go test ./...` | fixed |
| `Makefile` | T2 `make test` when the target exists | fixed |
| `AGENTS.md` fenced block under a heading containing "gate" | as listed, in order | the block's lines |

The last row makes this repository's own four gates authoritative for itself
(`AGENTS.md`, "Four gates, every change"). Duration per gate is learned from the first
run and recorded in the ledger; S7 shows it.

Tier T0 exists already in another form: the `lsp` tool's diagnostics when a language
server is up (`src/core/lsp/`). M4 prefers T0 for a single edited file when a server is
running, since it costs no process.

### 4.2 When gates run

```
after each step that changed files      M4: T0 if available, else T1 scoped when the runner
                                        supports a file argument, else T1 whole. Bounded
                                        by the last measured duration; over 60 s it is
                                        deferred to stop and recorded as skipped.
on a stop attempt with changed files    M5: T1 if not passing on this tree, then T2.
on the model's own gate run             recognized by matching the detected command in a
                                        run_command call; the result is recorded as a
                                        gate row so the harness does not rerun it.
before /commit and /pr                  T1 and T2 on the tree to be committed; a failure
                                        is shown to the person, who decides (C1).
```

Results are keyed by the checkpoint `after` tree (`Checkpoint.after`,
`src/core/git/checkpoints.ts`). A tree that has a passing row is never re-checked. This
is the whole cache: no timestamps, no file lists.

### 4.3 Permission and sandbox

A gate the harness runs is a `run_command` call the harness makes, on the path `!` and
workflow `run` steps already use (`CoreAgent.direct`, `src/core/agent.ts`). It is
decided by the permission engine and runs in the sandbox. In `default` mode it asks once
with the suggested grant `run_command(<gate command>*)`, which the person allows for the
project and never sees again. In `auto` mode it runs unasked inside the sandbox. In
`plan` mode gates do not run, because nothing changes. A deny rule on the command turns
the gate off. Row: C1.

### 4.4 Output shaping

The model never reads raw gate output. `verify/run.ts` returns:

```
<gate name> <passed|failed|skipped> in <s> on tree <short>
<first 20 lines matching /error|fail|✗|FAIL|Error:/i, each with file:line kept>
... <n> more
<last 5 lines>
```

Under 1,500 characters. The full output goes to the log at debug level, as tool outputs
do. Row: F6, F9.

### 4.5 Backpressure semantics

M5 returns `decision: 'deny'` with the shaped failure as `reason`. The loop already
turns that into a user message, `[A stop hook asks you to continue: <reason>]`, and sets
`stopHookActive`. Rules:

- At most two denials per turn. The third stop is allowed with a warn notice: "The turn
  ended with <gate> failing; see the result above." The person decides.
- A denial never runs when the turn changed nothing.
- A todo item the model marks `completed` without a `verified` stamp on the current tree
  is a denial with reason "item n is marked completed but its check has not passed on
  this tree; run it, or mark the item in_progress".
- A gate the person denied (permission) counts as skipped, not failed, and does not deny
  the stop. Consent is not overridden by verification.
- Children (`surface: 'child'`) get M4 but not M5: a child out of steps already wraps up
  (`wrapUpOnLimit`), and the parent's stop covers the tree. Row: F11.

### 4.6 Where self-judgment is inferior

A self-review pass ("check your work") costs one request over the whole context and
returns text the harness cannot act on. A typecheck costs one process and returns
file:line facts the harness can act on: run again, deny a stop, stamp a todo. Debate
between two model calls costs two requests and still returns opinion. Under this
protocol the model is asked to fix what a gate reports, never to judge whether it is
right. The judge in `jamcli-trials` stays for qualities checks cannot see (clarity,
honesty of the reply) and is never an acceptance signal (section 6). The experiment that
would overturn this is R9 in section 8.

## 5. Failure clustering and mutation routing

### 5.1 Taxonomy

`signalsOf` in `src/core/reflection/signals.ts` is the single source. It gains kinds and
subtypes; `/reflect` and the evaluator read the same function.

```
tool_error      schema_invalid | stale_anchor | ambiguous_match | not_found | timeout | other   exists, add subtypes
denied          by user | by rule | by mode                                                       exists, add subtypes
cancelled                                                                                        exists
retry           identical call repeated                                                          exists
correction      user message after a failure                                                     exists (low confidence)
waste           spike | unused_read | redundant_read | read_via_command                          exists, add subtypes
gate_fail       tier, first_try | after_fix                                                      add
false_done      stop denied by M5; todo completed without verified                               add
limit           steps | calls_per_turn | output_tokens                                           add
context         compaction_drop | overflow_retry | over_budget_notice                            add
confabulation   assistant text claims a change with no write in the step, or names a            add
                model or mode the log contradicts
```

Signature of a signal: `kind/subtype/tool/<normalized detail>` where the detail keeps
the tool, the argument keys, and the error's first clause with paths and numbers
replaced by placeholders. Two sessions with `edit` failing on "no match" for different
files share a signature.

### 5.2 Clustering

Over a trial's set of session logs: group signals by signature, weight each cluster by
`count × (tokens spent in the step and its repair) + 5 × (tasks it appears in that
failed)`. Rank. The top three clusters of a cycle are the mutation targets. No
embedding, no model call: the signature is deterministic and the weights are token
counts from `usage` events.

### 5.3 Routing table

Each cluster maps to the surface that owns its cause. The mapping is fixed; the
proposer chooses what to change on that surface, not which surface.

| Cluster | Surface | What may change |
|---|---|---|
| `tool_error/schema_invalid`, wrong argument shape | tool wire schema and description | property descriptions, required set, examples in the description |
| `tool_error/stale_anchor`, `ambiguous_match`, `not_found` | tool error shape | the remedy text and the data returned with it |
| `waste/read_via_command`, `denied/by mode` on reads | prompt S6 and M2 list | guidance lines; the read-only allow list |
| `waste/unused_read`, `redundant_read` | prompt S6 and M3 | guidance lines; the dedupe condition |
| `false_done`, `gate_fail/after_fix` repeated | M5 parameters, then S6 T3 | denial cap, which tiers run at stop; then the wording of T3 |
| `gate_fail/first_try` high | M4 parameters | which tier runs after edits, the 60 s bound |
| `context/*` | elision thresholds and stage list | `ELIDE_AT`, ages in E2, E3, E5 |
| `confabulation` about model or mode | S9 and the per-turn notes | the note wording |
| `retry` | M3 | condition and stub text |
| `limit/steps` | loop budget or delegation guidance | `max_steps` is configuration and stays; the `task` description may change |
| `denied/by user` with feedback | not a mutation target | read the feedback; a person's no is data for `/reflect`, not for search |

Joint mutations (prompt and middleware together) are allowed only for the two rows that
name both, and a joint candidate must beat the better single-surface candidate of the
same cycle to be kept.

### 5.4 Minimal search loop

Optimizer-agnostic. The proposer is a function; OPRO-style (a model reads clusters and
proposes text), DSPy-style (a compiled program over prompt parts), PRISM-style, or a
person all fit the same interface.

```
Candidate = {
  promptParts:   Partial<Record<'S6'|'S7'|'S9'|'notes', string>>,
  middleware:    Partial<{ M2: string[]; M3: { sameTreeOnly: boolean }; M4: { tier: 'T0'|'T1'; boundS: number };
                          M5: { maxDenials: number; tiers: ('T1'|'T2')[] }; E: { elideAt: number; ages: number[] } }>,
  tools:         Partial<Record<toolName, { description?: string; wireSchema?: JsonSchema }>>,
}

loop(cycle):
  logs      = run(baseline, devTasks, repeats=3)
  clusters  = rank(cluster(signalsOf(logs)))[0:3]
  surface   = route(clusters)                       # table 5.3
  cands     = propose(clusters, surface, history)   # ≤ 4 per cycle
  for c in cands:
      lint(c)                                       # no dev-task names or paths in any text; length caps
      scores[c] = run(c, devTasks, repeats=3)
  best = argmax over cands of RelLift(success), subject to
         tokens_per_completed_task RelLift ≤ +10%  and  cache_hit not down more than 5 points
  if CI_lower(RelLift_success(best)) > 0 or (success unchanged within CI and tokens down ≥ 15%):
      held = run(best, heldOutTasks, repeats=3)
      if held confirms direction: accept(best); history.push(best, scores, held)
      else: reject, record as overfit
  budget: ≤ 5 × (|devTasks| × 3 × 2) runs per cycle; stop the cycle when spent
```

`run()` is `jamcli-trials` with `variants` extended by `promptParts`, `middleware`, and
`tools`, passed to `createRuntime` as options the trial driver sets. They are not
configuration keys a person sets; shipped values are constants in the source, changed by
a commit the person reviews. Row: no new settings.

RelLift for a metric m: `(m_candidate − m_baseline) / m_baseline` over paired tasks and
repeats. Confidence intervals by bootstrap over task-repeat pairs, 1,000 resamples.

Acceptance writes the winning constants into the source as a normal commit with the
trial folder cited. The product never mutates itself.

## 6. Evaluation plan

### 6.1 Metrics

Hard, per run, from the log and the worktree:

```
success            every deterministic check passed (contains, regex, fileContains, command exit)
tokens_in/out      Σ usage.prompt_tokens, Σ usage.completion_tokens, session and children
cached_share       Σ cached_tokens / Σ prompt_tokens                                      F14
cache_breaks       count(context events) − 1                                              F14
cost_usd           Σ usage.cost; unpriced requests counted separately (exists in CostLedger)
steps, calls       from step_start and tool_call events
approvals          approval events with allow decided by user; split by tool class         F1
tool_errors        tool results with status error or timeout, by taxonomy signature
gate_runs          gate events: tier, result, duration, first_try
false_done         M5 denials
compactions        compaction events by strategy; elision events and tokens removed
wall_s             end.ts − session.ts
```

Component scores, per run, deterministic:

```
reads_before_first_edit        count of read tool calls before the first write-class call        F2
edits_per_file_per_turn        mean; target 1                                                    F2
read_via_command               run_command calls whose parts are all in the read-only list       F1
gate_first_try                 share of T1 runs that passed on the first tree they saw           F9
repair_steps                   steps between a failing gate and the next passing one             F9
summary_fidelity               every path edited before a compaction appears in its summary      F6
                               or pinned block; set inclusion, no model
handoff_pickup                 after a reset, steps until the first write-class call             F13
```

Soft, judge only, never for acceptance: reply clarity; whether the reply's claims about
what ran match the log (a 1 to 10 score with a two-sentence reason, as today).

### 6.2 Task pool and held-out protocol

Tasks are specs in the `jamcli-trials` format with deterministic checks. Pool size to
start: 24 in `monaco-code-editor` and 12 in a second fixture project of a different
language, so gate detection is exercised twice. Split 2:1 into dev and held-out by task
id hash, fixed per quarter. The dev split is the only one the loop in 5.4 reads.
Held-out runs happen only at acceptance and are never shown to the proposer. After four
accepted cycles, the split is re-drawn and the history notes it.

Repeats: 3 per task per variant. Model: `opencode-go:deepseek-v4.1-flash` as the owner
set. Each run in a detached worktree from `HEAD` (exists).

### 6.3 Trajectory logging requirements

The session log already carries most of what the scorer needs. Additions to
`TranscriptEvent`:

```
{ type: 'gate',     ts, tier, name, command, tree, status: 'passed'|'failed'|'skipped', durationMs, step, byModel: boolean }
{ type: 'elision',  ts, stage, message: number, tokensRemoved }
{ type: 'steer',    ts, handler: 'M2'|'M3'|'M5', callId?, detail }
{ type: 'handoff',  ts, path, bytes, reason: 'session_end'|'reset'|'drop' }
```

And on `end`: `summary: { promptTokens, cachedTokens, cacheBreaks, gates: number, steers: number }`.

Every `request` already records `system` and `tools` when they change (`context` event,
commit `6f22d4d`). No prompt text is stored twice.

The scorer, `src/core/eval/score.ts`, is a pure function from `TranscriptEvent[]` plus
the check results to the metric record above. `jamcli sessions score <id>` prints it for
one session; the trial report prints the table. `/reflect` keeps reading `signalsOf`
alone.

### 6.4 Acceptance for a harness change

A change to a prompt part, a middleware constant, or a tool schema lands when, on the
dev split with 3 repeats, `success` does not fall (CI), `tokens_per_completed_task` does
not rise more than 10 percent, `cached_share` does not fall more than 5 points, and the
held-out split agrees in direction. A change that fixes a defect found in a trial lands
with a unit test that fails without it, as the repository's rule already says, and needs
no trial of its own.

## 7. Minimal viable implementation

### 7.1 File structure delta

```
src/core/verify/
  gates.ts          detectGates(projectRoot): Gate[]          manifests, AGENTS.md fence, durations
  run.ts            runGate(gate, ctx): GateResult            through the direct-call path; shaped output
  ledger.ts         Ledger.fromEvents(events); passed(tree, tier); stamp(todo)
  middleware.ts     registerVerifyMiddleware(bus, deps)       M4, M5, writeHandoff
src/core/context/
  inject.ts         startNotes(facts, budget=600): { promptLines, firstTurnNote }   M1
  elide.ts          elide(messages, keepFrom, opts): { messages, events }            E1..E5, M6
src/core/tools/
  registry.ts       RegisteredTool gains wireSchema?, tier?                          2.3
  readonly.ts       READ_ONLY_COMMANDS; isReadOnlyLine(parts)                       M2
src/core/runtime/
  index.ts          wire M1..M6, tiers, the model line, the per-turn notes           +60 lines
  tools.ts          offer wireSchema; tier selection; family gating                  +30 lines
src/core/transcript/
  events.ts         gate, elision, steer, handoff events; end.summary
src/core/reflection/
  signals.ts        new kinds and subtypes; signature()
src/core/eval/
  score.ts          score(events, checks): Metrics
  cluster.ts        cluster(signals): Cluster[]; rank()
scripts/harness-search/
  loop.ts           the loop of 5.4 over jamcli-trials; proposer is an import
  propose-llm.ts    one proposer: a jamcli headless run given clusters and the surface
.claude/skills/jamcli-trials/
  trial.ts          variants gain promptParts, middleware, tools; report gains the metrics table
scripts/
  measure-tools.ts  the tool-cost table from 2026-09-28, kept so the number is re-measured
```

No new dependency. No new configuration key. Three new tool fields (`wireSchema`,
`tier`, `verified` on a todo item).

### 7.2 Pseudocode

Gate detection:

```ts
export function detectGates(root: string): Gate[] {
  const gates: Gate[] = [];
  const pkg = readJsonIfExists(join(root, 'package.json'));
  if (pkg?.scripts) {
    const runner = existsSync(join(root, 'bun.lock')) ? 'bun run' : existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm run';
    for (const [name, tier] of [['typecheck', 'T1'], ['lint', 'T1'], ['test', 'T2'], ['build', 'T3']] as const)
      if (pkg.scripts[name]) gates.push({ name, tier, command: `${runner} ${name}` });
    if (!gates.some(g => g.name === 'typecheck') && existsSync(join(root, 'tsconfig.json'))) gates.push({ name: 'typecheck', tier: 'T1', command: 'npx tsc --noEmit' });
  }
  // pyproject, Cargo.toml, go.mod, Makefile: same shape, fixed commands
  const fence = gateFenceFrom(readIfExists(join(root, 'AGENTS.md')));   // lines under a heading matching /gate/i
  if (fence.length) return fence.map((command, i) => ({ name: `gate ${i + 1}`, tier: i === 0 ? 'T1' : 'T2', command }));
  return gates;
}
```

The ledger as a projection:

```ts
export class Ledger {
  private rows: GateEvent[] = [];
  static fromEvents(events: TranscriptEvent[]) { const l = new Ledger(); for (const e of events) if (e.type === 'gate') l.rows.push(e); return l; }
  record(e: GateEvent) { this.rows.push(e); }
  passed(tree: string, tier: Tier) { return this.rows.some(r => r.tree === tree && r.tier === tier && r.status === 'passed'); }
  lastDuration(name: string) { return this.rows.filter(r => r.name === name).at(-1)?.durationMs; }
  tail(): string[] { /* one line per gate: latest row */ }
}
```

Running a gate through the consented path:

```ts
export async function runGate(gate: Gate, deps: { direct: (cmd: string) => Promise<RunResult>; tree: string; step: number }): Promise<GateResult> {
  const started = Date.now();
  const result = await deps.direct(gate.command);                 // CoreAgent.direct: permission engine, sandbox, checkpoint, log
  const status = result.status === 'refused' ? 'skipped' : result.status === 'ok' ? 'passed' : 'failed';
  return { ...gate, tree: deps.tree, step: deps.step, status, durationMs: Date.now() - started, shaped: shape(gate, status, result.response) };
}

function shape(gate: Gate, status: string, output: string): string {
  const lines = output.split('\n');
  const errors = lines.filter(l => /error|fail|✗|FAIL|Error:/i.test(l)).slice(0, 20);
  return [`${gate.name} ${status} on tree ${short(tree)}`, ...errors, errors.length === 20 ? `... more` : '', ...lines.slice(-5)].join('\n').slice(0, 1500);
}
```

The two verification handlers:

```ts
export function registerVerifyMiddleware(bus: HookBus, d: { gates: Gate[]; ledger: Ledger; currentTree: () => string | undefined; changedThisTurn: () => boolean; todos: () => TodoItem[]; run: (g: Gate) => Promise<GateResult>; emit: (e: AgentEvent) => void }) {
  bus.on('post_tool', async ({ call, result }) => {
    const tree = d.currentTree(); if (!tree) return;                         // the step changed nothing
    const t1 = d.gates.find(g => g.tier === 'T1'); if (!t1 || d.ledger.passed(tree, 'T1')) return;
    if ((d.ledger.lastDuration(t1.name) ?? 0) > 60_000) return d.emit(gateEvent({ ...t1, tree, status: 'skipped' }));
    const r = await d.run(t1); d.ledger.record(r); d.emit(gateEvent(r));
    return r.status === 'failed' ? { context: [`[Gate ${r.name} failed on your last edits:\n${r.shaped}]`] } : undefined;
  }, 'M4');

  bus.on('stop', async ({ stopHookActive }) => {
    if (!d.changedThisTurn()) return;
    const tree = d.currentTree()!;
    const unverified = d.todos().find(t => t.status === 'completed' && t.verified?.tree !== tree);
    if (unverified) return deny(`item "${unverified.content}" is marked completed but its check has not passed on this tree`);
    for (const tier of ['T1', 'T2'] as const) {
      const g = d.gates.find(x => x.tier === tier); if (!g || d.ledger.passed(tree, tier)) continue;
      const r = await d.run(g); d.ledger.record(r); d.emit(gateEvent(r));
      if (r.status === 'failed') return d.denials(tree) < 2 ? deny(r.shaped) : warn(`The turn ended with ${g.name} failing.`);
    }
  }, 'M5');
}
```

Elision:

```ts
export function elide(messages: ChatMessage[], keepFrom: number, now: number): { messages: ChatMessage[]; events: ElisionEvent[] } {
  const out = [...messages]; const events: ElisionEvent[] = [];
  const touchedLater = pathsTouchedAfter(messages);                       // path -> first later step that read or wrote it
  const quoted = pathsQuotedByAssistant(messages);                        // the waste detector's mention test
  for (let i = 0; i < keepFrom; i++) {
    const m = out[i]; if (m.role !== 'tool' || isSummary(m)) continue;
    const call = callFor(messages, m.tool_call_id); const age = now - stepOf(messages, i);
    let stub: string | undefined; let stage: Stage | undefined;
    if (m.toolName === 'read_file' && touchedLater.has(pathOf(call)) && !quoted.has(pathOf(call))) [stage, stub] = ['E1', `[read ${pathOf(call)}; superseded by ${touchedLater.get(pathOf(call))}]`];
    else if (m.toolName === 'run_command' && age > 6) [stage, stub] = exitOf(m) === 0 ? ['E2', settledStub(call, m)] : ['E3', failedStub(call, m)];
    else if (duplicateOf(out, i) !== undefined) [stage, stub] = ['E4', `[same as the result of call ${duplicateOf(out, i)}]`];
    else if (m.content.length > 4_000 && age > 10) [stage, stub] = ['E5', headTail(m.content, 1_000, 500)];
    if (stub) { events.push({ stage, message: i, tokensRemoved: estimateText(m.content) - estimateText(stub) }); out[i] = { ...m, content: stub }; }
  }
  return { messages: out, events };
}
```

M2 and M3 in `dispatch.ts` terms: both are `pre_tool` handlers returning a `HookVerdict`.
M2 returns `{ decision: 'allow', reason: 'a read-only command' }`, which the existing
`decide()` accepts only where the mode alone would have asked. M3 returns `{ block:
'same call, same result; ...' }`, which `decide()` turns into a denial the model reads
with the earlier result's first line.

Runtime wiring, in `createRuntime` after the tool set and before the agent:

```ts
const gates = detectGates(workRoot);
const ledger = Ledger.fromEvents(log.events());
const notes = startNotes({ gates, model: `${choice.provider}:${choice.model}`, git: gitFacts(workRoot), handoff: readHandoffIfReset(workRoot, options) }, 600);
// buildPrompt gains notes.promptLines (S7, S9 model line); the first turn's prompt gains notes.firstTurnNote
registerVerifyMiddleware(hooks, { gates, ledger, currentTree: () => pending?.after, changedThisTurn, todos: () => readTodos({ projectRoot: workRoot }), run: g => runGate(g, { direct: cmd => agent.run(session, cmd, emit, { shell: true }), tree: pending!.after, step }), emit });
hooks.on('pre_tool', steerReads(READ_ONLY_COMMANDS, analyzer), 'M2');
hooks.on('pre_tool', dedupeCall(() => working.messages, () => pending?.after), 'M3');
hooks.on('pre_compact', () => ({ context: ['The todo list and gate results are pinned; do not restate them.'] }), 'M6');
```

`compactNow` calls `elide()` on `working.messages` before `compact()`, at the boundary
`chooseBoundary` would pick, and `turn()` calls it once when `countContext` first
crosses `0.6 × trigger`.

### 7.3 Order of work, each step passing the four gates

1. `events.ts` additions, `verify/gates.ts`, `verify/ledger.ts`, `verify/run.ts`, M4 and
   M5 in `verify/middleware.ts`, wired. Tests: detection over three fixture manifests;
   the ledger from a recorded log; a scripted-provider turn that edits, fails a fake
   `tsc`, is denied a stop twice, then allowed with the notice. One headless surface test
   drives the whole path.
2. `inject.ts` (M1), the model line, the per-turn model and mode notes, `wireSchema` and
   `tier` in the registry and tool set, the read-only list and M2, M3. Tests: the base
   request on an 8,192 window stays under 60 percent of the trigger with the core tier;
   `measure-tools.ts` re-run and its table pasted into the commit body.
3. `elide.ts` and M6; `compactNow` and the 60 percent crossing. Tests: each stage on a
   constructed conversation; `summary_fidelity` holds on a recorded log; no elision of a
   path still in the todo list.
4. `signals.ts` subtypes and `signature()`, `eval/score.ts`, `eval/cluster.ts`,
   `jamcli sessions score`, trial report table. Tests: scores over three recorded logs
   match hand-computed values.
5. Trial driver variants for `promptParts`, `middleware`, `tools`; `scripts/harness-search/loop.ts`;
   one proposer. First cycle run on the dev split; its folder cited in the commit that
   lands any accepted constant.

Steps 1 and 2 are the measured-lift levers and ship first. Steps 3 to 5 are the search
infrastructure and ship in order.

## 8. Open risks and the cheapest falsifying experiment

Ranked by expected damage if true.

| # | Risk | Falsifier | Cost |
|---|---|---|---|
| R1 | Backpressure does not lift success on the target model; a cheap model loops on a failing gate and spends the two denials without repairing. | 12 dev tasks × 3 repeats, baseline against step 1. Accept the claim only if `success` rises with CI lower bound above 0 and `repair_steps` median is under 4. If tokens per completed task rise more than 25 percent with no success gain, lower `maxDenials` to 1 and rerun; if still no gain, M5 becomes notice-only. | about 72 runs, under $1 |
| R2 | Gate detection picks a wrong or slow command in a polyglot repository, so gates cost more than they save or run something unintended. | Run `detectGates` over the 20 most recent repositories on the owner's machine and print the table. Any command that is not the repository's own declared script is a defect. The sandbox and the default-mode ask bound the damage meanwhile. | one script, minutes |
| R3 | Deterministic elision removes something the model needed, and re-reads cost more than the tokens saved. | A/B on the dev split with E on and off: `tokens_in` and `redundant_read` count. Elision stays only if `tokens_in` falls and `redundant_read` does not rise more than one per task. | 72 runs |
| R4 | Tiering and family gating break the cache more than they save, or the extended tier is needed early and `search_tools` adds a step. | Log `cache_breaks` and `cached_share` per run with tiers on and off on the same tasks; count `search_tools` calls. Keep tiering only if `tokens_in` per completed task falls on windows under 32k and does not rise on larger ones. | 72 runs on two windows |
| R5 | Even the core tier leaves an 8,192 window unusable, so C2 fails for small local models. | Measure the base request with the core tier and the shortest S1 to S9 on `qwen3:4b` through Ollama: it must leave at least 40 percent of the budget. If not, the core tier shrinks to `read_file`, `edit`, `run_command`, `todo_write` and the guidance to one line each. | one measurement |
| R6 | The search loop overfits the dev split. | Track dev and held-out RelLift per accepted cycle. Two consecutive cycles with dev up and held-out flat or down stop the loop and re-draw the split. | free, from the history |
| R7 | The read-only allow list is a way around consent through a command the analyzer misreads. | Fuzz 200 command lines built from the list plus redirects, `$(...)`, `xargs`, `-exec`, and aliases against `isReadOnlyLine`. Any allowed line that could write is a defect that removes the offending entry. | one test file |
| R8 | The handoff file drifts into memory: a session reads a stale handoff and acts on it, or it accretes across tasks. | It is regenerated from the log each time and has no append path; the test asserts byte equality with a fresh render. `handoff_pickup` on 6 resumed tasks with and without the file: if steps to the first edit do not fall, the file is dropped and the summary's pinned block carries the gate lines alone. | 36 runs |
| R9 | An equal-cost self-review pass is not inferior to a gate on this model. | Same 12 tasks: variant A runs one "review your changes" request at stop with no tool; variant B runs M5. Compare `success`, `false_done`, tokens. Section 4.6 stands only if B wins on success or ties with fewer tokens. | 72 runs |
| R10 | Trajectory scores disagree with the judge on what a good run is, and the wrong one drives acceptance. | Compute the rank correlation between `success` plus component scores and the judge over 50 runs. Below 0.4, the rubric is rewritten before any cycle uses the judge for anything. | free, from existing runs |

Two findings from writing this document, outside its scope, for the record:
`DEFAULT_HOOK_TIMEOUT_MS` is 30,000 in `src/core/hooks/commands.ts:52` while
`docs/hooks.md` says 5,000; and the `edit` wire schema at 311 estimated tokens is the
largest single tool cost, ahead of `grep` at 275 and `task` at 260 before its agent list.

## 9. Implementation status

Implemented on branch `tighten-interface-copy`, 2026-09-28, in the order of section 7.3.
Each item names where it lives; the tests beside each module are the proof.

- **Step 1, verification.** `src/core/verify/` (`gates.ts`, `ledger.ts`, `run.ts`,
  `middleware.ts`, `handoff.ts`). M4 and M5 registered in `createRuntime`; a gate runs
  as a `run_command` call through the permission engine and sandbox; the model's own run
  of a gate is recorded, not repeated; the language server's verdict is tier T0. Events
  `gate`, `steer`, `handoff`, `elision`, and `end.summary` in `transcript/events.ts`.
  `verified` on a todo item, set by `stampTodos`, kept across the model's rewrites.
  `.jamcli/handoff.md` on session end and on a drop; `/handoff` marks one for the next
  session, which reads it with its first prompt. Tests: `src/core/verify/__tests__/`,
  `src/core/runtime/__tests__/verify.test.ts`.
- **Step 2, context delivery and the action space.** Prompt lines T1 to T5, S7, and the
  model line in `runtime/prompt.ts`; model and mode notes as `turnNotes` in `agent.ts`.
  M2 and M3 in `runtime/steer.ts` over `tools/readonly.ts`. `wireSchema` and `tier` on
  `RegisteredTool`; core and extended tiers decided from the window in `createRuntime`,
  the extended tier and the task and delegate families held behind `search_tools`. The
  `edit` no-match error names the nearest lines; `run_command` names its first error
  line. Capped harness completions run with thinking off and retry once at double the
  cap (`providers/complete.ts`). `/cost` reports the cached share and prefix breaks.
  Measured by `scripts/measure-tools.ts`: 27 tools at 3,822 tokens before, 3,442 on the
  wire after; the core tier alone is 1,630. Tests: `tools/__tests__/readonly.test.ts`,
  `runtime/__tests__/steer.test.ts`, `__tests__/outputLimit.test.ts`.
- **Step 3, elision.** `context/elide.ts`, stages E1 to E5, run once at `ELIDE_AT` and
  inside every compaction; M6 adds the pinned note; the pinned block carries one line
  per gate. The log records each elision and `projectMessages` replays it. Tests:
  `context/__tests__/elide.test.ts`, `runtime/__tests__/elision.test.ts`.
- **Step 4, evaluation.** `reflection/signals.ts` gains subtypes and `signature()`;
  `eval/score.ts` and `eval/cluster.ts` with the routing table; `jamcli sessions score
  <id>`; the trial report gains success, tokens per completed task, cached share, prefix
  breaks, gates, and stops denied. Tests: `eval/__tests__/score.test.ts`.
- **Step 5, search.** `RuntimeOptions.harness` (guidance, read-only list, stop denials,
  after-edit bound, stop tiers, `elideAt`, per-tool description and wire schema), set
  only by the trial driver. `scripts/harness-search/loop.ts` runs the loop of 5.4 over
  `jamcli-trials` with paired bootstrap intervals and a held-out confirmation;
  `propose-llm.ts` is one proposer. Tests: `scripts/harness-search/__tests__/`.

Not done, by choice: the `edit` wire schema is 244 tokens against the 180 target,
because the anchor guidance it keeps is what closed F7. The `overflow_retry` context
subtype is not detected: the log does not distinguish that path from a planned
compaction. R1 to R10 in section 8 remain to be run; nothing here has been measured on
the target model yet.
