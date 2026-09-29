# Proposal

## Why

The plan board and the permission prompt are typeset as prose in bordered boxes: every
step is a full line in one color with a bracketed box for its state, its check is indented
with spaces, and the border spends two rows and two columns. While a call waits, the prompt
replaces the board, so the plan vanishes at the moment the person decides. The board shows
only what the model wrote, never what is running, so with a job or a child agent under way
the person cannot tell whether anything is happening. The owner raised all three from
session `2026-09-28-040643ab`.

## What Changes

- **The board is drawn, not typeset.** Its header is the whole plan as a strip of marks with
  the count and the turn's phase; each step is a mark and a color for its state, `●` done
  in the settled tone, `◐` running in the accent with how long it has run, `○` pending;
  the running step's check sits behind the rail. No border. Screen reader mode keeps the
  worded lines.
- **The board stays up beside a prompt.** It is drawn above the prompt or the composer,
  whichever is there.
- **The board shows what runs beside the turn.** Each running background command and child
  agent is a line under the header, with how long it has run and the `/jobs stop` that
  ends it. The clock ticks while anything has a duration to show, except with reduced
  motion or in screen reader mode.
- **The prompt says a command once.** A command the heading shows whole is not printed
  again; its facts, where it runs and whether it stays running, are, behind the rail. The
  pattern count sits on the row Up and Down change; the project row names the same rule
  once; the frame is the accent for a change to files and the warning color for anything
  that runs.
- **A grant names its rule on the tool line**, `allowed by you · run_command(ls *)`, so
  what the session now allows is read where it was given.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jamcli`: **Todo Acceptance Checks** gains how the board is drawn, that it stays up
  beside a prompt, and that it lists what runs beside the turn. A new requirement,
  **Permission Prompt Presentation**, carries the prompt's shape and the grant named on
  the tool line.

## Impact

- `src/tui/app/App.tsx` (the board and its place), `src/tui/app/Prompt.tsx`,
  `src/tui/app/format.ts` (the tool line), `src/tui/state/view.ts` (the running step's
  start time, the work items, the prompt's class), `src/core/approval.ts` (the preview's
  facts).
- The frame snapshots, the prompt, access, view, and format tests.
