# Proposal

## Why

On 2026-09-30 the owner tested JamCLI in two sessions, `2026-09-29-1a6a254d` and
`2026-09-30-aa68115b`, and planted eleven tester notes with `/note` (one of them typed as
`/also`, so it was kept as a prompt). This unit answers them. `SEQUENCE.md` names the
transcripts of people who use JamCLI as the input that decides what opens next, and these
are that input.

What the notes ask, grouped, with the session each came from:

1. **Notes reach reflection, after the person frames them** (aa68115b: "reflections should
   include notes"; 1a6a254d: pass tester notes to `/reflect` behind a gate where the person
   says what they are, such as feature ideas or concerns about a model). Checked in the
   code: `session_signals` reads only failures, so a reflection never sees a note.
2. **`/report`** (1a6a254d): all the session's notes, the model, the effort, the context
   usage at that moment, an option to include the log, and an optional message.
3. **Notes stop hiding the interface** (1a6a254d): past a few, old notes collapse into one
   row that can still be explored, one note at a time.
4. **`/rename`** (aa68115b): name a session, and accept the name wherever the id is.
5. **`/color`** (aa68115b): tell sessions apart at a glance by the composer's border and a
   tint of the status line, nothing more.
6. **Keep the Mac awake while working** (aa68115b): `caffeinate` while a task runs, as
   Claude Code does.
7. **Timers** (1a6a254d): a tool and a command that make JamCLI itself run a prompt later.
   The model does not pretend to wait; the harness calls it back. A message from the person
   meanwhile does not cancel it; only removing it does.
8. **Flags between sessions** (1a6a254d, twice): a session raises a flag such as `green`;
   another waits until every session it names has raised it, then runs its prompt. Through
   commands and through tools. Sessions named in a prompt are recognized and highlighted,
   so a prompt can be written naturally.

## What Changes

- **Reflection reads framed notes.** `/reflect` in a session with notes first asks the
  person, and only the person, how to read them: ideas for new JamCLI features, concerns
  about how the model behaved, bugs in JamCLI, their own words, or leave them out. The
  framing is recorded in the log as a `reflection` event. When the notes are kept,
  `session_signals` lists each as a `note` signal with its id, under the framing, and a
  lesson may cite it. The gates are unchanged: a lesson still cites, is still refused when
  it restates what is written, and is still written only when the person approves its diff.
- **`/report [message]`.** Asks whether to include the session log, and for a message when
  none was given (optional; Enter skips it). Writes `.jamcli/reports/<session>-<time>.md`
  with the session's id and name, the time, JamCLI's version, the model, the effort, the
  context usage, the cost, every note with its time, the message, and, when asked for, the
  session as Markdown with the log's path. The report is shown where there is no screen.
- **`/notes` lists every note.** Beyond three notes the panel is one row: the newest note,
  its place among them, and the count. The mouse wheel over it moves through them one at a
  time, and hovering shows the one in view whole. Screen reader mode says how many there
  are and the newest.
- **`/rename <name>`.** Names are one word of letters, digits, `-`, `_`, and `.` (spaces
  become `-`), unique in the project. The name is recorded in the log as a `name` event,
  carried by the session index, shown in the header, and accepted by `/resume`,
  `jamcli --resume`, flags, and timers wherever an id is.
- **`/color [name|default]`.** One of red, orange, yellow, green, cyan, blue, purple, pink,
  or default. Recorded in the log as a `color` event, so a resumed session keeps it. The
  interface draws the composer's border in it and tints the status line with it; a surface
  without a screen records it and says so.
- **Keep awake.** On macOS, while a turn runs or a timer or flag wait is pending, JamCLI
  runs `caffeinate -i -w <its pid>`, and stops it when neither holds. No setting: where
  `caffeinate` is absent nothing runs, and a delegated run leaves it to its parent.
- **Wakes: timers and flag waits, one mechanism.** A wake is a prompt this session runs
  later, when a time comes or when named sessions have raised a flag. The `wake` tool
  (`set`, `cancel`, `list`) and the `/wake` command (alias `/timer`) set and remove them.
  A wake that goes off reaches the model as a bracketed harness line naming the wake, who
  set it, and why it went off, then its prompt. Every set, cancel, fire, and miss is
  recorded as a `wake` event. The interface queues it behind a running turn; headless
  waits for pending wakes before it exits; ACP and the MCP server run it as a turn of
  their own. A resumed session sets again the wakes still ahead and reports the timers
  that came due while it was closed, without running them.
- **Flags.** `/flag <name>` raises a flag on this session, `/flag lower <name>` lowers it,
  and `/flag` lists this session's and the named sessions'. The `flag` tool does the same
  for the model. Flags live in the state directory, one file per session, so any JamCLI on
  the machine reads them, and are recorded as `flag` events. A flag stays raised after its
  session closes, so a finished session still counts.
- **Session references.** A session id, or a name the index holds, in a prompt is
  recognized: the model is told, in a bracketed harness line, each such session's project,
  log path, note count, and raised flags, so it can read the log or wait on it. The
  interface highlights the reference in the sent message, as it does a leading command.

## Not in this unit

- **`/recap`** (aa68115b). That note records that session `aa68115b` is building it, on
  the owner's request there; this unit leaves it to that work.
- **Streaming smoothness** (1a6a254d asked, as the focus of a `/reflect`, for streamed text
  to settle in chunks without flicker). It is not a tester note, and it needs a measurement
  of the render path before a design. It stays with the owner.

## Impact

- Spec: Terminal User Interface, Session Reflection, and Transcript Event Log are
  modified; Session Reports, Session Identity, Keep Awake, Wakes and Flags, and Session
  References are added.
- Code: a new `src/core/wake/` (flag board, wake table, keep-awake), session identity in
  `src/core/transcript/`, the runtime composing them, new commands in
  `src/commands/builtin/`, the interface's notes panel, header, composer, and user rows,
  and wake delivery in headless, ACP, and the MCP server's sessions.
- No dependency, no configuration key.
