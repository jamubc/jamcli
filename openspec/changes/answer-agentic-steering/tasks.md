# Tasks

Baseline: `npx tsc --noEmit` reports 0 errors on `fe89b99`, the commit under review.

## 0. Handover checkpoint (2026-10-12): do these first

This checkpoint was committed with the test gate failing, by the owner's choice, so the work
could be handed over. Install, typecheck (0 errors) and build pass. The ticks below name the
test that proves each one; each of those tests was run against `fe89b99` and fails there.

- [ ] 0.1 `bun test` fails one test: `src/__tests__/entry.test.ts:75`, "in a terminal,
  --screen-reader draws plain labeled lines with no boxes or bars, and Ctrl+C twice exits",
  expected exit code 0, received "still running". It fails the same way on `master` and on
  `fe89b99`, and unit 30 in `SEQUENCE.md` records it as older than that unit. Fix it with a
  test that fails without the fix.

- [ ] 0.2 The full suite took 159.6 s on the owner's machine at a load average of 2.8, over the
  150 s budget in `project.md`; unit 30 closed at 149.4 s. Measure it on an idle machine and
  bring it back under the budget. `src/tui/app/__tests__/board.test.tsx`, "a label too long for
  the row is cut before its facts are", timed out once under full-suite load and passed three
  times alone.

- [ ] 0.3 The owner asked on 2026-10-12 that the `auth` and `setup` changes join this unit, and
  they are committed on this branch as their own commits. Bring "Not in this unit" in
  `proposal.md`, task 6.5, and the spec delta into line with that.

- [ ] 0.4 Two defects in the work so far. `src/core/agent.ts`: `if (!tools) return finish(...)`
  sits before the stop hook, so a turn with no tools offered never runs a stop hook; task 2.3
  asks only that the guards skip it. And the intent regex now reads `now (?:i'll| i will|let's)`,
  with a space that `fe89b99` did not have, so that branch needs two spaces after "now". The
  zero-width space task 2.2 names is not in `fe89b99` or in the fixture.

## 1. Take back what the commit should not have changed

- [x] 1.1 Remove `SOUL.md` and `.jamcli/soul.md` from `DEFAULT_RULE_FILES` in
  `src/core/rules/index.ts`, restoring `['AGENTS.md', 'CLAUDE.md', '.jamcli/rules.md']`.
  Verify with a test that fails without it: `DEFAULT_RULE_FILES` has three entries in that order,
  and a fixture project holding a `SOUL.md` gets no instructions from it.
  Proof: `steering.test.ts`, "only AGENTS.md, CLAUDE.md, and .jamcli/rules.md are rule files" and
  "a SOUL.md in the project is not an instruction to the agent".

- [x] 1.2 Drop the two tests in `src/core/runtime/__tests__/steering.test.ts` that cover
  `SOUL.md`, and check the other four in that file still hold on their own.
  Proof: the two `SOUL.md` tests are gone, replaced by the two that prove 1.1; the other four pass.

## 2. Make the guards opt-in and unable to eat an answer

- [ ] 2.1 In `src/types/config.ts`, set `tool_use_enforcement`, `execution_guidance`, and
  `intent_ack_continuation` to `'off'` in `DEFAULT_AGENT_LOOP_CONFIG`, and delete
  `stall_guards` and `tool_loop_guardrails` from it. Verify with a test that fails without this:
  an agent built with no loop config nudges on nothing and stops on no loop, so a three-step
  reply that ends in "I'll now run the tests." returns exactly that text as `ok`.
  Left: the three are `off`, but `stall_guards` and `tool_loop_guardrails` are set to `false`, not
  deleted, and "an agent with no steering config never nudges" covers one step, not three.

- [ ] 2.2 Narrow `hasDroppedToolCall` and `narratesIntentWithoutAction` so a reply that
  explains a tool call, or ends in "I'll ..." while delivering the answer, matches neither.
  Remove the zero-width space from the regex in `src/core/agent.ts:120` and from the fixture at
  `src/core/__tests__/corrective.test.ts:23`, which currently makes that test pass against
  itself. Verify with tests that fail without it, each over a reply that is a real answer:
  a fenced `{"name": "read_file"}` block inside an explanation, the line `Action: run_command`,
  and a reply ending in "I'll explain why in a moment.".
  Left: the narrowing and the fenced-block and "I'll explain why" tests are in. No test puts
  `Action: run_command` on a line of its own inside an answer, and see 0.4.

- [ ] 2.3 Have both guards skip a reply that has no tool definitions offered, since a turn with
  no tools has nothing to continue into.
  Left: see 0.4; no test covers it.

## 3. The record

- [ ] 3.1 Replace the `userMessage('[System: ...]')` nudges in `src/core/agent.ts` with the
  harness's own note form, drained with `turnNotes`. Verify with a test that fails without it:
  a nudge is a note, not a message whose role is `user`, and a model reply containing the note's
  own text is not itself drained as a note.
  Left: the nudges are `role: 'system'` messages, not notes drained with `turnNotes`, and
  `anthropic.ts` lifts every system message into the system prompt. The loop-stop note is still
  a `userMessage`.

- [x] 3.2 Return the model's last text from the identical-loop guard, not the harness's sentence
  about the loop, and carry the explanation as a notice and in the turn's reason. Verify with a
  test that fails without it: the turn's `response` is the model's step-4 text and the status is
  `limit`.
  Proof: `corrective.test.ts`, "stall_guards breaks identical call replay loops and terminates
  runaway loops": `response` is `step 4`, status `limit`, the reason in `error`.

## 4. The code

- [ ] 4.1 Restore `loop?: AgentLoopConfig` on `AgentOptions` in `src/core/agent.ts`, and pass a
  complete loop from `src/core/runtime/index.ts` by merging over
  `DEFAULT_AGENT_LOOP_CONFIG`. Verify with a test that fails without it: a partial loop is
  rejected by the type, and the runtime's agent still reads every key it did before.
  Left: the type and the merge are in; no test proves a partial loop is rejected.

- [x] 4.2 Move `reopen` out of `src/commands/builtin/index.ts` into a module both can import,
  so `steer.ts` no longer imports the registry that imports it. Verify with
  `grep -rn "from './index.js'" src/commands/builtin/` returning nothing, and the builtin's tests
  still passing.
  Proof: the grep returns nothing; `src/commands/builtin/reopen.ts` holds `reopen` and
  `thisSession`, and `steerCommands.test.ts` passes.

## 5. `/agentic`

- [x] 5.1 Write every setting at user scope in `/agentic on` and `/agentic off`, as `setup.ts`
  does for its model. Verify with a command-host test that no file appears in the fixture's
  `.jamcli/` and that the value is in the copied configuration directory.
  Proof: `steerCommands.test.ts`, "/agentic on saves into the user configuration and writes
  nothing to the project".

- [ ] 5.2 Check the return code of each of the five writes and name the ones that failed,
  instead of reporting the stack enabled on the first one's code alone. Verify with a test that
  fails without it: a store that refuses one key leaves the others written and the notice
  naming the key that was not.
  Left: each code is checked and failures named, but "/agentic names a setting it could not save"
  makes every write fail; no test refuses one key and checks the others were written.

- [x] 5.3 Drop the `/mode auto` tip from `/agentic on`. Verify with a test that fails without
  it: running `/agentic on` in default mode says nothing about permission modes.
  Proof: `steerCommands.test.ts`, "/agentic says nothing about permission modes, and rejects an
  unknown argument".

## 6. Docs and gates

- [x] 6.1 `docs/commands-and-skills.md` lists `/steer`, `/goal`, and `/agentic` with what each
  does, what the guards do and do not touch, and that the settings are off by default.
  `docs/harness-spec.md` is left alone: a first pass took its `runtime/steer.ts` and
  `__tests__/steer.test.ts` references for stale ones, and both files exist and are what the
  spec says they are.
  Proof: the Steering line and two paragraphs in `docs/commands-and-skills.md`.

- [x] 6.2 `docs/config.schema.json` regenerated with `bun run config-schema` after the defaults
  change.
  Proof: `bun run config-schema` on this checkpoint leaves `docs/config.schema.json` unchanged;
  the schema carries no defaults.

- [ ] 6.3 The four gates: `bun install`, `npx tsc --noEmit` at 0, `bun test` passing and under
  its time budget, `bun run build`, and `openspec validate answer-agentic-steering --strict`.

- [ ] 6.4 Drive the built JamCLI through `jamcli mcp serve`'s `terminal_*` in a fixture project
  with its own `JAMCLI_STATE_DIR` and a copied `JAMCLI_CONFIG_DIR`: `/agentic` lists the stack,
  `/steer` and `/goal` are accepted, a turn on a model that narrates its intent reaches the
  person intact with the guards off. Keep the recording as the evidence.

- [ ] 6.5 `SEQUENCE.md`'s "Open unit" names this one, and the two uncommitted working-tree
  changes (`src/cli.ts`, `src/cli/auth.ts`, `src/commands/builtin/setup.ts`, and its test) are
  named in "Not in this unit" here and left alone.