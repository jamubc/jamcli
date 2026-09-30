# Design

## Context

See `proposal.md` for the motivation. What the code does today, checked on 2026-09-29:

- The composer is a `<textarea focused={...}>` (`src/tui/app/App.tsx:1235`). OpenTUI's renderer
  has `autoFocus` on (its default; `start.tsx:37` does not turn it off) and focuses the first
  focusable ancestor of a left mouse-down. `ScrollBoxRenderable` is focusable, so a click in the
  transcript blurs the textarea. The `focused` prop does not change, so React never focuses it
  again.
- `App.tsx:918-925` is the only owner of the exit key: a running turn stops, otherwise the first
  press arms exit for two seconds.
- `earlierMessages` (`src/tui/app/history.ts`) builds Ctrl+R's list from `session.messages`,
  which loses compacted prompts, holds `@`-expanded text, and holds synthetic messages.
- The log is append-only JSONL; `projectMessages` ignores event types it does not handle, and
  `parseTranscriptLine` passes any `v: 2` event (`src/core/transcript/{read,events}.ts`). The
  `note` event (`recorder.recordNote`, `runtime.note`/`notes`) is the closest precedent for a
  record of what the person did that is never sent to the model.
- `start.tsx` runs `exit()` for SIGTERM and SIGHUP; it destroys the renderer, closes the
  runtime, and calls `process.exit`.
- The textarea already has readline editing (Ctrl+A/E/K/U/W, word jumps, undo) and exposes
  `logicalCursor`, `visualCursor`, `lineCount`, `setText`, and `plainText`; it has no
  first-line getter and no auto-grow option, but is sized by yoga's measure function, and boxes
  take `minHeight` and `maxHeight`.

## Goals / Non-Goals

**Goals:**
- Typing works after any click. Ctrl+C, Up, Down, and paste do what the specs say.
- One record of what was typed, read by Up and by Ctrl+R, that survives compaction and resume.
- A draft that cannot be lost by leaving, a closed terminal, or a stray key.
- An agent board of one line per agent whose navigation matches what it shows.

**Non-Goals:**
- A `/` focus key, prefix recall, rebindable history keys, a mode or hint line, vim mode.
- A setting for how many prompts show: recall is one at a time.
- Cross-session Up. Ctrl+R remains the wider search.
- Any change to headless, ACP, or MCP behavior.

## Decisions

**1. A `prompt` event, not a derivation.** `{ v: 2, type: 'prompt', ts, text, state: 'sent' |
'cleared' }`, written by `SessionRecorder.recordPrompt` and exposed as `runtime.prompt(text,
state)` and `runtime.prompts()` beside `note` and `notes`. Alternatives: derive from messages
(loses compacted prompts, shows expanded and synthetic text, cannot show `/cmd`); store a
`typed` field on `ChatMessage` (touches the provider-facing type for a UI concern, and still
misses `/cmd`). An unknown event type is already ignored by every reader, so old builds and old
logs keep working. Like a note, a prompt marks the log started, so a session holding only a
slash command has a file. A prompt equal to the one before it is not written twice.
`prompts()` reads `log.events()`, which the log keeps parsed in memory, so stepping through
history never reads the disk; the list is taken once when recall starts.

**2. Ctrl+R reads prompts, with a fallback.** `earlierMessages` builds from `prompt` events
where a session has any, and from messages (its current derivation) where it has none, so old
sessions still list. This is the only change to Ctrl+R.

**3. Recall is a small pure module, `src/tui/app/recall.ts`.** State is `{ entries, index,
stash }` where `stash` is the draft and its chips at the first Up. Functions take the state, the
key, and the cursor facts and return the next state and what the composer should hold; `App.tsx`
applies it. This keeps the walk, the top-line rule, and the restore testable without a renderer.
Up is taken when the composer holds a recalled entry unedited (from any line, so a multi-line entry
does not have to be crawled through), or when the cursor is on the first line and neither list is
showing. While a recalled entry is unedited the command and reference lists stay off, so a recalled
`/help` does not steal Up and Down; otherwise they keep them. Leaving an edited recalled entry by Up,
Down, or Escape records the edit as a `cleared` prompt, so an edit is never lost, and the walk goes
on from where it was. The first line is `visualCursor.visualRow === 0`, not the
logical row, so a wrapped first line moves the cursor before it recalls; if the native cursor
cannot be trusted at row 0 the fallback is the logical row. Down is taken only while recalling,
or at the empty composer per decision 8. Every recalled entry replaces the composer text with
`setText` and puts the cursor at the end. Escape while recalling restores the stash. A send while
recalling records the prompt and drops the stash.

**4. The focus fix is `preventDefault` on the transcript's mouse-down.** The renderer skips
auto-focus when the event is default-prevented, and selection starts independently of focus.
Alternative: refocus the composer from `endDrag`; that flickers the cursor and races with
selection. If `preventDefault` blocks a block's click-to-toggle, the fallback is the refocus,
and a test decides which. Alternative rejected: turning `autoFocus` off for the renderer, which
would also change every input and list.

**5. Ctrl+C order** is a small edit in the one handler: running turn, else non-empty draft
(clear, record `cleared`, remove the draft file), else the existing armed exit. Clearing does not
also arm exit.

**6. Paste chips are UI state plus expansion at the boundary.** `onPaste` on the textarea calls
`preventDefault` for a paste of ten or more lines or over 1,000 characters, inserts
`[Pasted text #N: L lines]` at the cursor, and keeps `N -> text` in a ref map. A paste with the
cursor on or directly after a chip replaces that chip with its text. The chip is expanded exactly
once, in `submit`, before the text goes to `runCommand`, `controller.submit`, `recordPrompt`, or
the draft file; so history, recall, and the model all see the pasted text. Recall re-forms chips
only when the entry came from the stash or the draft file, which carry the map; a recalled sent
prompt is full text. A chip whose text no longer matches the pattern is plain text. Alternative:
store chips in the log; rejected, since the log is the record of what was sent.

**7. The draft file** is `<historyDir>/<sessionId>.draft`, JSON `{ pid, text, chips }`, in a new
`src/core/transcript/draft.ts`. It is written with a temp file and rename, synchronously, so an
exit handler can call it. The composer's content change schedules a write about 250 ms out and
keeps the latest text in a ref; `exit()` in `start.tsx` calls a synchronous flush from that ref
before `process.exit`, which covers the quit key, SIGTERM, and SIGHUP. A send or a clear removes
the file. Loss on SIGKILL or power failure is bounded by the debounce. Alternatives: an event in
the log per change (grows the log by keystroke, and the log is append-only); a project-wide single
slot (two interfaces in one project would overwrite each other); a draft keyed to the session
only (a new `jamcli` opens a new session id, so the draft is never seen).
On opening a session, `adoptOrphanDraft` scans the project's `*.draft` files other than its own;
one whose `pid` is not alive (`process.kill(pid, 0)`) is renamed into ownership, its text placed in
an empty composer, and a notice names the session it came from. The rename is atomic, so two
starts cannot both take it. A live pid is left alone. Session listing reads `*.jsonl` only, so a
`.draft` file is not a session (checked by a test).

**8. Board keys.** Up belongs to history, so choosing a child moves to Down. On an empty composer
with nothing queued, Down chooses the running child (else the first); with a choice held, Up and
Down move it, Enter opens, Escape lets go, and Up on the first child lets go so the next Up is
history. A queued message still comes back on Down first (existing order at `App.tsx:1009`). The
board's hint line names the keys.

**9. The board's two clocks become one.** The panel derives its list with `shownWork(work, now,
sentAt)` using a ticking `now`; the key handler uses `Date.now()`. With reduced motion or screen
reader mode the panel's `now` never ticks. The handler and the panel both take the list from one
memoised value keyed on the panel's clock, and the clock ticks whenever any ended child is
listed, whether or not motion is reduced (a one second tick is not motion). Focus is cleared in
the same effect when the chosen child is no longer in that list, not only when it leaves
`state.work`. The hint is shown whenever the list holds a task.

**10. The thin board.** Each agent row is a single `<box flexDirection="row"
justifyContent="space-between">`: state mark, kind, and label on the left, cut first; detail
(what it is doing now, in the warning color while it asks), then time, tokens, and cost on the
right, never cut. The rail row and the top margin per agent go. The pattern is already in
`Prompt.tsx` for the `[Esc]` badge. The active plan step, with its `check:`, wraps to at most
four lines; other steps stay one line with truncation. Screen reader mode keeps its one line of
words per agent.

**11. Auto-grow and counter.** The composer's box drops its fixed height for `minHeight` of one
text row and `maxHeight` of eight, plus borders. The textarea sizes to its content through yoga's
measure target. The counter sits at the box's bottom-right once the draft passes two lines. Both
use the existing `framed()` helper so plain mode keeps its frame.

## Risks / Trade-offs

- **Up/Down semantics change for agent choosing** → the documented keys and the board hint move
  with the code; the queue-first order is kept; `docs/interface.md` lists it as a change.
- **A draft may hold a pasted secret on disk** → it is under the gitignored `.jamcli/history/`,
  removed on send or clear, and documented in `docs/security.md`. A cleared draft also enters the
  log, as every sent message already does.
- **`preventDefault` might block a click-to-toggle** → decided by the first test; fallback named.
- **Unset height might not auto-grow** → a test shows it before the layout is changed; fallback is
  setting `height` from `lineCount`.
- **The first visual row may not be reported reliably** → tested with a wrapped first line; the
  fallback is the logical row, with the wrapped case moving the cursor by another key press.
- **A pid can be reused** → a live unrelated process could hide an orphan draft. The draft is then
  simply not restored until that pid ends; it is never deleted, and Ctrl+R and the log are
  unaffected.
- **Session files created by slash commands** → a session that only ran `/help` now has a log. It
  matches `note`; `/resume` already refuses a session with no messages.

## Migration Plan

No migration. New events are ignored by older readers; sessions without them fall back to their
messages. Rolling back means removing the recorder call; logs keep their `prompt` lines harmlessly.
`.draft` files are safe to delete.
