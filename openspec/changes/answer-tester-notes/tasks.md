# Tasks

Baseline: `npx tsc --noEmit` reports 0 errors on `master` at `7be9de5`.

## 1. The log and the index

- [ ] 1.1 Add the `name`, `color`, `reflection`, `flag`, and `wake` events to
  `src/core/transcript/events.ts`, and recorder methods that write them.
- [ ] 1.2 Carry `name` and `color` in the session index summary, read from the last such
  event, and add `resolveSessionRef` in `src/core/transcript/sessions.ts`: an id, else a
  name, in this project first and then in any. Names normalize spaces to `-` and allow
  letters, digits, `-`, `_`, `.`.

## 2. Wakes, flags, and keeping awake (`src/core/wake/`)

- [ ] 2.1 `board.ts`: the flag board, one JSON file per session in the state directory,
  written through a temporary file; raise, lower, and read by session.
- [ ] 2.2 `table.ts`: the session's wakes: set with a time or a flag condition, cancel,
  list, a one-second check that fires what is due, limits (1 s to 7 days, 20 pending,
  known sessions only), and rebuild from the log on resume with missed timers reported.
- [ ] 2.3 `awake.ts`: `caffeinate -i -w <pid>` on macOS while held, through an injected
  spawner, released when nothing holds it.
- [ ] 2.4 The `wake` and `flag` tools, registered by the runtime for the interface,
  headless, and ACP, never for a delegated run.
- [ ] 2.5 Runtime: compose the table, the board, and keep-awake; `name`, `color`,
  `rename`, `setColor`, `wakes`, `setWake`, `cancelWake`, `onWake`, `flags`, `raiseFlag`,
  `lowerFlag`; hold awake while a turn runs or a wake is pending; the session references
  note with each prompt; the `reflection` event from a turn's options.

## 3. Commands

- [ ] 3.1 `/rename`, `/color`, `/flag`, `/wake` (alias `/timer`), `/report`, and `/notes`
  listing, in `src/commands/builtin/`.
- [ ] 3.2 `/resume` and `jamcli --resume` accept a name.
- [ ] 3.3 `/reflect` asks for the notes' framing when there are notes, person-only, and
  passes it to the turn; `session_signals` lists framed notes; a lesson may cite them.

## 4. Surfaces

- [ ] 4.1 Interface: the notes panel collapses past three into a wheel row; the header shows
  the name; the composer border and status line take the color; user rows highlight session
  references and a leading command; wakes are sent through the controller's queue.
- [ ] 4.2 Headless waits for pending wakes before it returns, and runs each.
- [ ] 4.3 ACP runs a wake as a turn of its own, streamed as session updates; the MCP
  server's delegated session runs it as it runs a sent prompt.

## 5. Evidence

- [ ] 5.1 Module tests for the board, the table's limits and resume, keep-awake, name
  resolution, and signals with framed notes.
- [ ] 5.2 Surface tests: a headless run whose wake fires; an ACP session whose wake runs as
  a turn; the interface's collapsed notes frame and colored composer.
- [ ] 5.3 Drive the built program through `jamcli mcp serve` in a fixture: rename, color,
  note, report, a timer, and a flag wait across two sessions.
- [ ] 5.4 The four gates, `openspec validate answer-tester-notes --strict`, and the docs
  that list commands.

## 6. Close

- [ ] 6.1 Name the unit in `openspec/SEQUENCE.md` while open, and record it closed there
  at archive.
- [ ] 6.2 Archive the change.
