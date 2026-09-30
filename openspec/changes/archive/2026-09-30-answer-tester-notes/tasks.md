# Tasks

Baseline: `npx tsc --noEmit` reports 0 errors on `master` at `7be9de5`.

## 1. The log and the index

- [x] 1.1 Add the `name`, `color`, `reflection`, `flag`, and `wake` events to
  `src/core/transcript/events.ts`, and recorder methods that write them.
- [x] 1.2 Carry `name` and `color` in the session index summary, read from the last such
  event, and add `resolveSessionRef` in `src/core/transcript/sessions.ts`: an id, else a
  name, in this project first and then in any. Names normalize spaces to `-` and allow
  letters, digits, `-`, `_`, `.`. A log the index never listed still opens by its id.

## 2. Wakes, flags, and keeping awake (`src/core/wake/`)

- [x] 2.1 `board.ts`: the flag board, one JSON file per session in the state directory,
  written through a temporary file; raise, lower, and read by session.
- [x] 2.2 `table.ts`: the session's wakes: set with a time or a flag condition, cancel,
  list, a check four times a second that fires what is due, limits (1 s to 7 days, 20 pending,
  known sessions only), and rebuild from the log on resume with missed timers reported.
- [x] 2.3 `awake.ts`: `caffeinate -i -w <pid>` on macOS while held, through an injected
  spawner, released when nothing holds it.
- [x] 2.4 The `wake` and `flag` tools, registered by the runtime for the interface,
  headless, and ACP, never for a delegated run.
- [x] 2.5 Runtime: compose the table, the board, and keep-awake; `name`, `color`,
  `rename`, `setColor`, `wakes`, `setWake`, `cancelWake`, `onWake`, `flags`, `raiseFlag`,
  `lowerFlag`; hold awake while a turn runs or a wake is pending; the session references
  note with each prompt; the `reflection` event from a turn's options.

## 3. Commands

- [x] 3.1 `/rename`, `/color`, `/flag`, `/wake` (alias `/timer`), `/report`, and `/notes`
  listing, in `src/commands/builtin/`.
- [x] 3.2 `/resume` and `jamcli --resume` accept a name.
- [x] 3.3 `/reflect` asks for the notes' framing when there are notes and passes it to the
  turn; `session_signals` lists framed notes; a lesson may cite them. The question is not
  person-only after all: headless could then never answer it, so `/reflect` with notes
  could not run there. A lesson drawn from a note still asks the person.

## 4. Surfaces

- [x] 4.1 Interface: the notes panel collapses past three into a wheel row; the header shows
  the name; the composer border and status line take the color; user rows highlight session
  references and a leading command; wakes are sent through the controller's queue.
- [x] 4.2 Headless waits for pending wakes before it returns, and runs each.
- [x] 4.3 ACP runs a wake as a turn of its own, streamed as session updates; the MCP
  server's delegated session runs it as it runs a sent prompt.

## 5. Evidence

- [x] 5.1 Module tests for the board, the table's limits and resume, keep-awake, and the
  call summaries; framed notes through a real runtime's reflection turn. Name resolution
  is proved through `/rename`, `--resume <name>`, and a prompt naming a session.
- [x] 5.2 Surface tests: a headless run whose timer fires and a headless flag wait across
  processes; an ACP session whose wake runs after a prompt, never beside it; an MCP
  delegated session whose wake runs as a turn; the interface's collapsed notes, moved with
  the mock mouse's wheel and opened on hover, the renamed header, and the framing question. Frames are text, so the composer's color is proved by
  `sessionTint` and by the live recording's escape codes.
- [x] 5.3 Drive the built program through `jamcli mcp serve` in a fixture: rename, color,
  four notes collapsing, a timer the model set with the `wake` tool, `caffeinate` held and
  released, a flag wait across two sessions, `/report`, and `/reflect` framed. It found the
  raw JSON wake line, `600 s`, a doubled full stop, and the picker's "(5 of 4)", all fixed.
- [x] 5.4 The four gates, `openspec validate answer-tester-notes --strict`, and the docs
  that list commands.

## 6. Close

- [x] 6.1 Name the unit in `openspec/SEQUENCE.md` while open, and record it closed there
  at archive.
- [x] 6.2 Archive the change.
