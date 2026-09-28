# Design

## Context

Plan mode is enforced in the harness: `MODE_DEFAULTS.plan` denies `write`, `execute`,
and `delegate`, the runtime drops those tools from the offered set, and a stray call is
refused with a result naming the mode (`src/core/permissions/engine.ts:203`). The
`state` class is allowed in every mode and today holds one tool, `todo_write`, persisted
under `.jamcli/`. The runtime already routes one kind of question to the person: an MCP
server's elicitation, emitted as `elicitation_request`, answered by the interface's
`answerElicitation`, declined with a notice on every other surface
(`src/core/runtime/index.ts:366`). An always-asked tool (`git_commit`) reaches the person
through `approval_request`, which every surface handles: the interface prompts, headless
denies with a hint, ACP calls `requestPermission`. A mode switch during a turn builds a
new agent for the next turn (`src/core/runtime/index.ts:909`). Compaction builds one
summary string, wraps it in `summaryMessage`, and the session log rebuilds the same
message from the `compaction` event's `summary`.

## Goals / Non-Goals

**Goals:**
- Every new behavior rides an existing seam: the `state` class, the elicitation event,
  the always-asked approval, the mode switch, the summary string.
- The prompt describes only what the harness does. Nothing in `PLAN_NOTE` names a tool
  or a rule that does not exist.
- Each surface behaves honestly: where no one can answer, the model is told so.

**Non-Goals:**
- Task dependencies (`blocked_by`) and parallel scheduling. The runtime works one task
  at a time; claude-world S07 notes parallel execution needs separate subagents anyway.
- Per-session plan files. The todo list is per project with an optional session key;
  the plan matches it. One plan per project is what a person can find and edit.
- Switching tools mid-turn after the exit is approved. The runtime's own rule is that a
  switch takes effect next turn; the exit's result tells the model so.
- A new interface widget for `ask_user`. The elicitation form already renders choices
  and free text.

## Decisions

1. **The plan is a file at `.jamcli/plan.md`, written by `plan_write` (state, offered in
   plan mode only) and read back with `read_file`.** A read tool of its own would cost
   every request tokens for what `read_file` already does. Alternative: a `state`-classed path exception for
   `write_file`. Rejected: the exception would have to be taught to the permission
   engine and the preview builder, and the model would have to know the path. Two small
   tools mirror `todo_write`/`todo_read`, which already exist and are documented.

2. **`exit_plan_mode` is a `state`-classed tool with `alwaysAsks: true`, taking no
   arguments, offered in plan mode only.** A `modes` field on a registered tool keeps a
   tool out of the modes where it means nothing, so it costs no context there: the fixed
   cost of a request was 4,361 tokens against a 4,526 trigger under the default window. The engine turns always-asked into `ask` after the mode check, so it is
   offered in plan mode and prompts every time. `previewCall` gains a case that reads the
   plan file, so the person sees the plan where they see a diff for an edit. The runner
   calls `ctx.exitPlanMode()`, which the runtime supplies; the result names the mode the
   next turn will hold. Alternative: an `execute`-classed tool. Rejected: `execute` is
   denied outright in plan mode and the tool would never be offered.

3. **The runtime remembers the mode held before plan mode.** `setPermissionMode` records
   `from` whenever `to` is `plan`; the exit switches to that or `default`. Alternative:
   always `default`. Rejected: a person working in `accept-edits` who dipped into plan
   mode would be asked for every edit afterwards.

4. **`ask_user` is a `state`-classed tool that calls `ctx.elicit`, the same function the
   MCP client uses.** Choices become one required enum field; no choices becomes one
   required string field. `server` is set to `JamCLI` so the interface's existing titles
   read "JamCLI asks: ...". Decline and cancel return a non-error result telling the
   model to state its assumption; the runtime's notice already explains why on surfaces
   that cannot ask. Alternative: a new event type. Rejected: three surfaces would need
   new handling for a form the interface already renders.

5. **A todo item gains `check?: string`.** Persisted, normalized, shown in the tool's
   output as `check: ...` under the item, and in the interface panel. Completion is not
   enforced by the tool: the model is told in the description that completed means the
   check passed. Enforcement would need the tool to run the check, which is the model's
   job through `run_command`.

6. **Compaction pins through the summary string.** `CompactInput` gains `pinned?:
   string`; `compact` appends it to the summary under a heading before building the
   message. The agent gets `pinned?: () => Promise<string | undefined>` from the runtime,
   which formats the todo list and the plan file's path and size. Because the text is
   inside `summary`, the `compaction` event and the log rebuild carry it unchanged.
   Position: the end of the summary, per Liu et al. Alternative: re-inject into the
   system prompt. Rejected: the system prompt is rebuilt only on reassemble, and a stale
   list in the prompt would contradict the file.

7. **Tool guidance names `ask_user` and `todo_write` only when offered**, through the
   existing `has()` check in `toolGuidance`. `PLAN_NOTE` names the plan tools without a
   check, because they are built in and offered in plan mode unless a rule denies them.

8. **ACP sees the plan.** `AcpServer.ask` puts a text preview into `rawInput.preview`,
   so an editor's permission dialog can show the plan. Headless gets the existing denial
   with the `--allow-tool` hint, which is right: no one is there to approve a plan.

## Risks / Trade-offs

- [The person edits `plan.md` while a turn runs] → `plan_read` and the exit's preview
  read the file at call time; the model's earlier copy may differ. The result of
  `plan_write` names the path so the person knows where to look.
- [`ask_user` used for every small decision] → the guidance says to ask only for what is
  the person's to decide and to state assumptions otherwise (S22's ladder).
- [The pinned list grows large] → clipped to a fixed character budget, oldest completed
  items dropped first, with a count of what was cut.
- [A rule denies `plan_write`] → `PLAN_NOTE` names it anyway; the refusal names the rule,
  as every refusal does. Acceptable: a person who denies the plan tool has chosen so.
- [ACP editors show `rawInput` as JSON] → the plan is readable but unformatted. The
  preview kind is still `text` for surfaces that render it.
