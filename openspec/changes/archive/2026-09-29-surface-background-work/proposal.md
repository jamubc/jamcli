# Proposal

## Why

A command started with `background: true` and a child agent started with `task` both
vanish once started: nothing tells the model when either ends, nothing shows the person
that either is running, and nothing but exit stops them. In session `2026-09-28-040643ab`
the server job died at once and the model found out only by polling; three foreground
`task` calls meant to run "in parallel" ran one after another; and the person, watching a
plan board that said "starting the server" for minutes, could not tell whether anything
was happening. Work that runs beside the turn has to be visible to both parties and
stoppable by the person.

## What Changes

- **A work table per runtime.** Every background command and every child agent, foreground
  or background, is an entry in one table the runtime owns: what it is, when it started,
  whether it still runs, and how it ended. Today jobs and background tasks sit in two
  module-global maps shared by every session in the process.
- **Ends reach the model.** When a job or a task ends, the model is told at the next point
  it listens: appended to the prompt of its next turn, or to the last tool result of the
  step that was running. No polling, no wake-up turn.
- **Work reaches the person.** The runtime reports its work to its surface as it changes.
  The interface's status line counts running jobs and agents; `/jobs` lists them with what
  they are and how long they have run, and `/jobs stop <id>` stops one, on every surface.
  Cancelling a turn leaves them running; closing the session stops them.
- **Foreground tasks in one step run together.** Consecutive `task` calls in one model step
  are decided one after another and then run concurrently, bounded by the configured
  concurrency, so a fan-out is a fan-out.
- **The model is told how to run a server.** The tool guidance names `background: true` for
  anything that does not exit on its own, and the approval line for a background command
  says it is one.
- **Stopping a job does not ask.** `command_kill` is the session's own state, as
  `task_cancel` already is. (Landed ahead in commit 34866c9.)

## Capabilities

### New Capabilities

None. Every behavior here extends requirements the `jamcli` spec already carries.

### Modified Capabilities

- `jamcli`: **Shell Command Execution** gains that a background job's end reaches the model
  and the person, that a job is stoppable by the person, and that jobs belong to the
  session. **Delegated Task Execution** gains that consecutive foreground tasks in one
  step run together and that a child's start and end reach the person. **Slash Command
  Surface** gains `/jobs`. **Terminal User Interface** gains the running-work count on
  the status line.

## Impact

- `src/core/tools/command.ts`, `src/core/tools/task.ts`: the module-global maps become a
  work table the runtime creates and passes through the tool context.
- `src/core/agent.ts`, `src/core/tools/dispatch.ts`: the news seam and the delegate grouping.
- `src/core/runtime/index.ts`, `src/core/runtime/prompt.ts`, `src/core/approval.ts`: the
  table's owner, the guidance line, and the approval summary.
- `src/commands/builtin/index.ts`: `/jobs`.
- `src/tui/state/view.ts`, `src/tui/app/format.ts`, `src/tui/app/controller.ts`: the
  status line count, fed by the runtime's work listener.
- Tests for the tool, the dispatcher grouping, the agent's news lines, the command on each
  surface, and the view reducer. The MCP server test that hosts several sessions checks
  that a session's jobs are its own.
