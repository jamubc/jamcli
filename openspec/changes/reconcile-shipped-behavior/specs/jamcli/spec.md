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
- **THEN** the transcript keeps rows above it, and a preview too long for the rest is cut with a note of how much remains
- **AND** the page keys scroll the transcript while the prompt waits

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

### Requirement: Model Discovery
JamCLI SHALL discover models from the configured providers rather than requiring a
hand-maintained list, and SHALL show catalog information for each.

#### Scenario: Discover models from a compatible endpoint
- **WHEN** the model selector opens for a configured endpoint
- **THEN** JamCLI queries that endpoint's models route and lists the results

#### Scenario: Discover Ollama models
- **WHEN** the model selector opens with Ollama active
- **THEN** JamCLI queries the Ollama tags endpoint and lists the returned model names

#### Scenario: Merge discovered and configured models
- **WHEN** configuration declares additional models for a provider
- **THEN** JamCLI lists discovered models and configured models together
- **AND** labels where each came from

#### Scenario: Report a reachable failure
- **WHEN** model discovery fails for a provider
- **THEN** JamCLI reports the failure for that provider
- **AND** continues to list models for the others

#### Scenario: Select a model
- **WHEN** the user selects a model in the model selector
- **THEN** the session switches to it and JamCLI saves it as `model` in the user configuration
- **AND** subsequent turns, and new sessions, use that model unless a project sets its own

#### Scenario: View model details
- **WHEN** the user opens details for a model
- **THEN** the interface shows the model identifier, provider, description, context window, price, and whether it supports tool calling and reasoning

### Requirement: Approval-Gated State Changes
JamCLI SHALL require a decision before any state-changing action that the active mode and
rules do not already allow, and the decision SHALL come from the active surface.

#### Scenario: Request approval for a patch
- **WHEN** the model proposes a file change, edit, or patch that requires approval in the interactive interface
- **THEN** the interface presents the change with its diff for approval
- **AND** the change is made only after the user approves

#### Scenario: Request approval for a command
- **WHEN** the model proposes `run_command` and it requires approval
- **THEN** the interface presents the command, its working directory, and whether it will run sandboxed
- **AND** the command runs only after the user approves

#### Scenario: Reject a proposed action
- **WHEN** an action is rejected
- **THEN** it is recorded as rejected and the model receives a result saying so
- **AND** nothing is written to disk and no command runs

#### Scenario: Reject and continue
- **WHEN** the user rejects an action and chooses to let the turn go on
- **THEN** the model receives a result saying the call was denied and the turn continues

#### Scenario: Reject with feedback
- **WHEN** the user rejects an action and writes feedback
- **THEN** the feedback is given to the model and the turn continues

#### Scenario: Resolve approval in a non-interactive run
- **WHEN** a state-changing action is proposed in a headless run
- **THEN** the decision is resolved from the run's mode, rules, and flags
- **AND** an action that they do not allow is refused rather than prompted

#### Scenario: Record every decision
- **WHEN** any approval request is resolved
- **THEN** the transcript records the action, the decision, who decided, the surface, and the rule that applied

### Requirement: UI Style Configuration
JamCLI SHALL let the user choose and create status indicator styles.

#### Scenario: Choose a built-in style
- **WHEN** the user selects a status text style or spinner style
- **THEN** JamCLI persists the choice in the UI configuration
- **AND** the status indicator uses it on the next render

#### Scenario: Create a custom style
- **WHEN** the user creates a custom style
- **THEN** JamCLI writes a definition file into the project's status styles directory
- **AND** registers it for later selection

#### Scenario: Preview a style
- **WHEN** the user previews a status style
- **THEN** the interface renders the indicator using that style before it is saved

#### Scenario: Follow the theme
- **WHEN** a style names a theme role, such as `accent` or `dim`, in place of a color
- **THEN** the indicator takes that role's color from the active theme
- **AND** a style name saved by an earlier version still resolves to a style

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
- **THEN** locally duplicated content is removed before the classification request is made

#### Scenario: Disable the gate
- **WHEN** the trust gate is disabled by configuration
- **THEN** tool results pass through unmodified
- **AND** the disabled state is visible in configuration

#### Scenario: Report the gate accurately
- **WHEN** the user inspects configuration or runs `jamcli doctor`
- **THEN** the reported gate state is the state that applies to the session's turns

### Requirement: Model Catalog
JamCLI SHALL resolve, for any configured model, its context window, output limit,
supported features, and price, from configuration, provider metadata, the models.dev
directory, a bundled table, or conservative defaults, in that order.

#### Scenario: Metadata from the provider
- **WHEN** a provider reports a model's context length or price
- **THEN** the catalog uses it unless configuration overrides it

#### Scenario: Metadata from the directory
- **WHEN** neither configuration nor the provider states a fact about a hosted model
- **THEN** the catalog takes it from a copy of the models.dev directory kept for an hour
- **AND** an Ollama model never consults the directory, and `JAMCLI_MODELS_DIRECTORY=off` turns it off

#### Scenario: Unknown model
- **WHEN** no source knows a model
- **THEN** conservative defaults apply and its price is reported as unknown rather than guessed

#### Scenario: Local context size
- **WHEN** an Ollama model is used
- **THEN** its context size is sent with each request so Ollama does not truncate silently

### Requirement: Credential Storage
JamCLI SHALL read provider credentials from environment variables or the operating
system's credential store, SHALL NOT write a credential into a project file, and SHALL
report credentials stored in project files.

#### Scenario: Store a key
- **WHEN** the user runs `jamcli auth set <provider>`
- **THEN** the key is stored in the credential store, or in a file readable only by the user when no store exists, with a warning

#### Scenario: Log in with OpenRouter
- **WHEN** the user runs `jamcli auth login openrouter`
- **THEN** JamCLI completes OpenRouter's PKCE flow through the browser and stores the resulting key

#### Scenario: Never write a key into the project
- **WHEN** the user runs `jamcli config set` with a provider key, alone or inside a section
- **THEN** it is written to the user configuration file when no scope is given
- **AND** a project or local scope is refused, naming the command that stores the key instead

#### Scenario: Key in a project file
- **WHEN** a provider key is found in a project configuration file
- **THEN** it still works, and `jamcli doctor` and `jamcli audit` report it as a finding
- **AND** each session says which file holds it and how to move it, without showing the key

### Requirement: Keybindings and Themes
JamCLI SHALL let the user rebind interface keys and choose light, dark, high-contrast, or
monochrome themes, and SHALL honor `NO_COLOR`.

#### Scenario: Rebind a key
- **WHEN** the keybindings file maps an action to another key
- **THEN** the interface uses that key and its help shows it

#### Scenario: No color
- **WHEN** `NO_COLOR` is set
- **THEN** the interface renders without color and every state remains distinguishable by symbol and text

#### Scenario: Selection in the theme
- **WHEN** text is selected, or a row is chosen in a list or a prompt
- **THEN** it is drawn in the theme's own selection or chosen-row colors, and inverted in monochrome
