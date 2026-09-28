# Spec Delta

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
- **AND** long pastes collapse into a preview rather than expanding the composer

#### Scenario: Interrupt
- **WHEN** the user presses the interrupt key during a turn
- **THEN** the turn is cancelled and the session remains usable
