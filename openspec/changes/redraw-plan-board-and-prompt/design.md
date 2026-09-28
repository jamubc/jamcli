# Design

## Context

See proposal.md for why. The board is `TodoPanel` in `src/tui/app/App.tsx`, drawn inside
the composer's branch of a ternary that the prompt replaces. The prompt is
`PermissionPrompt` in `src/tui/app/Prompt.tsx`, which prints the command in its heading and
again in its preview. `Rows.tsx` draws tool detail behind a rail already. The view state
has no start time for a running step and, before `surface-background-work`, no work items.

## Goals / Non-Goals

**Goals:**
- Status read by mark and color before the words are parsed; detail behind the rail.
- The board present whenever the person decides, and honest about what runs.
- Nothing said twice in the prompt.

**Non-Goals:**
- New theme roles or themes; the settled tone and the accent carry it.
- Expanding a step to show every check; only the running step's shows.
- Changing the prompt's heading or its keyed choices, which every test and every person
  already reads.

## Decisions

**Marks and colors, words in screen reader mode.** `TODO_MARKS` beside `TODO_BOXES`; the
styled board draws marks, `todoLine` keeps the words for screen reader mode, whose lines
are unchanged. Alternative: color only. Rejected: monochrome and NO_COLOR would lose the
state.

**The running step's clock lives in the view state.** The reducer keeps `since` on a step
that is in progress, carried over when the model rewrites the list with the step still
running, so the board can say how long without the model saying so. The board ticks with
its own one-second timer only while something has a duration to show.

**The board is drawn above the prompt-or-composer ternary**, so it is the same element in
both cases and keeps its scroll and its timer. The transcript's scrollbox flexes to make
room, as it already does for the prompt.

**Work items reach the view whole.** The `work` action keeps the items as well as the
counts, so the board lists each with its label, duration, and id.

**The prompt drops the repeated command by comparison, not by tool.** `omitRepeated` keeps
a command the heading had to cut and drops one the heading shows whole, leaving the facts
line. Alternative: never show the preview for commands. Rejected: a long command must be
read whole, and the heading is one line.

**The frame's color follows the class** the approval request already carries
(`policyClass`), which the view now keeps on the pending approval.

## Risks / Trade-offs

- [A one-second timer while a step runs] → cleared when nothing has a duration, when the
  panel unmounts, and never started with reduced motion or in screen reader mode.
- [The board above a prompt takes rows from the transcript] → the transcript keeps its
  eight rows as before; the board is short and truncates long labels to one line each.
