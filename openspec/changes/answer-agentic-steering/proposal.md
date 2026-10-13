# Proposal

## Why

The branch `feat/agentic-beta` carries a commit, `fe89b99`, that adds steering, corrective
nudges, and stall guards. It was written outside an OpenSpec change: there is no entry under
`openspec/changes/` for it, `SEQUENCE.md` still names `add-approval-solvers` as the open unit,
and none of the three commands it adds appear in `docs/commands-and-skills.md` or on the site.
A review of that commit found nine problems, four of which make it unsafe to merge as it
stands, so this unit is the work of making the commit correct and of giving it the spec it needs.

The most consequential line in the commit is not one of the guards. It is
`src/core/rules/index.ts`, where `SOUL.md` and `.jamcli/soul.md` were added to the front of
`DEFAULT_RULE_FILES`. Rules are threaded into the system prompt, so that edit silently makes a
file named `SOUL.md`, in any repository, instructions to the agent, ahead of `AGENTS.md`, with
no opt-in, no notice, and no relation to the commit's stated subject. It is one line and it
changes every project. This unit drops it.

The guards have the opposite problem. `DEFAULT_AGENT_LOOP_CONFIG` now sets `stall_guards` and
`tool_loop_guardrails` to `true`, so both are on in every project that does not set them. Both
can fire on a reply that is the answer. `hasDroppedToolCall` matches the text
`Action: run_command` and a fenced `{"name": "run_command"}` block, both of which a model
writes while explaining a tool call to the person; `narratesIntentWithoutAction` matches any
reply ending in "I'll ..." or "Let me ..." even mid-sentence. When either fires on a final
answer, the harness discards that answer, spends one of two nudges, and tells the model to
keep going. A guard that eats the answer is worse than no guard, so the default is off and the
person opts in with `/agentic on`.

Two smaller findings. `steer.ts` imports `reopen` from `./index.js`, the registry that imports
it, and it is the only builtin that does so. And the nudge is recorded as a `user` message
whose text opens with a literal `[System: ...]`, which is both a new shape in the transcript
and a prompt-injection surface: a model that emits that string itself makes its own words
indistinguishable from the harness's.

`docs/harness-spec.md` cites `runtime/steer.ts` and `__tests__/steer.test.ts`, and a first pass
took those for stale references to files the commit did not create. They are not stale: both
exist, and `runtime/steer.ts` is the pre_tool steering handler that answers M2 and M3 over
`tools/readonly.ts`, which is what the spec says it is. Only `docs/commands-and-skills.md` was
silent about the new commands, and that is where this unit adds them.

## What Changes

- **The guards are opt-in.** `stall_guards`, `tool_loop_guardrails`,
  `intent_ack_continuation`, `tool_use_enforcement`, and `execution_guidance` all default to
  `off`, and `/agentic on` turns them on. A reply the person would have read is a reply they
  get.
- **The nudges are harness notes, not user messages.** They are recorded at their place in the
  turn, in the bracket form the transcript already uses, and the model cannot forge one by
  writing the same text.
- **`SOUL.md` is not a rule file.** `DEFAULT_RULE_FILES` is the three files it was.
- **A command never imports the registry.** `reopen` moves to where a leaf command can reach
  it without a cycle.
- **`/agentic on` writes to the person's own configuration,** not the project's, and says
  which of the five settings it could not write instead of claiming the stack is enabled.
- **The three commands are documented,** in `docs/commands-and-skills.md`, with what each one
  does, what the guards do and do not touch, and that the settings are off by default.
- **`jamcli auth` reads a provider alone as `set`** (`be2cb25`), and a bare `set`, `get`,
  `remove`, or `login` names the providers to choose from instead of printing the whole usage.
  The owner moved this fix into the unit on 2026-10-12.
- **`/setup` gives the advice that fits** (`3b052a2`): with a hosted key set and Ollama not
  answering, it says to start Ollama for local models rather than asking for a key, and it says
  where the choice is saved only when there is a choice. The owner moved this fix into the unit
  on 2026-10-12.

## Not in this unit

- **Deciding the guards belong.** This unit makes them safe and reachable; it does not argue
  they help. Whether an intent nudge makes a model act more, or more often produce a second
  unverified answer, is what `/agentic` status and the task corpus would answer.
- **`/steer` mid-turn.** It queues to `turnNotes`, which is drained at the start of a turn, so
  an instruction typed during a turn waits for the next one. The message queue `SEQUENCE.md`
  records for `label-and-batch-child-approvals` already reaches a running turn; `/steer` does
  not, and a person reading "nudge the model during or across turns" would expect it to.
- **`/agentic`'s permission-mode tip.** It advises `/mode auto`, which changes what runs
  without asking. That advice belongs to the owner or to `/mode`, not to a toggle command.

## Capabilities

### New Capabilities

None. JamCLI keeps one capability.

### Modified Capabilities

- `jamcli`: adds the Model Steering requirement, and modifies Credential Storage and First-Run
  Onboarding.

## Impact

- Spec: Model Steering is added, as a requirement with scenarios for each guard's firing and
  not firing. Credential Storage gains the `jamcli auth <provider>` and bare-action scenarios,
  and First-Run Onboarding the hosted-key and nothing-to-choose scenarios.
- Code: `src/core/agent.ts` (the three guards, their defaults, and the note they record),
  `src/core/rules/index.ts` (`SOUL.md` removed), `src/commands/builtin/steer.ts` (scope, the
  partial-failure report, and the cycle), `src/core/runtime/index.ts` (the complete loop it
  passes), and `docs/config.schema.json`, regenerated with `bun run config-schema`. The `auth`
  fix is in `src/cli.ts` and `src/cli/auth.ts`, and the `setup` fix in
  `src/commands/builtin/setup.ts`.
- Docs: `docs/commands-and-skills.md`.
- No dependency. Five keys inside `agent_loop`, a block that exists.