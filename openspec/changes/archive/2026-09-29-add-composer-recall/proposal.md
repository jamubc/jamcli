# Proposal

## Why

The composer loses the person's words and their place. Clicking the transcript to select
text hands keyboard focus to the transcript's scrollbox, so typing goes nowhere until the
composer is clicked; nothing in `src/tui` gives focus back. Ctrl+C on a draft counts toward
exit instead of clearing it. There is no recall of what was sent, and none can be derived
from `session.messages`: compaction drops earlier user messages, the stored message is the
`@`-expanded prompt rather than what was typed, `!cmd` and `#note` are stored as synthetic
messages, and `/commands` are not in the log at all. A prompt typed for half an hour is lost
if the terminal closes or Ctrl+C is pressed once too often. The spec also promises that long
pastes collapse into a preview, which the code does not do.

Ctrl+R history search already exists and stays the in-depth, cross-session search. It reads
the same flawed derivation, so it gains from the same fix.

## What Changes

- A left click on the transcript no longer takes keyboard focus from the composer. No new
  focus key.
- Ctrl+C order: a running turn stops first (as today); otherwise a non-empty draft is
  cleared, and only an empty composer arms exit.
- A new append-only `prompt` event in the session log records what the person typed and
  whether it was sent or cleared. It covers messages, `!cmd`, `#note`, and `/commands`.
- Up on the composer's top line recalls the previous prompt, one at a time, into the composer
  exactly as it was typed or pasted; Down walks forward and, past the newest, restores the
  unsent draft. Nothing is cleared until a send. A one-row strip shows where the person is.
  Ctrl+R reads the same record.
- A cleared draft is saved as a `cleared` prompt, so Up brings it back.
- A draft is written to disk as it is typed and flushed on exit, SIGHUP, and SIGTERM. The
  next session opened in the project adopts a draft left by a session whose process is gone.
- A paste of ten or more lines, or over 1,000 characters, becomes a chip such as
  `[Pasted text #1: 42 lines]` that expands on send; pasting with the cursor on or after a chip
  expands it in place.
- The composer grows from one line to eight, then scrolls; a counter of lines and characters
  shows once a draft passes two lines.
- **BREAKING (keys):** Up and Down on an empty composer no longer choose a child agent. Up is
  history; Down chooses an agent (Up on the first row lets go). Down still takes back a queued
  message first.
- The agent board draws one line per agent, and the active plan step may wrap to four lines.
- Four defects in the board's navigation are fixed: a frozen clock that hides expiry with
  reduced motion or screen reader mode, focus that outlives its row, a navigation hint that
  ignores ended agents, and two clocks that disagree about what is listed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jamcli`: Terminal User Interface (focus, paste chip, Ctrl+C, composer growth and counter),
  Session History Persistence (the `prompt` event), Todo Acceptance Checks (the thinner board
  and Down to choose an agent). Two requirements are added: Prompt Recall, and Unsent Draft
  Safety.

## Impact

- Core: `src/core/transcript/{events,recorder}.ts`, new `src/core/transcript/draft.ts`,
  `src/core/runtime/index.ts`. No provider, tool, or permission change.
- Interface: `src/tui/app/{App.tsx,history.ts,start.tsx}`, new `src/tui/app/recall.ts`.
- Docs: `docs/interface.md`, `docs/ux.md`, `docs/sessions.md`, `docs/security.md`.
- No new dependency and no new configuration key. Up and Down remain fixed keys.
- Headless and ACP have no composer; they are unaffected except that a log carrying `prompt`
  events still loads and projects unchanged.
- A draft on disk holds typed text, which may include a secret the person pasted. It sits
  under the gitignored `.jamcli/history/`, is removed on send or clear, and is documented in
  `docs/security.md`. A cleared draft stays in the log, as every sent message already does.
