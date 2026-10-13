# Tasks

Baseline: `npx tsc --noEmit` reports 0 errors on `fe89b99`, the commit under review.

## 0. Handover checkpoint (2026-10-12): do these first

This checkpoint was committed with the test gate failing, by the owner's choice, so the work
could be handed over. Install, typecheck (0 errors) and build pass. The ticks below name the
test that proves each one; each of those tests was run against `fe89b99` and fails there.

- [x] 0.1 `bun test` fails one test: `src/__tests__/entry.test.ts:75`, "in a terminal,
  --screen-reader draws plain labeled lines with no boxes or bars, and Ctrl+C twice exits",
  expected exit code 0, received "still running". It fails the same way on `master` and on
  `fe89b99`, and unit 30 in `SEQUENCE.md` records it as older than that unit. Fix it with a
  test that fails without the fix.
  Proof: the cause was in the test. With no user configuration the interface boots a first run
  and opens the setup picker, and since `d8e891b` the first Ctrl+C closes an open picker, so two
  presses only armed leaving. The test now starts with a user `config.json`; it fails on
  `76042c1` and passes on this checkpoint.

- [x] 0.2 The full suite took 159.6 s on the owner's machine at a load average of 2.8, over the
  150 s budget in `project.md`; unit 30 closed at 149.4 s. Measure it on an idle machine and
  bring it back under the budget. `src/tui/app/__tests__/board.test.tsx`, "a label too long for
  the row is cut before its facts are", timed out once under full-suite load and passed three
  times alone.
  Proof: on `76042c1`, 157.86 s at a load average of 3.40 to 5.30 and 154.32 s at 4.62 to 5.53,
  the board test timing out in both; after, 144.13 s at 3.11 to 4.57 with nothing failing. The
  framed half of the screen-reader test never matched its boot pattern and waited 10 s every
  run; it now reads the status line across its drawn segments. The board test timed out when a
  reply left from its 60-column pass answered the 100-column prompt; it now waits for both
  replies to be taken before it stops the child. No test was removed.

- [x] 0.3 The owner asked on 2026-10-12 that the `auth` and `setup` changes join this unit, and
  they are committed on this branch as their own commits. Bring "Not in this unit" in
  `proposal.md`, task 6.5, and the spec delta into line with that.
  Proof: `proposal.md` names both fixes in "What Changes", "Capabilities", and "Impact", and no
  longer lists them in "Not in this unit"; task 6.5 is rewritten; the spec delta modifies
  Credential Storage and First-Run Onboarding, each with a scenario for what its commit changed.

- [x] 0.4 Two defects in the work so far. `src/core/agent.ts`: `if (!tools) return finish(...)`
  sits before the stop hook, so a turn with no tools offered never runs a stop hook; task 2.3
  asks only that the guards skip it. And the intent regex now reads `now (?:i'll| i will|let's)`,
  with a space that `fe89b99` did not have, so that branch needs two spaces after "now". The
  zero-width space task 2.2 names is not in `fe89b99` or in the fixture.
  Proof: `agentHarness.test.ts`, "an agent with no tool definitions and a stop hook that asks to
  continue runs the hook", fails on `76042c1`, where the hook never runs, and passes here. The
  stray space is removed with no test, since none can fail on it: the earlier
  `i(?:'ll| will| am going to)` alternative already matches every reply that branch could, and
  six phrasings return `true` before and after. A search for U+200B finds none in `fe89b99`'s
  `agent.ts` or `corrective.test.ts`, or in this checkpoint's.

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

- [x] 2.1 In `src/types/config.ts`, set `tool_use_enforcement`, `execution_guidance`, and
  `intent_ack_continuation` to `'off'` in `DEFAULT_AGENT_LOOP_CONFIG`, and delete
  `stall_guards` and `tool_loop_guardrails` from it. Verify with a test that fails without this:
  an agent built with no loop config nudges on nothing and stops on no loop, so a three-step
  reply that ends in "I'll now run the tests." returns exactly that text as `ok`.
  Proof: the two keys are deleted, and the agent reads them as off when nothing sets them.
  `corrective.test.ts`, "an agent with no steering config never nudges and never stops on a
  loop", replaces the one-step version: it repeats one call four times, then returns the final
  reply whole as `ok`, with no note and no repeated-call warning. It fails with the agent's
  fallback for the guards back at `true` (the loop guard stops the turn, and the stall guard
  alone adds its warning), with `fe89b99`'s defaults and readers put back, and with only the
  intent default on. "no steering setting is on until the person sets one" checks the two keys
  are absent, and fails with `fe89b99`'s defaults. Both pass here.

- [x] 2.2 Narrow `hasDroppedToolCall` and `narratesIntentWithoutAction` so a reply that
  explains a tool call, or ends in "I'll ..." while delivering the answer, matches neither.
  Remove the zero-width space from the regex in `src/core/agent.ts:120` and from the fixture at
  `src/core/__tests__/corrective.test.ts:23`, which currently makes that test pass against
  itself. Verify with tests that fail without it, each over a reply that is a real answer:
  a fenced `{"name": "read_file"}` block inside an explanation, the line `Action: run_command`,
  and a reply ending in "I'll explain why in a moment.".
  Proof: the narrowing and the fenced-block and "I'll explain why" tests came with `f90a3e1`.
  `corrective.test.ts`, "an answer with Action: run_command on a line of its own is returned
  whole", fails with `fe89b99`'s `hasDroppedToolCall` put back and passes here. There is no
  zero-width space to remove: none is in `fe89b99`'s `agent.ts` or in the fixture, as slice 01
  found (task 0.4).

- [x] 2.3 Have both guards skip a reply that has no tool definitions offered, since a turn with
  no tools has nothing to continue into.
  Proof: `corrective.test.ts`, "with no tools offered, neither guard nudges a reply that would
  trip it", fails on its dropped-call reply with both guards' `tools &&` removed, fails on its
  narration reply with only the intent guard's removed, and passes here.

## 3. The record

- [x] 3.1 Replace the `userMessage('[System: ...]')` nudges in `src/core/agent.ts` with the
  harness's own note form, recorded at its place in the turn. Verify with a test that fails
  without it: a nudge is a note, not a message whose role is `user`, and a model reply containing
  the note's own text is not itself recorded as a note.
  Proof: the two nudges and the loop-stop note are recorded as `role: 'system'` harness notes, and
  the agent sends a recorded note to the provider as a `user` message at its place.
  `claude.test.ts`, "a steering nudge is recorded as the harness, and reaches the next request in
  the conversation, not the system prompt", fails with the change set aside, where Anthropic's
  `system` ends with the nudge, and passes here. "stall_guards breaks identical call replay loops
  and terminates runaway loops" now checks the stop note is `system`, and fails the same way.
  "a model reply that quotes a harness note is not itself a note" passes both ways and cannot
  fail on this change: nothing decides a note from its text.

- [x] 3.2 Return the model's last text from the identical-loop guard, not the harness's sentence
  about the loop, and carry the explanation as a notice and in the turn's reason. Verify with a
  test that fails without it: the turn's `response` is the model's step-4 text and the status is
  `limit`.
  Proof: `corrective.test.ts`, "stall_guards breaks identical call replay loops and terminates
  runaway loops": `response` is `step 4`, status `limit`, the reason in `error`.

## 4. The code

- [x] 4.1 Restore `loop?: AgentLoopConfig` on `AgentOptions` in `src/core/agent.ts`, and pass a
  complete loop from `src/core/runtime/index.ts` by merging over
  `DEFAULT_AGENT_LOOP_CONFIG`. Verify with a test that fails without it: a partial loop is
  rejected by the type, and the runtime's agent still reads every key it did before.
  Proof: `agent.test.ts`, "an agent reads the complete loop it is given, and a partial loop is
  refused by the type", holds a `@ts-expect-error` on a partial loop; with `loop` widened to
  `Partial<AgentLoopConfig>`, `npx tsc --noEmit` fails on that line (TS2578). `config.test.ts`,
  "an agent_loop that sets one key leaves every other key at its default", fails without the
  merge, where a qwen session gets the tool-use enforcement and execution guidance prompts, and
  passes here.

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

- [x] 5.2 Check the return code of each of the five writes and name the ones that failed,
  instead of reporting the stack enabled on the first one's code alone. Verify with a test that
  fails without it: a store that refuses one key leaves the others written and the notice
  naming the key that was not.
  Proof: `steerCommands.test.ts`, "/agentic names the one setting the store refused, and saves
  the other four", refuses `agent_loop.execution_guidance` and lets the other writes reach the
  real store. It fails with the check undone to judge by the first write's code alone, and
  passes here. "/agentic names a setting it could not save and keeps the rest" stays: it is the
  only test of a refusal from the real store, with all five named.

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

- [x] 6.4 Drive the built JamCLI through `jamcli mcp serve`'s `terminal_*` in a fixture project
  with its own `JAMCLI_STATE_DIR` and a copied `JAMCLI_CONFIG_DIR`: `/agentic` lists the stack,
  `/steer` and `/goal` are accepted, a turn on a model that narrates its intent reaches the
  person intact with the guards off. Keep the recording as the evidence.
  Proof: dev-qa drove the built `dist/` twice through `jamcli mcp serve`'s `terminal_*`, in a
  fixture project outside the clone with its own state directory and a fresh user configuration
  (never a copy of the owner's). The model was the repository's test double,
  `src/testing/fakeProvider.ts`, started from a launcher outside the clone. The first drive, on
  `8590127` (recording `proof/6.4-drive-t1.cast`), found that a reopen dropped the goal and that
  turn notes read as the person's words. The second, on `16089c6` after those fixes (recording
  `proof/6.4-drive2-t1.cast`, with `6.4-drive2-session.jsonl`, `6.4-drive2-model-requests.log`
  and `6.4-drive2-export.md`), saw all three behaviours, the goal and a queued `/steer` kept
  across `/agentic on`, and each note kept apart from the person's words.

- [x] 6.5 `SEQUENCE.md`'s "Open unit" names this one, and says that the `auth` fix (`be2cb25`,
  `src/cli.ts` and `src/cli/auth.ts`) and the `setup` fix (`3b052a2`,
  `src/commands/builtin/setup.ts`) are in it.
  Proof: "Open unit" names `answer-agentic-steering` with both fixes, and `add-approval-solvers`
  as the owner's next unit; `openspec/changes/add-approval-solvers/` is unchanged.

- [x] 6.6 Keep the install hint and the reason in `/setup`'s note when Ollama is not answering,
  with a hosted key set and without one, which `3b052a2` dropped (the owner, 2026-10-13), and
  still ask for no key when one is set.
  Proof: `setup.test.tsx`, "with Ollama down and no keys, the note gives the install hint and
  the reason, and no saved-choice line" and "with Ollama down and a hosted key set, the note
  gives the install hint and the reason, and asks for no key", fail on `3b052a2`'s note code and
  pass here.