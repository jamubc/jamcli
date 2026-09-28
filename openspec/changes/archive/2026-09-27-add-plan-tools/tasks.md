# Tasks

## 1. Todo acceptance checks

- [x] 1.1 Add `check` to `TodoItem`, normalize it, persist it, show it in `formatTodos`
  and the tool description; extend `todo.test.ts` so a written check is read back and
  appears in the output.
- [x] 1.2 Show the check under the item in the interface's todo panel and `TodoView`;
  test in `view.test.ts` that a `todo_write` result with checks reaches state.
- [x] 1.3 Render the panel as a checklist above the composer, show it on its own when a
  list first arrives, and show the plan's path from a `plan_write` result; test the
  reducer keeps the plan and the panel renders checkboxes.

## 2. Plan file

- [x] 2.1 Create `src/core/tools/plan.ts` with `plan_write` (state, plan mode only) over
  `.jamcli/plan.md`, exported through `tools/index.ts` and registered in `builtins.ts`;
  test a write is read back with `read_file`, hand edits included, and that `plan_write`
  is offered in plan mode only.
- [x] 2.2 Export a `pinnedState(projectRoot)` helper that formats the todo list and the
  plan's path and size within a character budget; test the budget drops completed items
  first and reports the cut.

## 3. Exit plan mode

- [x] 3.1 Add `exitPlanMode` and `elicit` to `ToolContext`; have the runtime remember
  the mode before plan and supply both through `context()`; test `setPermissionMode`
  round trip: default to plan to exit lands on default, accept-edits to plan to exit
  lands on accept-edits.
- [x] 3.2 Add `exit_plan_mode` (state, always asks) to `plan.ts`: fails without a plan,
  otherwise switches through `ctx.exitPlanMode` and reports the next turn's mode; add the
  plan-text preview in `previewCall`; runtime test with the fake provider: approved exit
  switches the mode and records it, denied exit leaves plan mode and returns feedback,
  and a headless run denies it with the hint.
- [x] 3.3 Put a text preview into the ACP permission request's `rawInput`; test the
  mapper output carries it.

## 4. Ask the person

- [x] 4.1 Add `ask_user` (state) to `plan.ts` building a one-field elicitation; test
  with a stub `elicit` that a choice returns its label, free text returns the text, and
  decline or cancel return the assumption note without error.
- [x] 4.2 Runtime test: in the interface surface the tool raises `elicitation_request`
  and the answer comes back; in a headless run the result says no one can answer and the
  run continues.

## 5. Compaction keeps the plan

- [x] 5.1 Add `pinned` to `CompactInput` and append it to the summary; add
  `pinned?: () => Promise<string | undefined>` to the agent's options and call it in
  `compactNow`; test in `compact.test.ts` that the summary message ends with the pinned
  text and that the `compaction` event's `summary` carries it, so the log rebuild matches.
- [x] 5.2 Wire the runtime to supply `pinnedState`; runtime test that after `/compact`
  the summary names a todo item and the plan path.

## 6. Prompt and docs

- [x] 6.1 Rewrite the plan note to name `plan_write`, `exit_plan_mode`, `ask_user`, and
  the todo check; add `ask_user` and `todo_write` lines to `toolGuidance`
  when offered; keep the `modes.test.ts` assertion passing and add a `prompt.test.ts`
  case for each new guidance line.
- [x] 6.2 Update `docs/tools.md` (planning section), regenerate
  `site/src/generated/reference.json` with `site/scripts/reference.ts`, and add a
  CHANGELOG entry; verify the reference lists the four new tools.

## 7. Close

- [x] 7.1 Four gates on the branch head: `bun install`, `npx tsc --noEmit` at baseline 0,
  `bun test`, `bun run build`.
- [x] 7.2 `openspec validate add-plan-tools --strict`, then archive and record the unit in
  `SEQUENCE.md` and `ROADMAP.md`.
