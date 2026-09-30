# Spec Delta

## ADDED Requirements

### Requirement: Prompt Recall
The interface SHALL let the person recall what they sent earlier in the session with Up and
Down, one prompt at a time, into the composer exactly as it was typed or pasted, and SHALL
never lose the unsent draft while they do.

#### Scenario: Up recalls the previous prompt
- **WHEN** the person presses Up with the cursor on the composer's first line and no list of commands or references showing
- **THEN** the composer holds the prompt sent last, with its lines and pasted text as they were, and the cursor at its end
- **AND** a row above the composer says which prompt of how many it is and how to go on

#### Scenario: Up walks back and Down walks forward
- **WHEN** the person presses Up again, or Down with the cursor on the composer's last line
- **THEN** the composer holds the next older or the next newer prompt
- **AND** Up at the oldest prompt stays on it

#### Scenario: The draft comes back
- **WHEN** the person had text in the composer before pressing Up, and presses Down past the newest prompt, or Escape
- **THEN** the composer holds that text again, with its chips, and the recall row goes

#### Scenario: A multi-line draft is walked through first
- **WHEN** the composer holds several lines and the cursor is below the first
- **THEN** Up moves the cursor up a line and does not recall a prompt
- **AND** Up recalls a prompt only once the cursor is on the first line

#### Scenario: Recalled text is edited or sent like any text
- **WHEN** the person edits a recalled prompt, or adds to its end, or sends it
- **THEN** the edit is an ordinary draft and the earlier draft is dropped only when something is sent

#### Scenario: Slash and shell lines are recalled
- **WHEN** the person sent `!ls` or `/help` earlier in the session
- **THEN** Up recalls it as typed

#### Scenario: A cleared draft is recalled
- **WHEN** the person cleared a draft with the exit key
- **THEN** Up recalls it, marked as cleared

#### Scenario: Recall survives resume
- **WHEN** the person resumes a session
- **THEN** Up recalls the prompts of the whole session, including those before a compaction

#### Scenario: Search stays the wider view
- **WHEN** the person presses the history search key
- **THEN** the list of earlier messages of the project's sessions opens, drawn from the same recorded prompts

### Requirement: Unsent Draft Safety
The interface SHALL keep a draft the person has not sent, so that no exit, crash, or stray
key loses it without a way back.

#### Scenario: A draft is written as it is typed
- **WHEN** the person types or pastes into the composer
- **THEN** within a fraction of a second the draft, with the text of its chips, is on disk under the session's history directory
- **AND** sending the message, or clearing the composer, removes the file

#### Scenario: A draft survives leaving
- **WHEN** the person leaves with text in the composer, or the terminal closes, or the process is told to end
- **THEN** the draft is written before the process ends

#### Scenario: The next session restores it
- **WHEN** a session opens in the project, its composer is empty, and an earlier session left a draft whose process has ended
- **THEN** the composer holds that draft with its chips, and a notice names the session it came from
- **AND** the draft file is taken, so a second interface opened at once does not restore it too

#### Scenario: A running session's draft is left alone
- **WHEN** another interface is running in the project with text in its composer
- **THEN** this session does not restore that draft

#### Scenario: A cleared draft is not lost
- **WHEN** the person clears a draft with the exit key
- **THEN** the draft is removed from disk and kept in the session log as a cleared prompt

## MODIFIED Requirements

### Requirement: Terminal User Interface
JamCLI SHALL provide an interactive terminal interface with a header, a scrollable
transcript, a multi-line composer, and a status line, rendering the same runtime events
every other surface receives. Its labels SHALL read as labels: the thing first, no clause
explaining why, and one word where one word carries the state.

#### Scenario: Launch the interface
- **WHEN** the user runs `jamcli` in a directory
- **THEN** the terminal interface renders
- **AND** input is focused in the composer

#### Scenario: A click on the transcript keeps typing in the composer
- **WHEN** the user clicks or drags across the transcript, or clicks a block to show or hide it
- **THEN** the composer still has keyboard focus
- **AND** the next keys typed reach the composer without a click on it

#### Scenario: Invite a first message
- **WHEN** the composer is empty
- **THEN** its placeholder invites a message and names the two ways in, `/` for commands and `?` for help
- **AND** it does not list the send and newline keys, which the help overlay and the keys reference carry

#### Scenario: Render a streaming reply
- **WHEN** a model response is streaming, with or without tool calls
- **THEN** the status line reports a thinking phase before first token and a streaming phase after
- **AND** the reply text appears incrementally in the transcript

#### Scenario: Show tool activity
- **WHEN** a tool call runs
- **THEN** the transcript shows it as a block with the tool, a summary of its arguments, its status, and its duration
- **AND** the line leads with the call, and carries its status as the leading mark rather than as a word in front of the call
- **AND** a click on the block shows or hides an edit's diff or the end of a command's output

#### Scenario: Name the state in a word where there is no mark
- **WHEN** the interface draws without marks, as screen reader mode does
- **THEN** every tool line still names its state as a word
- **AND** the word follows the facts it belongs to rather than leading the line

#### Scenario: Show thinking in a steady window
- **WHEN** the model thinks before it answers
- **THEN** the thinking streams into a window of the height and width `ui.thinking_lines` and `ui.thinking_width` set, so the transcript above it does not move
- **AND** once the reply starts the window folds to one line saying how much thinking there was, which a click opens

#### Scenario: Expand the transcript
- **WHEN** the user presses the expanded view key
- **THEN** every block shows all it holds, thinking, tool output, and diffs, until the key is pressed again
- **AND** the status line says the view is expanded

#### Scenario: Keep the transcript in view behind a prompt
- **WHEN** a permission prompt is open
- **THEN** the transcript keeps rows above it, and a preview too long for the rest scrolls in its space with a note of how much more there is
- **AND** the page keys scroll the transcript while the prompt waits

#### Scenario: Read a command whole before allowing it
- **WHEN** a permission prompt shows a command
- **THEN** the whole command is shown, its long lines wrapped rather than cut

#### Scenario: Pin a note
- **WHEN** the user runs `/note` with text
- **THEN** the note is pinned above the conversation, newest first, until `/notes clear` removes the notes
- **AND** notes are never sent to the model

#### Scenario: Select and click
- **WHEN** the user drags across the transcript
- **THEN** the text is selected, stays on its words as the transcript scrolls, and is copied on release
- **AND** a click chooses a row in a list or answers a prompt, and the row a click would choose is marked before the click

#### Scenario: Show the session state
- **WHEN** a session is active
- **THEN** the status line shows the permission mode, the provider and model, the share of the context window in use, the session cost, the sandbox kind, and the connected server counts
- **AND** each phase it reports is one word, except a retry, which carries its attempt and reason

#### Scenario: Confirm a saved setting
- **WHEN** a command saves a setting and reopens the session so it applies
- **THEN** the notice says the change applied, without explaining the reopening that carried it

#### Scenario: Handle a multi-line paste
- **WHEN** pasted content arrives inside bracketed paste markers
- **THEN** the composer normalizes line endings
- **AND** a paste of ten or more lines, or of more than 1,000 characters, collapses into a chip that names how many lines it holds, such as `[Pasted text #1: 42 lines]`, rather than expanding the composer
- **AND** a shorter paste is inserted as typed

#### Scenario: A chip is sent as the text it stands for
- **WHEN** the user sends a message that holds a chip
- **THEN** the message sent to the model, the prompt recorded, and the prompt recalled later all carry the pasted text in full, not the chip
- **AND** a chip whose characters the user has edited is plain text and is sent as it stands

#### Scenario: Paste at a chip expands it
- **WHEN** the user pastes while the cursor is on a chip or directly after it
- **THEN** the chip is replaced in place by the text it stands for

#### Scenario: Interrupt
- **WHEN** the user presses the interrupt key during a turn
- **THEN** the turn is cancelled and the session remains usable

#### Scenario: The exit key stops a turn first
- **WHEN** the user presses the exit key while a turn runs
- **THEN** the turn stops, and the draft in the composer is left as it is

#### Scenario: The exit key clears a draft before it counts toward leaving
- **WHEN** the user presses the exit key with no turn running and text in the composer
- **THEN** the composer is cleared, any chips with it, and the interface does not leave or arm leaving
- **AND** the cleared text is kept as a cleared prompt that Up recalls

#### Scenario: The exit key leaves from an empty composer
- **WHEN** the user presses the exit key with no turn running and an empty composer
- **THEN** the interface says to press it again to leave
- **AND** a second press within two seconds leaves

#### Scenario: The composer grows with its draft
- **WHEN** the draft is longer than one line
- **THEN** the composer grows a line at a time up to eight lines, after which it scrolls
- **AND** it returns to one line when the draft is cleared or sent

#### Scenario: Count a long draft
- **WHEN** the draft is longer than two lines
- **THEN** a count of its lines and characters is shown at the composer's corner, and in words when the interface draws without marks

### Requirement: Session History Persistence
JamCLI SHALL persist each session as an event log under `.jamcli/history/` from every
surface and SHALL allow resuming a previous session with its tool context.

#### Scenario: Persist a turn
- **WHEN** a turn runs on any surface
- **THEN** JamCLI appends its events to the session file as they happen

#### Scenario: Resume a session
- **WHEN** the user runs `/resume` and selects a session, or passes `--resume` or `--continue`
- **THEN** JamCLI loads that session's messages, tool calls, and results
- **AND** continues appending to the same session file

#### Scenario: Resume a session with no messages
- **WHEN** the selected session contains no messages
- **THEN** JamCLI reports that the session cannot be resumed and keeps the current one

#### Scenario: Record what was typed
- **WHEN** the person sends a message, a `!` shell line, a `#` note, or a slash command from the interface, or clears a draft
- **THEN** the session file gains a prompt event holding the text as it was typed, with pasted text in full, and whether it was sent or cleared
- **AND** the prompt event is never sent to the model and does not count as a message

#### Scenario: Prompts outlive compaction
- **WHEN** the session is compacted and later resumed
- **THEN** every prompt recorded before the compaction is still listed, as typed

#### Scenario: A log with no prompt events still loads
- **WHEN** a session written before prompt events existed is resumed or exported
- **THEN** it loads and projects exactly as before
- **AND** the interface lists its earlier messages from the conversation it holds

### Requirement: Todo Acceptance Checks
JamCLI SHALL let a todo item carry a check, the test, command, or observation that proves
it done, and SHALL show it wherever the item is shown. The interface SHALL draw the list as
a board whose state is read by mark and color, that stays up while a call waits, and that
shows what runs beside the turn.

#### Scenario: Write an item with a check
- **WHEN** the model calls `todo_write` with an item that has a `check`
- **THEN** the check is persisted with the item and returned by `todo_read`
- **AND** the list the model and the interface see shows the check beside the item

#### Scenario: Show the checklist in the interface
- **WHEN** the model writes a todo list or the plan in the interface
- **THEN** the board appears above the composer on its own, its header the whole plan as a strip of marks with the count of steps done and what the turn is doing, and the plan's path when there is one
- **AND** each step is a mark and a color for its state: done in the settled tone, running in the accent with how long it has run, pending in the text color, with the running step's check behind a rail beneath it
- **AND** screen reader mode reads the same facts as lines of words, each step's state a word in brackets and its check beneath it
- **AND** the todos key hides and shows it

#### Scenario: The board stays up beside a prompt
- **WHEN** a call waits for the person's decision while the board is shown
- **THEN** the board is still drawn, above the prompt, with its running step and its clock

#### Scenario: The board lists what runs beside the turn
- **WHEN** a background command or a child agent of the session is running
- **THEN** the board lists it on one line: its state, what it is, and its label, with what it is doing now, how long it has run, its tokens, and its cost, and for a command the `/jobs stop` that ends it
- **AND** a label too long for the line is cut before its facts are
- **AND** a child that is asking for a decision keeps the warning color
- **AND** the line goes when it ends, after a moment in which it can still be opened

#### Scenario: A long step wraps in a few lines
- **WHEN** the running step's text, with its check, is longer than a line
- **THEN** it wraps to at most four lines and the other steps stay one line each

#### Scenario: Down chooses an agent
- **WHEN** the composer is empty, nothing is queued, and the board lists a child agent
- **THEN** Down chooses the child that runs, or the first when none runs, and Down and Up move the choice
- **AND** Enter looks in on the chosen child and Escape lets go of the choice
- **AND** Up on the first child lets go of the choice, so the next Up recalls a prompt

#### Scenario: Down takes back a queued message first
- **WHEN** the composer is empty and a message is queued
- **THEN** Down takes the last queued message back into the composer and does not choose an agent

#### Scenario: What can be chosen is what is listed
- **WHEN** a child has ended and left the board, by the time passing or by the next message sent, with or without motion reduced
- **THEN** it is no longer drawn, cannot be chosen, and a choice held on it is let go
- **AND** the board's hint names the keys whenever a child can be chosen, running or ended

#### Scenario: Completion means the check passed
- **WHEN** the model reads the `todo_write` tool's description
- **THEN** it is told an item is marked completed only after its check has passed
