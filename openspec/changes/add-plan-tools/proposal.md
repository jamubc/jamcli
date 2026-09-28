# Proposal

## Why

Plan mode today masks the tools that change things and tells the model why, and that is
all. The plan lives only in the model's reply, so it is gone when the person switches
mode and gone again when the context is summarized. The model cannot hand a plan over for
approval, cannot put a question to the person except by ending its turn, and the todo
list it keeps has no way to say what "done" means for an item. The owner asked on
2026-09-27 for the four artifacts other harnesses have proved: a plan file, an exit from
plan mode that the person approves, a question tool, and task tracking that survives a
long session.

## What Changes

- **Plan file.** `plan_write` and `plan_read` keep one markdown plan per project under
  `.jamcli/plan.md`. `plan_write` is `state`-classed, so it is the one write plan mode
  allows, and the person can edit the file by hand.
- **Exit plan mode.** `exit_plan_mode` asks the person every time, showing the plan as
  its preview. Approval switches the session to the mode it was in before plan mode, or
  `default`, from the next turn. A denial with feedback returns the feedback to the model.
- **Ask the person.** `ask_user` puts one question, with optional choices, to the person
  through the elicitation path the interface already answers for MCP servers. Where no
  one can answer, the tool says so and the model states its assumption.
- **Todo acceptance checks.** A todo item may carry a `check`: the test, command, or
  observation that proves it done. The tool's description says an item is completed only
  after its check passed.
- **Compaction keeps the plan.** A summary ends with the current todo list and the plan
  file's path and size, so neither is lost to the middle of a long session.
- **Prompt guidance.** `PLAN_NOTE` names the plan tools and the exit, and the tool
  guidance names `ask_user` and the todo list when they are offered, on every surface.

## Capabilities

### New Capabilities

None. The spec keeps one capability, `jamcli`; the new requirements are added to it.

### Modified Capabilities

- `jamcli`: Permission Modes gains the plan file write and the approved exit; Context
  Management gains the pinned todo list and plan; Plan Artifacts, Ask the Person, and
  Todo Acceptance Checks are added.

## Impact

- `src/core/tools/plan.ts` (new), `src/core/tools/todo.ts`, `src/core/tools/builtins.ts`,
  `src/types/tools.ts` (tool context gains `elicit` and `exitPlanMode`).
- `src/core/runtime/index.ts` (mode memory, context wiring, pinned text for compaction),
  `src/core/runtime/prompt.ts`, `src/core/permissions/modes.ts`.
- `src/core/context/compact.ts` and `src/core/agent.ts` (a summary carries pinned text).
- `src/core/approval.ts` (the exit's preview), `src/acp/server.ts` (the preview reaches
  the editor), `src/tui/state/view.ts` (todo check shown).
- `docs/tools.md`, `site/src/generated/reference.json`, `docs/CHANGELOG.md`.
- No new dependency. Local-first unchanged: every tool here touches only `.jamcli/`.

## Sources

- Ronacher, "What is plan mode", 2025-12-17: plan mode is a tool mask, an injected
  prompt, and a plan artifact the person can edit.
- Columbia DAPLab, "9 critical failure patterns of coding agents", 2026-01-08: agents
  hide failures to look done; a plan item needs its own check.
- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet", ICLR 2024,
  arXiv:2310.01798: correction needs external feedback, so a check is a test or a command,
  not the model's opinion.
- Mu et al., "ClarifyGPT", arXiv:2310.10996: asking a targeted clarifying question when
  a requirement is ambiguous raises pass rates; the question needs a channel.
- Yang et al., "SWE-agent", NeurIPS 2024, arXiv:2405.15793: actions simple and compact,
  feedback informative but concise, guardrails in the interface rather than the prompt.
- Liu et al., "Lost in the Middle", TACL 2024, arXiv:2307.03172: what must be found goes
  at the start or the end of the context, never the middle; the pinned list ends the
  summary.
- claude-world.com tutorials S03, S06, S07, S22: an item completes only after its
  acceptance condition is checked; the task list survives compaction; escalation is
  resolve, inform, ask, or stop, by consequence.
