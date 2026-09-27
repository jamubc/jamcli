## MODIFIED Requirements

### Requirement: Terminal User Interface
JamCLI SHALL provide an interactive terminal interface with a header, a scrollable
transcript, a multi-line composer, and a status line, rendering the same runtime events
every other surface receives.

#### Scenario: Launch the interface
- **WHEN** the user runs `jamcli` in a directory
- **THEN** the terminal interface renders
- **AND** input is focused in the composer

#### Scenario: Render a streaming reply
- **WHEN** a model response is streaming, with or without tool calls
- **THEN** the status line reports a thinking phase before first token and a streaming phase after
- **AND** the reply text appears incrementally in the transcript

#### Scenario: Show tool activity
- **WHEN** a tool call runs
- **THEN** the transcript shows it as a block with the tool, a summary of its arguments, its status, and its duration
- **AND** a click on the block shows or hides an edit's diff or the end of a command's output

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

#### Scenario: Handle a multi-line paste
- **WHEN** pasted content arrives inside bracketed paste markers
- **THEN** the composer normalizes line endings
- **AND** long pastes collapse into a preview rather than expanding the composer

#### Scenario: Interrupt
- **WHEN** the user presses the interrupt key during a turn
- **THEN** the turn is cancelled and the session remains usable

### Requirement: Tool Output Trust Gate
JamCLI SHALL, in auto mode, screen tool results for prompt injection before they enter
model context on every surface, with the classifier the user names, and SHALL bound and
delimit the output it sends to the classifier.

#### Scenario: Screen in auto mode only
- **WHEN** the permission mode is not auto
- **THEN** tool results enter context unscreened
- **AND** the gate reports nothing

#### Scenario: Choose the classifier
- **WHEN** `trust.model` names a model on any configured provider, a model on Ollama, or TypeSafe's Jev
- **THEN** that model classifies the results in auto mode
- **AND** no other model, such as an agent's, is used in its place

#### Scenario: No classifier in auto mode
- **WHEN** auto mode runs with no classifier configured
- **THEN** results pass through unscreened
- **AND** JamCLI says that the gate is off and how to set `trust.model`, once rather than on every turn

#### Scenario: Classify tool results
- **WHEN** tool results are about to be appended to context
- **THEN** JamCLI submits them in one batched classification request scoring each result for relevance and injection

#### Scenario: Delimit untrusted output
- **WHEN** tool output is placed in the classification request
- **THEN** it is escaped so it cannot close or forge the result delimiters
- **AND** it is truncated to the configured bound

#### Scenario: Drop an injection first
- **WHEN** a result is classified as an injection
- **THEN** it is removed before relevance filtering is applied
- **AND** the transcript records that a result was removed and why

#### Scenario: Fail open
- **WHEN** the classification request fails, times out, or returns an unusable response
- **THEN** the unmodified results are kept
- **AND** the failure is reported without blocking the turn

#### Scenario: Never fall back to an injection
- **WHEN** filtering leaves no results
- **THEN** JamCLI returns an empty result set
- **AND** does not reintroduce a result that was classified as an injection

#### Scenario: Deduplicate before classifying
- **WHEN** tool results are prepared for screening
- **THEN** locally duplicated content is sent to the classifier once
- **AND** each duplicate takes the verdict of the result it repeats, and is never withheld for being a duplicate

#### Scenario: Leave the session's own state alone
- **WHEN** a result comes from a tool that reports only the session's own state, such as the todo list
- **THEN** it is not screened and enters context unmodified

#### Scenario: Disable the gate
- **WHEN** the trust gate is disabled by configuration
- **THEN** tool results pass through unmodified
- **AND** the disabled state is visible in configuration

#### Scenario: Report the gate accurately
- **WHEN** the user inspects configuration or runs `jamcli doctor`
- **THEN** the reported gate state is the state that applies to the session's turns

### Requirement: Observability
JamCLI SHALL provide structured logs with verbosity levels, a local trace of sessions,
turns, model requests, and tool calls, and an optional OpenTelemetry export that is off
by default.

#### Scenario: Verbose output
- **WHEN** the user passes `-v` or `-vv`
- **THEN** informational or debug records are written to the log without any credential

#### Scenario: Local trace
- **WHEN** the user passes `--trace-file`
- **THEN** spans for the session, turns, model requests, tool calls, and hooks are written to that file

#### Scenario: Export to a collector
- **WHEN** OpenTelemetry export is enabled with an endpoint
- **THEN** traces and usage metrics are sent using the GenAI semantic conventions
- **AND** prompt and output content are excluded unless explicitly enabled

#### Scenario: Off by default
- **WHEN** nothing is configured
- **THEN** no telemetry leaves the machine

#### Scenario: The default log says what went wrong
- **WHEN** the log is at its default level
- **THEN** a failed tool call is logged with the first line of why it failed
- **AND** a prompt left unanswered when its turn ended, or a turn stopped after a long wait on a prompt, is logged as a warning with how long it waited

## ADDED Requirements

### Requirement: Delegated Approvals
JamCLI SHALL ask the person about a foreground child's call that needs a decision on the
surface of the session that delegated, and SHALL show there what the call went on to do.

#### Scenario: Answer a child's prompts in turn
- **WHEN** a foreground child's calls need a person's decision, one after another
- **THEN** each prompt is shown on the delegating session's surface
- **AND** each is taken down once answered, so the next can be read and answered

#### Scenario: Show what an answered call did
- **WHEN** a child's call the person answered finishes
- **THEN** the delegating surface shows its result where the prompt was
- **AND** the delegating session's transcript records the person's answer
