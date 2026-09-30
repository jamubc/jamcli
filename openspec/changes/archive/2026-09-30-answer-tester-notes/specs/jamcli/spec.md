# Spec Delta

## ADDED Requirements

### Requirement: Session Reports
JamCLI SHALL write, when the person asks with `/report`, one Markdown report of the current
session that carries every tester note with the facts needed to act on them.

#### Scenario: Report a session
- **WHEN** the person runs `/report`
- **THEN** they are asked whether to include the session log, and for an optional message that Enter skips
- **AND** `.jamcli/reports/<session>-<time>.md` is written with the session's id and name, the time, JamCLI's version, the model, the effort, the context usage at that moment, the cost, every note with its time, and the message

#### Scenario: Give the message inline
- **WHEN** the person runs `/report` followed by text
- **THEN** that text is the report's message and only the log question is asked

#### Scenario: Include the log
- **WHEN** the person chooses to include the session log
- **THEN** the report carries the session rendered as Markdown and the path of its log file

#### Scenario: Report without a screen
- **WHEN** `/report` runs headless or over ACP
- **THEN** the questions are answered with `/choose` or `--choose`, and the report's text is shown with where it was written

### Requirement: Session Identity
JamCLI SHALL let the person name a session and give it a color, record both in its log,
and accept the name wherever a session id is accepted.

#### Scenario: Rename a session
- **WHEN** the person runs `/rename fix-auth`
- **THEN** a `name` event is recorded, the header shows the name beside the id, and the session index carries it

#### Scenario: Keep names one word and unique
- **WHEN** the name has spaces, other characters, or is held by another session of the project
- **THEN** spaces become `-`, and a name with other characters or held elsewhere is refused with the reason

#### Scenario: Resume by name
- **WHEN** the person runs `/resume fix-auth` or `jamcli --resume fix-auth`
- **THEN** the session named `fix-auth` opens, as it would by its id

#### Scenario: Color a session
- **WHEN** the person runs `/color blue`
- **THEN** a `color` event is recorded, and the interface draws the composer's border in blue and tints the status line with it
- **AND** a resumed session keeps its color, and `/color default` returns to the theme's

#### Scenario: Color without a screen
- **WHEN** `/color` runs headless or over ACP
- **THEN** the color is recorded and the command says it shows where there is a screen

### Requirement: Keep Awake
JamCLI SHALL keep a macOS machine from idle sleep while a session works or waits on a
wake, and SHALL release it when neither holds.

#### Scenario: Stay awake through a turn
- **WHEN** a turn runs on macOS and `caffeinate` is present
- **THEN** `caffeinate -i -w <JamCLI's pid>` runs until the turn ends and no wake is pending

#### Scenario: Stay awake for a wake
- **WHEN** a wake is pending between turns
- **THEN** the machine is kept awake until it goes off or is cancelled

#### Scenario: Nothing to run
- **WHEN** the platform is not macOS, `caffeinate` is absent, or the run is delegated
- **THEN** nothing is started, and the session works as before

### Requirement: Wakes and Flags
JamCLI SHALL run a prompt in a session later, when a time comes or when named sessions
have raised a flag, through a tool the model calls and a command the person types, and
SHALL let sessions raise and lower flags any JamCLI on the machine can read.

#### Scenario: Set a timer
- **WHEN** the model calls `wake` with `set`, a prompt, and `after_seconds`, or the person runs `/wake in 10m <prompt>`
- **THEN** a `wake` event is recorded with its id, and the prompt runs as a turn once the time has passed
- **AND** it reaches the model as a bracketed harness line naming the wake, who set it, and why it went off, followed by the prompt

#### Scenario: Only removal stops a wake
- **WHEN** the person sends a message before a wake goes off
- **THEN** the wake stays pending, and goes off unless `/wake cancel` or the tool's `cancel` removed it

#### Scenario: Wait for flags
- **WHEN** a wake names sessions and a flag, as `/wake when 2026-09-29-1a6a254d fix-auth raise green: <prompt>` does
- **THEN** it goes off at the first check after every named session has that flag raised, and not before

#### Scenario: Raise and lower flags
- **WHEN** the person runs `/flag green`, or the model calls `flag` with `raise`
- **THEN** the flag is raised on this session in the state directory's flag board and recorded as a `flag` event
- **AND** it stays raised after the session closes, until `/flag lower green` or the tool's `lower` lowers it

#### Scenario: Deliver on every surface
- **WHEN** a wake goes off
- **THEN** the interface sends it behind any running turn, headless waits for pending wakes before it exits, and ACP and the MCP server run it as a turn of the session

#### Scenario: Resume with wakes
- **WHEN** a session with pending wakes is resumed
- **THEN** wakes still ahead are set again, and timers that came due while it was closed are reported as missed and recorded, not run

#### Scenario: Refuse what cannot be kept
- **WHEN** a wake names a session JamCLI does not know, asks for less than one second or more than seven days, or would make more than twenty pending
- **THEN** it is refused with the reason, and nothing is set

### Requirement: Session References
JamCLI SHALL recognize session ids, and names the session index holds, in a prompt, and
tell the model where each session is.

#### Scenario: Tell the model about named sessions
- **WHEN** a prompt names a known session
- **THEN** the model receives, with that prompt, a bracketed harness line per session with its project, log path, note count, and raised flags

#### Scenario: Highlight references
- **WHEN** a sent message names a known session, or starts with a command
- **THEN** the interface draws that word in the accent color

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
- **AND** notes are never sent to the model, except to a reflection as the person frames them

#### Scenario: Collapse many notes
- **WHEN** more than three notes are pinned
- **THEN** they take one row: the note in view, its place among them, and the count, newest first
- **AND** the mouse wheel over the row moves through them one at a time, and hovering shows the one in view whole

#### Scenario: List every note
- **WHEN** the user runs `/notes`, or `/note` with nothing after it
- **THEN** every note of the session is listed with its time, oldest first

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

### Requirement: Session Reflection
JamCLI SHALL, only when the user asks, reflect on the current session and propose delta
edits to skills, rules, or agents that the user approves before anything is written. The
session's tester notes SHALL reach the reflection only as the person frames them.

#### Scenario: Findings cite evidence
- **WHEN** a reflection finding cites no recorded event, or an unknown one
- **THEN** the finding is dropped before it is shown

#### Scenario: Known lessons are dropped
- **WHEN** a proposal restates a loaded rule, skill, or `AGENTS.md`
- **THEN** it is dropped before it is shown

#### Scenario: Nothing is written unapproved
- **WHEN** a proposed edit is shown
- **THEN** no file changes until the user approves that edit, and only its target section changes

#### Scenario: Nothing survives
- **WHEN** every finding is dropped
- **THEN** the user is told that reflection found nothing new

#### Scenario: Warn on governed skills
- **WHEN** a proposed edit touches a skill that bundles scripts or declares `allowed-tools`
- **THEN** the diff carries a safety warning

#### Scenario: Only on request
- **WHEN** a turn is not a reflection the user asked for
- **THEN** the reflection tools are not offered to the model and cannot be called

#### Scenario: Replace the prompt
- **WHEN** the project or the user has a skill named `reflect`
- **THEN** `/reflect` follows that skill instead of the built-in prompt

#### Scenario: Frame the notes first
- **WHEN** the person runs `/reflect` in a session that has tester notes
- **THEN** the person is asked how to read them before the model sees any: feature ideas, concerns about the model, bugs in JamCLI, their own words, or leave them out; headless answers with `--choose`
- **AND** the answer is recorded as a `reflection` event before the turn starts

#### Scenario: Reflect on framed notes
- **WHEN** the notes are kept
- **THEN** `session_signals` lists each as a `note` signal with its id under the framing, and a lesson may cite it

#### Scenario: Leave the notes out
- **WHEN** the person chooses to leave them out, or the session has none
- **THEN** no note reaches the model

### Requirement: Transcript Event Log
JamCLI SHALL record each session as an append-only event log from which any run can be
explained afterward and from which every other session view is derived.

#### Scenario: Record what happened
- **WHEN** a turn runs
- **THEN** the log records the user input, each assistant message with its tool calls, each tool result with its status, each approval decision with who decided and which rule applied, notices, usage, and cost

#### Scenario: Resume with tool context
- **WHEN** a session whose turns included tool calls is resumed
- **THEN** the next request contains those calls and their results

#### Scenario: Read older history
- **WHEN** a session file written before this format is listed, resumed, or exported
- **THEN** it loads without migration and is never rewritten

#### Scenario: Redact secrets
- **WHEN** tool output contains the value of a credential present in the environment or the credential store
- **THEN** the value is replaced by a marker naming its source before it reaches the model or the log

#### Scenario: Record session identity and wakes
- **WHEN** the person renames or colors a session, frames notes for a reflection, raises or lowers a flag, or a wake is set, cancelled, goes off, or is missed
- **THEN** a `name`, `color`, `reflection`, `flag`, or `wake` event is appended, and none of them is sent to the model as a message
