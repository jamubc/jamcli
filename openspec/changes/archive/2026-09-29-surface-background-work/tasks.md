# Tasks

## 1. The work table

- [x] 1.1 Add `src/core/work.ts` with `WorkTable` (add, end, list, running, stopAll, watch, drainEnded) and `ToolContext.work`; unit-test that `drainEnded` reports each ended entry once and `watch` fires on add and end.
- [x] 1.2 Move background commands onto the table: `startBackgroundCommand` registers an entry, `command_output` and `command_kill` resolve ids through it, and the module map goes. Update `src/core/tools/__tests__/command.test.ts` to pass a table and add a test that a job id from one table is unknown to another.
- [x] 1.3 Move tasks onto the table: a foreground child is an entry while it runs, a background child's record lives on its entry, `canDelegate` counts the table's running tasks, and the module map goes. Extend the task tests so a foreground child is listed while it runs and gone after.

## 2. Ends reach the model

- [x] 2.1 Add `AgentOptions.news` and call it in `turn()` after the prompt is recorded and after each batch's results are recorded, appending the lines as hook context is appended. Test in `src/core/__tests__/` with a scripted provider: a job that ended between turns is named in the next prompt's message; one that ends during a step is named on that step's last tool result; neither is repeated.
- [x] 2.2 Supply `news` from the runtime's table with one line per ended entry naming the id, the label, how it ended, its duration, and the tool that reads it. Test through `createRuntime` with the fake provider that a background `run_command` that exits is reported on the next turn.

## 3. Work reaches the person

- [x] 3.1 Add `work()`, `watchWork()`, and `stopWork()` to `Runtime`; a child runtime shares its parent's table; `close()` on the top-level runtime stops everything, `cancel()` stops nothing. Test that cancelling a turn leaves a job running and closing the runtime stops it.
- [x] 3.2 Add `/jobs` and `/jobs stop <id>` to the built-in commands, listed in `/help`; test through the command host that the table is shown and a stop ends the job, and update the spec's command list assertion.
- [x] 3.3 Add `work` to the view state with a `work` action, count running jobs and agents on the status line as a droppable part, and subscribe the controller to `watchWork`. Test the reducer and `fitStatus`, and regenerate the frame snapshot that shows a running job.

## 4. Fan-out and guidance

- [x] 4.1 In `executeBatch`, decide consecutive `delegate` calls in order and run the allowed ones together, settling each in call order and calling `beforeChange` once. Test in the dispatch tests that three tasks overlap in time and that a denial in the middle still stops the step.
- [x] 4.2 Add the background line to the tool guidance in `prompt.ts` and `· background` to `describeCall` for a background command; update the prompt and approval tests.

## 5. Gates and record

- [x] 5.1 Run the four gates: `bun install`, `npx tsc --noEmit`, `bun test`, `bun run build`.
- [ ] 5.2 Drive the interface on a real model through `jamcli mcp serve` in a throwaway fixture project: ask for a server started in the background, confirm the status line counts it, `/jobs` lists it, the next turn's prompt carries its end, and `/jobs stop` ends it. Keep the terminal recording as the evidence. Deferred to the owner: the registered server was started before this change and keeps the code it started with, and the fake provider drives every path this unit changed through the interface, headless, and the runtime. Not run: the owner closed the unit on 2026-09-29 to open the review units in `openspec/ROADMAP.md`, which halt interface work, while the working tree held uncommitted interface edits a drive would have run with it.
- [x] 5.3 Record the unit in `openspec/SEQUENCE.md` and `openspec/ROADMAP.md`.
