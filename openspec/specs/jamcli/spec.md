# JamCLI Specification

## Purpose

Current behavior as built. This file describes what JamCLI does today and is updated
only when a change is archived, never while a change is open. Proposals to alter this
behavior live in `openspec/changes/`.

## Requirements

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

### Requirement: Slash Command Surface
JamCLI SHALL provide slash commands through the composer, with a palette shown when the
user types `/`, including built-in commands, custom commands, skill-provided commands,
and MCP prompts. Built-in commands SHALL be defined once, outside the interface, and every
one SHALL be reachable on every surface.

#### Scenario: List available commands
- **WHEN** the user types `/` in the composer
- **THEN** the palette lists at least `/help`, `/model`, `/mode`, `/permissions`, `/context`, `/cost`, `/compact`, `/clear`, `/resume`, `/fork`, `/rewind`, `/undo`, `/diff`, `/commit`, `/tools`, `/mcp`, `/skills`, `/hooks`, `/plugins`, `/workflows`, `/config`, `/theme`, `/doctor`, `/export`, `/copy`, `/profile`, `/jobs`, and `/exit`
- **AND** shows the source of each custom command

#### Scenario: Configure the provider
- **WHEN** the user runs `/config provider`
- **THEN** the interface offers the configured providers and custom endpoints
- **AND** API keys are masked when displayed

#### Scenario: Manage tool permissions
- **WHEN** the user runs `/permissions`
- **THEN** the interface lists the active mode and every rule with its scope, and lets the user add or remove rules

#### Scenario: See and stop the work running beside the turn
- **WHEN** the user runs `/jobs`
- **THEN** every background command and child agent of the session is listed with its identifier, what it is, how long it has run, and how it ended if it has
- **AND** `/jobs stop <id>` stops the one named, whether a turn runs or not, and says so

#### Scenario: Every built-in command has one definition
- **WHEN** any built-in command is run in the interface, headlessly, or over ACP
- **THEN** the same definition of it runs
- **AND** what only a terminal can do, such as repainting in a new theme, is done where there is one, while the rest of the command, such as saving the theme, is done everywhere

#### Scenario: A choice without a terminal
- **WHEN** a command offers a choice on a surface with no terminal
- **THEN** the choices are listed with their keys
- **AND** `/choose <key>` answers it, or headless `--choose <key>` answers it in advance

### Requirement: Project Root Discovery
JamCLI SHALL resolve the project root by walking up from the current directory until it
finds a `.jamcli` directory.

#### Scenario: Launch from a subdirectory
- **WHEN** the user runs `jamcli` from any directory beneath a project root
- **THEN** JamCLI uses the `.jamcli` configuration of that project root
- **AND** reads and writes history in that project root

#### Scenario: Launch with no project root
- **WHEN** no `.jamcli` directory exists in the current directory or any ancestor
- **THEN** JamCLI falls back to the current directory as the project root

### Requirement: Provider Configuration
JamCLI SHALL support a local provider, any OpenAI-compatible endpoint, and a translated
Anthropic-shaped endpoint on every surface, and SHALL NOT present providers it cannot
serve.

#### Scenario: Configure Ollama
- **WHEN** the user sets the Ollama endpoint
- **THEN** JamCLI persists it in `.jamcli/config.json` under `api_registry.ollama.endpoint`

#### Scenario: Configure OpenRouter
- **WHEN** the user supplies an OpenRouter API key, names an environment variable holding it, or logs in with `jamcli auth login openrouter`
- **THEN** JamCLI uses that credential for subsequent OpenRouter requests

#### Scenario: Configure a custom compatible endpoint
- **WHEN** the user registers an endpoint with an identifier and a base URL
- **THEN** JamCLI persists it and offers it as a provider in the model selector

#### Scenario: Configure an Anthropic-shaped endpoint
- **WHEN** the user registers an endpoint that speaks the Anthropic Messages format
- **THEN** JamCLI translates requests and responses through the Anthropic seam

#### Scenario: Same provider on every surface
- **WHEN** a profile selects any supported provider
- **THEN** the interface, headless runs, and ACP sessions all use that provider

#### Scenario: Reject an unconfigured provider
- **WHEN** a provider is requested that has no endpoint or credential configured
- **THEN** JamCLI reports the provider as unconfigured
- **AND** names the configuration key that would enable it

#### Scenario: Keep credentials out of the project file
- **WHEN** a provider supports reading its key from the environment or the credential store
- **THEN** JamCLI prefers those over a value stored in configuration

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

### Requirement: Read-Only Tool Execution
JamCLI SHALL execute read tools without approval in the default mode, constrained to the
project root after resolving symbolic links, and SHALL resolve them through the tool
registry with real JSON Schemas.

#### Scenario: List files by pattern
- **WHEN** the model requests `glob` with a pattern
- **THEN** JamCLI returns matching paths ordered by most recently modified
- **AND** respects `.gitignore`, `.ignore`, and the configured ignore patterns

#### Scenario: Read a file range
- **WHEN** the model requests `read_file` with a path and optional line window
- **THEN** JamCLI returns the requested lines with their line numbers and anchors
- **AND** cuts overlong lines and reports when output was truncated
- **AND** refuses binary files with their size

#### Scenario: Search by regular expression
- **WHEN** the model requests `grep` with a pattern
- **THEN** JamCLI returns matches with file, line, and requested context, file names only, or counts
- **AND** uses ripgrep when it is available and an equivalent walk otherwise, both honoring the same ignore rules

#### Scenario: Never stop silently
- **WHEN** a search reaches a time or result limit before covering every file
- **THEN** the result states that it was limited and how far it got

#### Scenario: List files
- **WHEN** a tool call, a permission rule, or a profile names `list_files`
- **THEN** JamCLI serves it as `glob`, with the same ignore rules
- **AND** the model is offered only `glob`

#### Scenario: Search code
- **WHEN** a tool call, a permission rule, or a profile names `search_code`
- **THEN** JamCLI serves it as `grep`, with the same ignore rules
- **AND** the model is offered only `grep`

#### Scenario: Refuse a path outside the project
- **WHEN** a read or list target resolves outside the project root, including through a symbolic link
- **THEN** JamCLI rejects the call with a message stating the path escapes the project root

#### Scenario: Validate arguments
- **WHEN** a read tool call arrives with arguments that fail its schema
- **THEN** JamCLI returns a tool error naming the invalid argument
- **AND** does not execute the tool

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

### Requirement: Tool Permission Policy
JamCLI SHALL govern each tool call through the active permission mode and the permission
rules, SHALL let non-interactive runs constrain and extend tools with flags without
changing project configuration, and SHALL keep legacy per-tool settings working.

#### Scenario: Disable a tool
- **WHEN** a deny rule matches a whole tool
- **THEN** JamCLI does not offer that tool to the model on subsequent turns

#### Scenario: Require approval for a read tool
- **WHEN** an ask rule matches a read tool
- **THEN** that tool routes through the approval flow

#### Scenario: Allow a state-changing tool
- **WHEN** an allow rule matches a state-changing tool call
- **THEN** it runs without prompting in the interactive surface
- **AND** the rule is visible in configuration rather than implicit

#### Scenario: Allow a tool for one run
- **WHEN** `--allow-tool` names a tool
- **THEN** that tool runs without prompting in that run unless a deny rule matches it
- **AND** other tools keep the decisions they would otherwise have

#### Scenario: Constrain a non-interactive run
- **WHEN** `--deny-tool` is passed for a tool
- **THEN** that tool cannot run in the run regardless of any other configuration

#### Scenario: Default to gating
- **WHEN** no rule matches a state-changing tool call in the default mode
- **THEN** it requires approval

#### Scenario: Persist a permission change
- **WHEN** the user saves a permission rule or a project grant
- **THEN** JamCLI writes it to the configuration file of the chosen scope

#### Scenario: Read legacy settings
- **WHEN** `.jamcli/mcp.json` carries per-tool `allowed` and `require_approval` settings
- **THEN** JamCLI applies them as deny, ask, or allow rules

### Requirement: MCP Server Integration
JamCLI SHALL connect to MCP servers over stdio and streamable HTTP, on every surface, and
expose their tools, prompts, and resources.

#### Scenario: Connect to a server
- **WHEN** an enabled stdio server is configured
- **THEN** JamCLI spawns it with the configured command, arguments, declared environment variables, and working directory, and a minimal environment otherwise
- **AND** caches the connection for the session

#### Scenario: Namespace a discovered tool
- **WHEN** a server reports a tool
- **THEN** JamCLI exposes it as `<serverId>__<toolName>`
- **AND** preserves the native tool name for the call

#### Scenario: Use servers on every surface
- **WHEN** a session starts in the interface, headless, or over ACP
- **THEN** the configured servers' tools are available in that session

#### Scenario: Survive a failing server
- **WHEN** a configured server fails to start or list tools
- **THEN** JamCLI reports the failure
- **AND** continues with the remaining servers and built-in tools

#### Scenario: Test a server
- **WHEN** the user requests a server test
- **THEN** JamCLI connects, lists the server's tools, and reports their schemas

#### Scenario: Prompts and resources
- **WHEN** a server offers prompts or resources
- **THEN** prompts appear as slash commands and resources can be referenced with `@`

### Requirement: MCP Tool Discovery
JamCLI SHALL provide a `search_tools` meta-tool and SHALL defer MCP tool schemas behind it
only when the number of MCP tools exceeds a configured threshold, and SHALL NOT withhold
built-in tools based on the wording of the user's message.

#### Scenario: Search discovered tools
- **WHEN** the model calls `search_tools` with a query
- **THEN** JamCLI returns tools whose name or description contains the query
- **AND** caps the result at the requested limit

#### Scenario: Many MCP tools
- **WHEN** the configured servers expose more tools than the threshold
- **THEN** their schemas are withheld from the request and the model discovers them through `search_tools`

#### Scenario: Select relevant tools per turn
- **WHEN** a turn is prepared
- **THEN** every built-in tool the permission engine does not deny is offered to the model, whatever the wording of the user's message
- **AND** only MCP tool schemas may be deferred, and only by the threshold

### Requirement: Behavior Profiles
JamCLI SHALL let the user switch between named behavior profiles that carry a system
prompt, a preferred model, a preferred provider, and a temperature.

#### Scenario: Switch profile
- **WHEN** the user selects a profile
- **THEN** JamCLI records it as active in `config.json`
- **AND** subsequent turns use that profile's system prompt, model, and temperature

#### Scenario: Override the system prompt
- **WHEN** a profile defines `system_prompt_override`
- **THEN** that text becomes the base system prompt for the session

#### Scenario: Edit the system prompt
- **WHEN** the user edits the system prompt through `/config prompt`
- **THEN** JamCLI writes the change to the active profile

### Requirement: Project Rules and Tool Guidance
JamCLI SHALL compose the system prompt from the active profile, the project rules
hierarchy, available skills, and tool guidance on every surface, and SHALL keep that
composition outside the UI layer.

#### Scenario: Load project instructions
- **WHEN** a session starts on any surface
- **THEN** JamCLI loads the instruction files between the project root and the working directory and includes them in the system prompt

#### Scenario: Describe available tools
- **WHEN** tools are available for a turn
- **THEN** the system prompt names the tools and their purpose
- **AND** instructs the model to inspect rather than guess
- **AND** does not instruct the model to emit a JSON action block

#### Scenario: Compose outside the interface
- **WHEN** the system prompt is built
- **THEN** it is built by the core
- **AND** the interface only displays the result

#### Scenario: Show the effective prompt
- **WHEN** the user inspects configuration
- **THEN** JamCLI shows the effective system prompt that is actually sent and which parts came from the profile, the rules hierarchy, skills, and tool guidance

### Requirement: Context Management
JamCLI SHALL keep the conversation within the active model's context window by default,
using a configured strategy, without separating a tool call from its result.

#### Scenario: Budget from the model
- **WHEN** a session uses a model with a known context window
- **THEN** the compaction threshold is derived from that window less an output reserve and a margin

#### Scenario: Compress by summarization
- **WHEN** the estimated token count exceeds the threshold and the strategy is `summarize`
- **THEN** JamCLI summarizes the older turns into a single message stating the primary request, key technical concepts, and files and code sections discussed
- **AND** keeps the most recent turns verbatim

#### Scenario: Keep tool pairs together
- **WHEN** context is compressed or truncated
- **THEN** no assistant tool call is kept without its results and no result is kept without its call

#### Scenario: Compress by truncation
- **WHEN** the strategy is `truncate`
- **THEN** JamCLI drops the oldest whole turns until the budget fits
- **AND** always preserves the system prompt

#### Scenario: Report compression
- **WHEN** context is compressed or truncated
- **THEN** JamCLI surfaces a notice stating the before and after token counts

#### Scenario: Fall back after a failed summary
- **WHEN** the summarization call fails
- **THEN** JamCLI drops older whole turns instead and reports the failure

#### Scenario: Force compaction
- **WHEN** the user runs `/compact`, optionally with a focus
- **THEN** JamCLI compresses the context regardless of the threshold, steering the summary toward the focus

#### Scenario: Keep the todo list and plan through a summary
- **WHEN** a summary replaces older turns and the project has a todo list or a plan file
- **THEN** the summary message ends with the current todo list, each item with its status and check, and the plan file's path and size
- **AND** the session log rebuilds the same message

### Requirement: Token Accounting
JamCLI SHALL count tokens and cost for the conversation and for each model used,
including cached tokens where the provider reports them.

#### Scenario: Report session usage
- **WHEN** a request completes with provider usage data
- **THEN** JamCLI adds the prompt, completion, cached, and total token counts to the session usage

#### Scenario: Track usage per model
- **WHEN** a model produces usage data
- **THEN** JamCLI accumulates that model's counts and cost separately

#### Scenario: Request usage when streaming
- **WHEN** a streaming request is sent to an OpenAI-compatible endpoint
- **THEN** JamCLI asks the endpoint to include usage in the stream

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

### Requirement: Session Listing and Export
JamCLI SHALL list, search, show, fork, and export stored sessions from the command line
as well as the interface.

#### Scenario: List sessions
- **WHEN** the user runs `jamcli sessions list`
- **THEN** JamCLI returns the most recent sessions with their metadata

#### Scenario: Search sessions
- **WHEN** the user runs `jamcli sessions search` with a query
- **THEN** JamCLI returns sessions whose content matches, up to a limit

#### Scenario: Export a session
- **WHEN** the user runs `jamcli sessions export`
- **THEN** JamCLI renders the session, including tool calls, results, and decisions, as Markdown and writes the export to disk

#### Scenario: Fork a session from the command line
- **WHEN** the user runs `jamcli sessions fork <id>`
- **THEN** a new session is created from that transcript and the original is unchanged

#### Scenario: Keep session storage compatible
- **WHEN** sessions are listed, searched, or exported
- **THEN** existing session files under `.jamcli/history/` are read without migration

### Requirement: Workspace References
JamCLI SHALL expand `@` references in user input into file, directory, or MCP resource
content before sending the turn, on every surface.

#### Scenario: Reference a file
- **WHEN** the user writes `@path/to/file` in a message on any surface
- **THEN** JamCLI inlines that file's content into the turn
- **AND** caps a single file at 192 KB

#### Scenario: Reference a directory
- **WHEN** the user references a directory
- **THEN** JamCLI inlines its entries up to 128 entries

#### Scenario: Reference an MCP resource
- **WHEN** the user references `@server:uri`
- **THEN** JamCLI reads the resource from that server and inlines it

#### Scenario: Report a missing reference
- **WHEN** a referenced path does not exist
- **THEN** JamCLI reports the missing reference rather than silently dropping it

#### Scenario: Bound reference expansion
- **WHEN** a single message contains many references
- **THEN** JamCLI expands at most 12 operations per message

### Requirement: UI Style Configuration
JamCLI SHALL let the user choose and create status indicator styles, and a word style SHALL
be able to name the words the indicator shows for a phase, never replacing what the phase is.

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

#### Scenario: Words for a phase
- **WHEN** the chosen word style lists words for thinking, writing, or running a tool
- **THEN** while the indicator shows that phase it shows one of that phase's words, picked once when the phase begins and kept until the phase changes
- **AND** a phase the style lists no words for shows its own word, as every style without words does

#### Scenario: What words do not replace
- **WHEN** the session retries a request or compacts its context, or runs in screen reader mode or with reduced motion
- **THEN** the phase's own word is shown, whatever words the style lists

#### Scenario: A long word keeps the status line to its row
- **WHEN** the indicator shows a word longer than the phase's own
- **THEN** the rest of the status line is fitted to the room that word leaves, and the line does not run past the terminal's width

#### Scenario: A builtin style with words
- **WHEN** the user lists the word styles
- **THEN** one builtin style carries words for each of the three phases, and choosing it needs no file

### Requirement: Bounded Agent Loop
JamCLI SHALL bound each turn by configurable limits sized for multi-step work and SHALL
enforce them in the core rather than in the interface.

#### Scenario: Reach the step limit
- **WHEN** the loop reaches the configured maximum step count, 50 by default
- **THEN** JamCLI stops the loop and reports that the limit was reached
- **AND** the interface offers to continue
- **AND** the limit is readable and configurable rather than a constant in a component

#### Scenario: Bound tool calls per step
- **WHEN** a tool call cap is configured and a step returns more calls than it allows
- **THEN** JamCLI runs calls up to the cap and gives every remaining call a result stating it was not run because of the cap
- **AND** no cap applies when it is zero, the default

#### Scenario: Truncate tool output
- **WHEN** a tool returns more than the configured character limit, 30,000 by default
- **THEN** JamCLI keeps the beginning and the end, states how much was removed, and places the result in context
- **AND** the truncation limit is configurable per tool class

#### Scenario: Budgets
- **WHEN** a token or cost budget is configured for a run
- **THEN** the run stops when the budget is exceeded and reports it

#### Scenario: Enforce limits in the core
- **WHEN** a turn runs from any surface
- **THEN** the same limits apply
- **AND** no surface can raise them implicitly

### Requirement: Configuration Persistence
JamCLI SHALL persist project configuration under `.jamcli/`, SHALL create that directory
only when something must be stored there, and SHALL keep it out of version control.

#### Scenario: Initialize configuration
- **WHEN** JamCLI starts in a project with no `.jamcli` directory
- **THEN** it runs on built-in and user defaults without creating files

#### Scenario: Create the directory when needed
- **WHEN** JamCLI first needs to store history or project configuration
- **THEN** it creates `.jamcli/` with a `.gitignore` that ignores the directory's contents

#### Scenario: Keep secrets out of the repository
- **WHEN** `.jamcli/` exists in a git repository
- **THEN** git ignores it whether or not the repository's own `.gitignore` mentions it

#### Scenario: Toggle telemetry
- **WHEN** the user changes the telemetry setting
- **THEN** JamCLI persists it, and it defaults to disabled

### Requirement: Transport-Agnostic Agent Core
JamCLI SHALL implement the agent loop in a core module that imports neither the terminal
interface nor its rendering libraries, and SHALL expose it to every consumer through the
runtime factory.

#### Scenario: Run a turn without the terminal UI
- **WHEN** a caller creates a runtime and runs a prompt
- **THEN** the turn executes, tools dispatch, and results stream back
- **AND** no terminal UI module is loaded

#### Scenario: Emit events instead of importing UI
- **WHEN** the core produces output during a turn
- **THEN** it emits typed events for turn and step boundaries, text, reasoning, tool calls, tool progress, tool results, usage, retries, compaction, notices, and approval requests
- **AND** it never imports a component from the UI tree

#### Scenario: Resolve approval through a callback
- **WHEN** the core needs a decision on an action
- **THEN** it emits an approval request carrying a decision callback
- **AND** the consuming surface answers the callback

#### Scenario: Share one core across consumers
- **WHEN** the terminal UI, the headless invocation, the ACP server, and workflow steps each start a session
- **THEN** all of them drive the same runtime
- **AND** behavior differences come only from rendering, configuration, and how approvals are answered

#### Scenario: Keep conversation state between prompts
- **WHEN** a consumer sends a second prompt to the same session
- **THEN** the provider receives the earlier exchange with it

#### Scenario: Cancel a running turn
- **WHEN** a consumer cancels a session
- **THEN** the in-flight provider stream and running tool calls abort
- **AND** the session remains usable for the next turn

### Requirement: Single Tool Protocol
JamCLI SHALL invoke tools exclusively through native tool calls, SHALL NOT interpret prose
as tool requests, and SHALL stream every step of a turn.

#### Scenario: Advertise tools natively
- **WHEN** a turn is sent to a provider that supports tool calling
- **THEN** the available tools are sent as provider tool definitions with their real JSON Schemas
- **AND** the system prompt does not instruct the model to emit a JSON block

#### Scenario: Consume a native tool call
- **WHEN** the provider returns tool calls
- **THEN** JamCLI dispatches each call through the tool registry
- **AND** appends the results as tool result messages

#### Scenario: Stream with tools
- **WHEN** tools are offered for a turn
- **THEN** the model's text and reasoning stream to the surface as they arrive

#### Scenario: Reject prose that resembles a tool request
- **WHEN** model text contains a fenced JSON block naming a tool
- **THEN** JamCLI treats that block as ordinary text and does not execute it

#### Scenario: Report an unusable tool call
- **WHEN** a returned tool call names an unknown tool or carries arguments that fail schema validation
- **THEN** JamCLI returns a tool error to the model naming the failure
- **AND** the turn continues rather than aborting

### Requirement: Tool Registry
JamCLI SHALL resolve tools from a registry in which each tool declares its name,
description, JSON Schema, policy class, and runner, and every surface SHALL offer tools
from that registry.

#### Scenario: Register a tool
- **WHEN** a tool is added to the registry
- **THEN** it becomes available to the model on every surface, to permission configuration, and to the approval flow without changes to any surface module

#### Scenario: Declare a policy class
- **WHEN** a tool is registered
- **THEN** it declares whether it reads, writes, executes, uses the network, or delegates
- **AND** tools that do not only read are subject to approval by default

#### Scenario: Validate arguments before dispatch
- **WHEN** a tool call arrives
- **THEN** its arguments are validated against the tool's JSON Schema before the runner executes
- **AND** a validation failure produces a tool error rather than an exception

#### Scenario: Expose schemas to MCP discovery
- **WHEN** the available tool list is assembled for any surface or for MCP discovery
- **THEN** each tool contributes its real JSON Schema rather than a permissive placeholder

#### Scenario: Aliases
- **WHEN** a tool is registered as an alias of another
- **THEN** calls to it are dispatched to the target and it is not advertised separately

### Requirement: Filesystem Write Tools
JamCLI SHALL provide tools that write new files, edit existing files, and apply
multi-file patches under the project root, with replacement text applied literally.

#### Scenario: Write a new file
- **WHEN** the model calls `write_file` with a path and content
- **THEN** JamCLI requests approval unless the mode or a rule allows it
- **AND** writes the file only after it is allowed

#### Scenario: Refuse to overwrite silently
- **WHEN** `write_file` targets a path that already exists
- **THEN** JamCLI reports the conflict and requires an explicit overwrite decision

#### Scenario: Edit via find and replace
- **WHEN** the model calls `edit` with a path, a find string, and a replacement
- **THEN** JamCLI replaces the matched text literally, including any `$` sequences, and reports the changed range

#### Scenario: Replace every occurrence
- **WHEN** the model calls `edit` with `replace_all`
- **THEN** every occurrence is replaced and the count is reported

#### Scenario: Refuse an ambiguous edit
- **WHEN** the find string matches more than one location and neither an occurrence index nor `replace_all` is supplied
- **THEN** JamCLI rejects the edit and reports the number of matches

#### Scenario: Preserve line endings
- **WHEN** a file uses CRLF line endings
- **THEN** edits and patches keep CRLF line endings

#### Scenario: Apply a multi-file patch
- **WHEN** the model calls `apply_patch` with a unified diff touching several files
- **THEN** JamCLI validates every hunk before writing and applies all of them or none

#### Scenario: Refuse a path outside the project
- **WHEN** a write, edit, or patch target resolves outside the project root, including through a symbolic link
- **THEN** JamCLI rejects the call

### Requirement: Edit Reliability
JamCLI SHALL anchor edits to the file state the model actually read, and SHALL reject
an edit whose anchor no longer matches.

#### Scenario: Return stable anchors on read
- **WHEN** `read_file` returns content
- **THEN** each returned line carries an anchor identifying its content
- **AND** the anchors are stable for unchanged content

#### Scenario: Apply an anchored edit
- **WHEN** the model edits by referencing returned anchors
- **THEN** JamCLI applies the change and reports the lines affected

#### Scenario: Reject a stale edit
- **WHEN** the referenced anchors no longer match the file on disk because it changed since the read
- **THEN** JamCLI rejects the edit, states that the file changed, and returns fresh anchors
- **AND** the file on disk is left unmodified

#### Scenario: Detect an external change between turns
- **WHEN** a file read in an earlier turn is edited externally
- **THEN** a subsequent anchored edit against the old anchors is rejected rather than applied to the wrong lines

### Requirement: Generic Provider Endpoints
JamCLI SHALL route every OpenAI-compatible provider through a single client, SHALL allow
new endpoints to be added by configuration alone, and SHALL retry transient failures and
report provider errors with their cause.

#### Scenario: Add a compatible endpoint
- **WHEN** the user configures an endpoint with a base URL
- **THEN** JamCLI sends chat completions to that endpoint without a new provider implementation

#### Scenario: Discover models from an endpoint
- **WHEN** a configured endpoint exposes a models route
- **THEN** JamCLI lists those models in the model selector

#### Scenario: Read a key from the environment
- **WHEN** an endpoint declares a key environment variable
- **THEN** JamCLI reads the key from that variable
- **AND** does not require the secret to be stored in the project configuration

#### Scenario: Send streaming and non-streaming requests
- **WHEN** a request is issued in either mode
- **THEN** both modes parse content, reasoning deltas, tool calls, and usage through the same client

#### Scenario: Retry transient failures
- **WHEN** a request fails with a network error or a rate limit, overload, or server error status
- **THEN** JamCLI retries with backoff, honoring any retry delay the provider sends, and reports each retry

#### Scenario: Report provider errors
- **WHEN** a request fails and is not retried
- **THEN** the error states the provider, the status, the provider's message, and a suggested fix

#### Scenario: Translate an Anthropic-shaped provider
- **WHEN** a provider speaks the Anthropic Messages format
- **THEN** JamCLI translates requests and streaming responses through one translation seam
- **AND** tool calls, signed reasoning blocks, and cache usage survive the translation

#### Scenario: Keep reasoning with its provider
- **WHEN** a conversation switches from one provider family to another
- **THEN** reasoning blocks produced by the first are not sent to the second

#### Scenario: Support a local endpoint with no account
- **WHEN** Ollama is the configured provider and no network is available
- **THEN** model listing and chat completion continue to work

#### Scenario: A model served only through the Responses API
- **WHEN** an OpenAI-compatible endpoint refuses a model on Chat Completions and serves it through the Responses API
- **THEN** JamCLI asks that model through the Responses API from then on
- **AND** every such request tells the endpoint to store nothing
- **AND** when an effort is set, the model's encrypted reasoning is sent back to the same family on the next call

### Requirement: Category-Based Model Routing
JamCLI SHALL resolve the model for a unit of work from a named agent that describes the
kind of work, not from a hardcoded model identifier, and SHALL keep loading the earlier
`categories` configuration as agents.

#### Scenario: Route by agent
- **WHEN** work is dispatched to a named agent
- **THEN** JamCLI resolves that agent to its configured model chain
- **AND** uses the first model in the chain that the active providers can serve

#### Scenario: Resolve a configured chain
- **WHEN** an agent defines an ordered list of models
- **THEN** JamCLI walks the list in order and skips models whose provider is not configured

#### Scenario: Fall back when a model is unavailable
- **WHEN** the first model in a chain cannot be reached
- **THEN** JamCLI advances to the next entry rather than failing the turn
- **AND** records which model actually served the work

#### Scenario: Keep the session model independent of routing
- **WHEN** a session runs on a user-selected model
- **THEN** agent routing applies only to delegated work
- **AND** the session model is unchanged

#### Scenario: Report the resolved model
- **WHEN** a request is routed
- **THEN** the resolved model and agent are visible in the transcript

#### Scenario: Normalize reasoning capability
- **WHEN** a chain entry requests a reasoning level
- **THEN** JamCLI normalizes that level against the target model's known capability
- **AND** drops or downgrades the level rather than sending an unsupported value
- **AND** the resulting level is the one the run serving the work uses

#### Scenario: Existing categories keep working
- **WHEN** configuration defines `categories` as named lists of models
- **THEN** each loads as an agent of that name with that chain, no description, and no rules
- **AND** it routes exactly as it did before

### Requirement: Delegated Task Execution
JamCLI SHALL delegate work to child agent runs that use the same runtime and tool
registry as the parent, and SHALL resolve each child's model and rules from its agent.
Consecutive foreground delegations in one step SHALL run together, and a child's start
and end SHALL be visible to the person.

#### Scenario: Delegate a task
- **WHEN** the model calls `task` with a prompt, naming an agent or relying on the configured default
- **THEN** JamCLI starts a child run in the project root with its own session
- **AND** returns the child's final result to the parent

#### Scenario: Delegate without naming an agent
- **WHEN** the model calls `task` without an agent and a default agent is configured
- **THEN** the child runs on the default agent
- **AND** when no default is configured, the call is refused with the agents named and no child starts

#### Scenario: Choose the reasoning for one task
- **WHEN** the model calls `task` with a reasoning level of off, on, or auto
- **THEN** that level replaces the chain entry's level for that child only
- **AND** it is normalized against the child's model like any other level

#### Scenario: Apply the agent's rules
- **WHEN** a child runs on an agent that has a rules body
- **THEN** the body is placed in the child's system prompt before the project's rules, so the project's rules win a conflict
- **AND** the parent does not receive it
- **AND** the transcript records the file the rules came from

#### Scenario: Children can do the work
- **WHEN** a child run needs to read, edit, or run a command
- **THEN** it has the same tools as the parent, governed by the delegated policy

#### Scenario: Resolve the child's model from its agent
- **WHEN** a child runs on an agent with a model chain
- **THEN** its model is resolved from that chain, not from the parent session
- **AND** when the agent has no chain, as the built-ins do not, the child runs on the model the parent session is using, whatever provider serves it

#### Scenario: Run a task in the background
- **WHEN** a task is requested in the background
- **THEN** the parent turn continues without waiting
- **AND** the result is retrievable when the child finishes
- **AND** the model is told when it finishes, appended to the next message it reads, as a background command's end is

#### Scenario: Retrieve a background result
- **WHEN** the model requests the output of a background task
- **THEN** JamCLI returns the result if complete, and the current status otherwise

#### Scenario: Cancel a background task
- **WHEN** a background task is cancelled
- **THEN** the child run terminates and its partial output is reported

#### Scenario: Foreground tasks in one step run together
- **WHEN** the model makes several consecutive `task` calls in one step
- **THEN** each that needs a decision is asked for in order, and every one allowed then runs at the same time as the others, up to the configured concurrency
- **AND** each call still gets exactly one result, in the order the calls were made

#### Scenario: Bound child permissions
- **WHEN** a child run needs a state-changing tool
- **THEN** it is governed by the policy configured for delegated runs
- **AND** a child cannot grant itself broader permissions than the parent

#### Scenario: A child's narrowing is its own
- **WHEN** a child loads a skill or runs under a command whose `allowed-tools` narrow what may run
- **THEN** only that child is narrowed, for the rest of its run
- **AND** the parent's calls, during and after the child, are decided as if the child had not narrowed
- **AND** what the parent's turn narrowed holds every child it starts, and no child can lift it

#### Scenario: Prevent unbounded nesting
- **WHEN** a child run would delegate further
- **THEN** delegation depth is bounded by configuration
- **AND** exceeding it returns an error instead of spawning another level

#### Scenario: A child is labeled by its title
- **WHEN** the model calls `task` with a title
- **THEN** that title labels the child wherever the person sees it: the plan board, the list of running work, the transcript line of the call, and every prompt the child raises
- **AND** when a caller gives no title, the child is labeled by its agent and the start of its prompt

#### Scenario: Ask once before a fan-out
- **WHEN** the `task` calls of one step name permission rules their children will need, and some of those rules would ask and would run once granted
- **THEN** before any of those children starts, the person is asked once about those rules, naming how many agents start
- **AND** the answers are to allow them for the session, to allow them for the project, or to let the children ask as they go
- **AND** a rule a call would already run under, one a rule or the mode denies, or one no grant could change, is not offered
- **AND** when no rule is left to offer, nothing is asked

#### Scenario: Stop before a fan-out starts
- **WHEN** the person stops the turn at the question before a fan-out
- **THEN** no child of that step starts, and each of the step's calls is answered that it did not run

### Requirement: Project Rules Hierarchy
JamCLI SHALL load project instruction files from the project root down to the working
directory and inject them into the system prompt.

#### Scenario: Load rules from ancestors
- **WHEN** a session starts in a subdirectory
- **THEN** JamCLI collects each instruction file found between the project root and the working directory
- **AND** injects them in order from outermost to innermost

#### Scenario: Apply conditional rules
- **WHEN** an instruction file declares a condition for a path or a file pattern
- **THEN** that section applies only when the condition matches the current work

#### Scenario: Report loaded rules
- **WHEN** the user inspects configuration
- **THEN** JamCLI lists every instruction file loaded and its resolved path

#### Scenario: Respect a missing rules file
- **WHEN** no instruction file exists
- **THEN** the session starts with the profile system prompt alone

### Requirement: Lifecycle Hooks
JamCLI SHALL expose lifecycle events that internal behavior, user-configured commands,
and plugins can observe and modify.

#### Scenario: Emit a lifecycle event
- **WHEN** a session starts, a prompt is submitted, a tool is about to run, a tool returns, a turn stops, context is about to be or has been compacted, a notification is raised, or a session ends
- **THEN** the corresponding event is emitted with its payload on every surface

#### Scenario: Register a hook
- **WHEN** a hook is registered for an event in code, in configuration, or by a plugin
- **THEN** it runs at that event and can inspect or modify the payload according to the event's contract

#### Scenario: Disable a hook
- **WHEN** a hook is disabled by configuration
- **THEN** it does not run
- **AND** the remaining hooks run normally

#### Scenario: Isolate a failing hook
- **WHEN** a hook throws or fails
- **THEN** the failure is reported as a notice, not as model output, and the turn continues

#### Scenario: Keep behavior out of components
- **WHEN** cross-cutting behavior such as context injection, output truncation, or continuation is implemented
- **THEN** it is implemented as a hook rather than inside a UI component

### Requirement: Delegation Audit
JamCLI SHALL provide an audit command that reviews agent definitions, rules files, skills,
hooks, plugins, tool permissions, and stored credentials for unsafe combinations.

#### Scenario: Run the audit
- **WHEN** the user runs `jamcli audit`
- **THEN** JamCLI scans instruction files, agent definitions, skill definitions, hook configuration, installed plugins, and permission rules in the project
- **AND** reports findings with a severity of critical, warning, or informational

#### Scenario: Flag the read-untrusted-plus-write combination
- **WHEN** a definition can both read untrusted content and write or execute
- **THEN** the audit reports it as critical

#### Scenario: Flag unnecessary tool access
- **WHEN** a definition holds a tool that its stated role does not require
- **THEN** the audit reports it as a warning

#### Scenario: Flag missing guardrails
- **WHEN** a definition lacks scope restriction, two-phase execution for writes, or error handling
- **THEN** the audit reports it

#### Scenario: Flag stored secrets and broad rules
- **WHEN** a provider key is stored in a project file or a rule allows every command
- **THEN** the audit reports it

#### Scenario: Report what the engine decides
- **WHEN** the audit reports what each tool may do
- **THEN** each verdict is the one the session's permission engine gives in the configured mode, from the same rules, with the rule and the file that decided it
- **AND** a tool whose calls the engine judges by their arguments, such as a command, is reported as depending on them rather than as one verdict

#### Scenario: Machine-readable output
- **WHEN** the user runs `jamcli audit --format sarif`
- **THEN** findings are emitted as SARIF

#### Scenario: Report without modifying
- **WHEN** the audit runs
- **THEN** it only reads and reports
- **AND** writes no files

### Requirement: Command Line Invocation
JamCLI SHALL support non-interactive invocation with machine-readable output and the same
tools, modes, rules, and built-in commands as the interactive surface.

#### Scenario: Run a prompt headlessly
- **WHEN** the user runs `jamcli -p "<prompt>"`, or pipes a prompt on standard input with `-p`
- **THEN** the turn runs without the terminal UI and the response is printed
- **AND** the process exits when the turn completes

#### Scenario: Run a built-in command headlessly
- **WHEN** the prompt names a built-in command, such as `jamcli -p "/compact"`
- **THEN** the command runs, its output is the response, and any turn it sends runs as a headless turn
- **AND** each `--choose <key>` answers the next choice the command offers

#### Scenario: Select the output format
- **WHEN** the user selects a text, json, or stream-json output format
- **THEN** the result is emitted in that format
- **AND** the json form carries the session identifier, status, response, error, duration, turn count, usage, cost, provider, model, and permission denials
- **AND** the stream-json form carries every event, including tool output and notices

#### Scenario: Report an exit code
- **WHEN** the run completes
- **THEN** the exit code is zero on success, one on refusal, limit, or provider error, two on a usage error, and 130 when interrupted

#### Scenario: Constrain tools non-interactively
- **WHEN** the user passes allow or deny tool flags, rule patterns, or a permission mode
- **THEN** those govern the run without prompting
- **AND** a denied tool cannot run under any flag combination

#### Scenario: Preview without changing
- **WHEN** the user passes `--dry-run`
- **THEN** the run executes in plan mode and reports the changes it would have made

#### Scenario: Bound the run
- **WHEN** the user supplies a maximum turn count or a working directory
- **THEN** the run honors both

#### Scenario: Continue a session
- **WHEN** the user passes `--continue`
- **THEN** the most recent session in the project root is resumed

#### Scenario: Resume a specific session
- **WHEN** the user passes `--resume` with a session identifier
- **THEN** that session is loaded and continued

#### Scenario: Fork a session
- **WHEN** the user runs `/fork`
- **THEN** a new session is created from the current transcript
- **AND** the original session is left unchanged

### Requirement: MCP Streamable HTTP Transport
JamCLI SHALL support connecting to MCP servers over streamable HTTP in addition to stdio,
SHALL negotiate the newest protocol version both sides support, and SHALL authorize to
servers that require OAuth.

#### Scenario: Configure an HTTP server
- **WHEN** a server declares an HTTP transport with a URL and optional headers
- **THEN** JamCLI connects over streamable HTTP

#### Scenario: Keep stdio as the default
- **WHEN** a server declares no transport
- **THEN** JamCLI treats it as stdio

#### Scenario: Negotiate the protocol version
- **WHEN** JamCLI connects to a server
- **THEN** it uses the 2026-07-28 protocol when the server supports it and the newest older version the server supports otherwise

#### Scenario: Authorize with OAuth
- **WHEN** a server requires OAuth authorization
- **THEN** JamCLI runs the authorization code flow with PKCE in the browser, validates the issuer, and stores the tokens in the credential store

#### Scenario: Answer an elicitation
- **WHEN** a server asks the user for input during a call
- **THEN** the interface prompts for it, or asks before opening the browser for a URL request

#### Scenario: Manage servers from the command line
- **WHEN** the user runs `jamcli mcp add`, `list`, `test`, or `remove`
- **THEN** JamCLI performs that operation against `.jamcli/mcp.json`
- **AND** preserves unrelated configuration in the file

#### Scenario: Report connection state
- **WHEN** a server fails to connect or its authorization is refused
- **THEN** JamCLI reports the server as configured but not connected, with the reason
- **AND** continues with the remaining tools

### Requirement: ACP Agent Surface
JamCLI SHALL serve the Agent Client Protocol over stdio through the protocol's reference
SDK so editors and orchestrators can drive it with the same runtime and the same built-in
commands as every other surface.

#### Scenario: Start the ACP server
- **WHEN** the user runs `jamcli acp`
- **THEN** JamCLI speaks ACP over stdio

#### Scenario: Announce capabilities
- **WHEN** a client initializes the session
- **THEN** JamCLI returns its capabilities, including session loading, and agent information

#### Scenario: Create a session
- **WHEN** the client creates a session with a working directory and MCP servers
- **THEN** JamCLI returns a session identifier, connects those servers, and advertises its model, profile, and permission mode options

#### Scenario: Keep the conversation
- **WHEN** the client sends a second prompt in a session
- **THEN** the model receives the earlier exchange with it
- **AND** the session is persisted to history

#### Scenario: Load a session
- **WHEN** the client loads an existing session
- **THEN** JamCLI replays its transcript as session updates and continues it

#### Scenario: Stream a prompt
- **WHEN** the client sends a prompt
- **THEN** JamCLI streams message chunks, thought chunks, tool calls with diffs for edits, tool call updates, and plans
- **AND** completes the request when the turn ends

#### Scenario: Offer and run built-in commands
- **WHEN** a session is created or loaded
- **THEN** JamCLI offers every built-in command, beside custom commands and MCP prompts
- **AND** a prompt naming one runs it, its output streamed as message chunks

#### Scenario: Map permission decisions
- **WHEN** a tool call needs approval
- **THEN** JamCLI asks the client for permission with options to allow once, allow always, reject once, or reject always
- **AND** applies the client's decision as a grant or a denial

#### Scenario: Change the mode
- **WHEN** the client sets the session mode
- **THEN** JamCLI switches to the corresponding permission mode

#### Scenario: Use the editor's files and terminals
- **WHEN** the client advertises file system or terminal capabilities
- **THEN** JamCLI reads and writes open files through the client and can run commands in its terminals

#### Scenario: Cancel a turn
- **WHEN** the client cancels
- **THEN** the in-flight turn stops and the session remains usable

### Requirement: ACP Client Surface
JamCLI SHALL act as an ACP client through the protocol's reference SDK so it can delegate
to other agents instead of reimplementing them.

#### Scenario: Configure an external agent
- **WHEN** an agent command is configured
- **THEN** JamCLI can start it and open a session

#### Scenario: Delegate to an external agent
- **WHEN** the model or the user requests delegation to a configured agent with a prompt
- **THEN** JamCLI initializes the agent, opens a session in the project root, sends the prompt, and returns the result

#### Scenario: Expose delegation as a tool
- **WHEN** delegation is enabled
- **THEN** the model can call a delegation tool and a status tool for running delegations

#### Scenario: Apply the local policy to delegation
- **WHEN** a delegated agent requests permission for a state-changing action
- **THEN** JamCLI answers from its own permission engine
- **AND** the default policy requires a human decision in the interactive surface

#### Scenario: Cancel a delegation
- **WHEN** the user cancels
- **THEN** the delegated session is cancelled and the external process ends

### Requirement: Session Runtime Assembly
JamCLI SHALL assemble every session through one runtime factory that builds the provider,
tool registry, permission engine, sandbox, rules, hooks, context management, and
transcript, and every surface SHALL obtain its session from that factory.

#### Scenario: Identical tools across surfaces
- **WHEN** the interface, a headless run, and an ACP session are started in the same project with the same configuration
- **THEN** the model is offered the same tools with the same schemas on all three

#### Scenario: Surfaces differ only in presentation and approval
- **WHEN** the same scripted conversation runs through each surface
- **THEN** the provider requests and the recorded transcripts are identical apart from session identifiers, timestamps, and the recorded deciding surface

#### Scenario: Registration reaches every surface
- **WHEN** a tool is added to the registry, by a built-in, an MCP server, a skill, or a plugin
- **THEN** every surface offers it without a change to any surface module

### Requirement: Honest Tool Batches
JamCLI SHALL give every tool call the model makes exactly one recorded result, and SHALL
never drop a call silently.

#### Scenario: Approval in the middle of a batch
- **WHEN** a step returns three calls and the second requires approval
- **THEN** the first runs, the second waits for its decision, and the third is decided and run or refused on its own terms
- **AND** each call receives its own result

#### Scenario: A denied call
- **WHEN** a call is denied by the user, a rule, a mode, or a hook
- **THEN** the model receives a result stating that it was denied, by whom, and why
- **AND** the call is not executed

#### Scenario: A cancelled turn
- **WHEN** the user cancels while calls are running or pending
- **THEN** running calls are aborted and every unanswered call receives a cancelled result
- **AND** the next request to the provider is well formed

#### Scenario: Text beside tool calls
- **WHEN** the model returns text, reasoning, and tool calls in one step
- **THEN** all three are kept in one assistant message in the transcript and in later requests

#### Scenario: Concurrent reads
- **WHEN** a step returns several consecutive read-only calls
- **THEN** they may run concurrently
- **AND** state-changing calls run one at a time in the order given

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

### Requirement: Permission Modes
JamCLI SHALL provide the permission modes `plan`, `default`, `accept-edits`, `auto`, and
`bypass`, each setting a default decision per tool class, switchable during a session.

#### Scenario: Plan mode
- **WHEN** the mode is `plan`
- **THEN** read tools run and state-changing tools are refused with a result telling the model it is planning
- **AND** the plan file, the todo list, and `ask_user` are the writes and questions that run without asking
- **AND** the system prompt names those tools and says the person approves the plan through `exit_plan_mode`

#### Scenario: Accept edits
- **WHEN** the mode is `accept-edits`
- **THEN** file edits inside the project run without asking
- **AND** commands still ask unless a rule allows them

#### Scenario: The project's own machinery is not an ordinary edit
- **WHEN** a mode would allow a change inside the project without asking, and the change is under the project's `.git/` or `.jamcli/`
- **THEN** it asks, unless a rule allows it
- **AND** the reason says that their files decide what git and JamCLI run

#### Scenario: Auto mode requires a sandbox
- **WHEN** the user selects `auto` and no sandbox is available
- **THEN** JamCLI refuses the mode and states why

#### Scenario: Bypass is explicit and visible
- **WHEN** `bypass` is requested
- **THEN** it requires the bypass flag or an interactive confirmation
- **AND** the mode is shown as a warning for as long as it is active and is recorded in the transcript

#### Scenario: Switch modes
- **WHEN** the user cycles the mode in the interface or an ACP client sets it
- **THEN** subsequent decisions use the new mode

#### Scenario: Leave plan mode by approval
- **WHEN** the person approves `exit_plan_mode`
- **THEN** the session is in the mode it held before plan mode, or `default`, from the next turn
- **AND** the tools that mode offers are offered then

### Requirement: Permission Rules and Grants
JamCLI SHALL refine modes with allow, ask, and deny rules that match tool calls by
pattern, collected from every configuration scope, with deny taking precedence over ask
and ask over allow.

#### Scenario: Allow a command pattern
- **WHEN** a rule allows `run_command(npm test*)`
- **THEN** `npm test -- --watch=false` runs without asking

#### Scenario: Compound commands
- **WHEN** a command joins several commands with `&&`, `;`, `||`, or `|`
- **THEN** it runs without asking only if every part is allowed
- **AND** a command containing substitution always asks

#### Scenario: Deny wins
- **WHEN** any scope denies a call and another scope or flag allows it
- **THEN** the call is denied

#### Scenario: Show the deciding rule
- **WHEN** a call is allowed, asked about, or denied
- **THEN** the rule and scope that decided it are shown in the approval prompt and recorded in the transcript

#### Scenario: Remember a decision
- **WHEN** the user approves a call and chooses to allow the suggested pattern for the session or the project
- **THEN** later matching calls run without asking for that scope
- **AND** a project grant is written to the project-local configuration file

### Requirement: Command Sandbox
JamCLI SHALL run shell commands, user hooks, plugin processes, and language servers it
starts inside an operating system sandbox when one is available, with the project
writable, the rest of the file system read-only, known credential locations hidden, and
network access off unless allowed.

#### Scenario: Write outside the project
- **WHEN** a sandboxed command writes outside the project and the temporary directory
- **THEN** the write fails

#### Scenario: Network off by default
- **WHEN** a sandboxed command opens a network connection and network access is not allowed
- **THEN** the connection fails

#### Scenario: Hidden credentials
- **WHEN** a sandboxed command reads a hidden credential location such as `~/.ssh`
- **THEN** it finds nothing there

#### Scenario: No sandbox available
- **WHEN** no sandbox is available on the platform
- **THEN** commands run unsandboxed and the interface, headless output, and `jamcli doctor` all say so

### Requirement: Subprocess Environment Isolation
JamCLI SHALL start every subprocess with a minimal environment and SHALL NOT pass
provider credentials to a subprocess unless they are named for it.

#### Scenario: Provider key absent from a command
- **WHEN** a provider key is set in JamCLI's environment and the model runs a command that prints the environment
- **THEN** the key is absent from the output

#### Scenario: Declared variables pass through
- **WHEN** an MCP server, a plugin, or the sandbox configuration declares a variable name
- **THEN** that variable is passed to that process only

### Requirement: Shell Command Execution
JamCLI SHALL run commands with a timeout, report the exit status and both output streams,
support cancellation, and support long-running commands in the background. A background
command SHALL belong to the session that started it, SHALL be visible to the person while
it runs, and its end SHALL reach the model without the model asking.

#### Scenario: Report failure honestly
- **WHEN** a command exits with a non-zero status
- **THEN** the result reports the exit code with its stdout and stderr labeled

#### Scenario: Time out
- **WHEN** a command runs past its timeout
- **THEN** its process group is terminated and the result reports a timeout with the output collected so far

#### Scenario: Truncate long output
- **WHEN** output exceeds the configured limit
- **THEN** the result keeps the beginning and the end and states how much was removed

#### Scenario: Run in the background
- **WHEN** the model starts a command in the background
- **THEN** JamCLI returns a job identifier at once
- **AND** the model can read the job's output and stop it later
- **AND** the approval prompt for the call says the command will run in the background

#### Scenario: A job's end reaches the model
- **WHEN** a background command ends, by exiting or by being stopped
- **THEN** the model is told, with the job's identifier, its command, how it ended, and how long it ran, appended to the next message it reads: the next prompt when no turn runs, or the last tool result of the step that was running
- **AND** the model is told once per job

#### Scenario: A job belongs to its session
- **WHEN** two sessions run in one process, as the MCP server hosts them
- **THEN** each session's jobs are listed, read, and stopped only from that session
- **AND** closing a session stops its jobs, while cancelling a turn does not

#### Scenario: The model stops a job without asking
- **WHEN** the model stops a job it started
- **THEN** the call runs without an approval prompt in every mode, as cancelling a delegated task does

#### Scenario: The model is told how to run what does not exit
- **WHEN** a session offers `run_command`
- **THEN** its guidance says that a server, a watcher, or anything that does not exit on its own runs in the background, and that the model is told when it ends

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

### Requirement: Cost Tracking
JamCLI SHALL compute the cost of each model request from its usage and the catalog
price, and SHALL report it per session and per model.

#### Scenario: Show session cost
- **WHEN** a priced model completes a request
- **THEN** the status line, `/cost`, and headless JSON output include the running cost

#### Scenario: Unpriced models
- **WHEN** a model has no known price
- **THEN** its usage is reported as unpriced rather than as zero

#### Scenario: Local models
- **WHEN** a request is served by a local provider
- **THEN** its cost is zero

### Requirement: Layered Configuration
JamCLI SHALL resolve configuration from built-in defaults, user, project, project-local,
environment, and flag layers, and SHALL report where each resolved value came from.

#### Scenario: Show origins
- **WHEN** the user runs `jamcli config list --show-origin`
- **THEN** each value is printed with the layer and file that set it

#### Scenario: Invalid configuration
- **WHEN** a configuration file contains an invalid value
- **THEN** JamCLI names the file, the key, and the expected shape

#### Scenario: Published schema
- **WHEN** an editor loads the published configuration schema
- **THEN** it can validate and complete every configuration key

#### Scenario: Existing files keep working
- **WHEN** a project has configuration written by an earlier version
- **THEN** it loads unchanged, and migration happens only when the user asks for it

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

### Requirement: Diagnostics Command
JamCLI SHALL provide `jamcli doctor`, which checks the environment and reports each
problem with a fix.

#### Scenario: Run diagnostics
- **WHEN** the user runs `jamcli doctor`
- **THEN** it reports provider reachability, available models, search backend, sandbox kind, git and `gh` availability, MCP and language server status, credential storage, and configuration errors

#### Scenario: Suggest a fix
- **WHEN** a check fails
- **THEN** the report names the cause and the command or setting that fixes it

### Requirement: First-Run Onboarding
JamCLI SHALL guide a first interactive run to a working provider and model without
writing project files.

#### Scenario: Local provider found
- **WHEN** the interface starts with no user configuration and Ollama is reachable
- **THEN** it lists Ollama's models that support tool calling and offers to use one

#### Scenario: Nothing configured
- **WHEN** no provider is reachable or configured
- **THEN** the interface explains how to start Ollama or set a provider key, and does not fail silently

#### Scenario: Choices are stored for the user
- **WHEN** onboarding completes
- **THEN** the choices are written to user configuration only

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

### Requirement: Accessibility Mode
JamCLI SHALL provide a screen reader mode and a reduced motion setting.

#### Scenario: Screen reader mode
- **WHEN** screen reader mode is enabled
- **THEN** the interface renders a linear sequence of labeled lines with no animation or box drawing
- **AND** each message and tool step is announced with its role or tool name

#### Scenario: Reduced motion
- **WHEN** reduced motion is enabled
- **THEN** spinners and shimmer effects are replaced by static indicators

### Requirement: Micro Status Mode
JamCLI SHALL render a single static status phrase when the terminal is too small for the
full interface.

#### Scenario: Small terminal
- **WHEN** the terminal is at or below the micro threshold, or `ui.micro` is `always`
- **THEN** the interface shows one phrase of two to four words on one line, clipped to the width, with no motion and nothing else

#### Scenario: Input needed wins
- **WHEN** an approval or a question is pending in the micro view
- **THEN** the phrase is `need input`, whatever else is happening

#### Scenario: Priority of phrases
- **WHEN** more than one state applies
- **THEN** the phrase follows the order need input, error, done, then the current activity, which names the tool and, for a file operation, the file

#### Scenario: No timer redraws
- **WHEN** the micro view is idle
- **THEN** two captures over an interval are identical

#### Scenario: Restoring the size
- **WHEN** the terminal grows above the threshold
- **THEN** the full interface returns with its state intact

### Requirement: Checkpoints and Undo
JamCLI SHALL checkpoint the working tree before state-changing tool calls and SHALL let
the user restore a checkpoint, without altering the user's git index, branches, HEAD, or
stash.

#### Scenario: Checkpoint in a repository
- **WHEN** a state-changing tool is about to run in a git repository
- **THEN** a snapshot of the working tree, excluding ignored files, is recorded on a private reference

#### Scenario: Undo
- **WHEN** the user runs `/undo`
- **THEN** JamCLI shows what will change and, after confirmation, restores the previous checkpoint

#### Scenario: Rewind
- **WHEN** the user rewinds to an earlier point
- **THEN** they can restore the code, the conversation, or both

#### Scenario: Outside a repository
- **WHEN** the project is not a git repository
- **THEN** files are backed up before they are changed and can be restored the same way

### Requirement: Diff Review
JamCLI SHALL show the working tree's changes by file and hunk and let the user stage,
unstage, or revert individual hunks.

#### Scenario: Review changes
- **WHEN** the user runs `/diff`
- **THEN** the interface lists changed files and their hunks

#### Scenario: Revert a hunk
- **WHEN** the user reverts a hunk
- **THEN** only that hunk is removed from the working tree

### Requirement: Commit and Pull Request Workflow
JamCLI SHALL create commits and pull requests only through an explicit approval that
shows exactly what will be recorded, and no mode or rule SHALL approve them in advance
unless configuration explicitly permits it for bypass mode.

#### Scenario: Commit with approval
- **WHEN** the model or the user requests a commit
- **THEN** JamCLI drafts a message from the staged changes and shows the message, files, and diff statistics for approval
- **AND** commits only after approval, running the repository's own hooks

#### Scenario: No attribution by default
- **WHEN** a commit is created
- **THEN** no attribution trailer is added unless configuration enables it

#### Scenario: Pull request
- **WHEN** the user requests a pull request and `gh` is installed and authenticated
- **THEN** pushing and creating the pull request are each approved separately

### Requirement: Worktree Isolation
JamCLI SHALL be able to run a session or a delegated task in a separate git worktree.

#### Scenario: Start in a worktree
- **WHEN** the user passes `--worktree <name>`
- **THEN** the session runs in a new worktree on a branch named for it

#### Scenario: Isolate a delegated task
- **WHEN** a task is delegated with worktree isolation
- **THEN** its changes are made in its own worktree and reported with that location

### Requirement: Custom Commands
JamCLI SHALL load slash commands from Markdown files in the user and project command
directories.

#### Scenario: Run a custom command
- **WHEN** the user runs `/name arguments` for a command file named `name.md`
- **THEN** its body, with arguments substituted and references expanded, is sent as the prompt

#### Scenario: Project shadows user
- **WHEN** a project command and a user command share a name
- **THEN** the project command is used and the palette shows the source of each

### Requirement: Agent Skills
JamCLI SHALL discover skills in the Agent Skills format and SHALL load a skill's
instructions only when the model asks for it.

#### Scenario: Advertise skills
- **WHEN** skills are installed
- **THEN** the system prompt lists each skill's name and description only

#### Scenario: Load a skill
- **WHEN** the model calls the skill tool with a skill's name
- **THEN** it receives the skill's instructions and the list of its bundled files

#### Scenario: Scripts stay governed
- **WHEN** a skill's instructions call for running a bundled script
- **THEN** the script runs through the command tool under the permission engine and the sandbox

### Requirement: User Command Hooks
JamCLI SHALL run configured commands at lifecycle events, passing the event as JSON and
honoring decisions returned by the command.

#### Scenario: Block a tool call
- **WHEN** a pre-tool hook exits with status 2
- **THEN** the call is denied and the hook's message is given as the reason

#### Scenario: Add context
- **WHEN** a hook returns additional context
- **THEN** that text is added to what the model sees for that event

#### Scenario: Modify input safely
- **WHEN** a hook returns replacement arguments for a tool call
- **THEN** they are validated against the tool's schema before the call runs

#### Scenario: Trust project hooks
- **WHEN** a project defines hooks the user has not yet trusted
- **THEN** JamCLI asks once before running them

#### Scenario: A failing hook
- **WHEN** a hook fails for a reason other than a block
- **THEN** a notice reports it and the turn continues

### Requirement: Plugin Packaging and Installation
JamCLI SHALL install plugins from a local path or a git URL, verify them against a
manifest and a lockfile, and require consent to their declared permissions.

#### Scenario: Install a plugin
- **WHEN** the user installs a plugin
- **THEN** JamCLI validates the manifest, checks the engine range, shows the declared permissions and contributions, and asks for consent
- **AND** records the source, commit, integrity hash, and permissions in the lockfile

#### Scenario: Update widens permissions
- **WHEN** an update declares more permissions than the installed version
- **THEN** JamCLI shows the difference and asks for consent again

#### Scenario: Tampered files
- **WHEN** an installed plugin's files no longer match the lockfile hash
- **THEN** verification fails and the plugin is disabled until reinstalled or approved again

#### Scenario: Lifecycle
- **WHEN** the user lists, enables, disables, updates, or removes a plugin
- **THEN** the operation is applied and reflected in the lockfile

#### Scenario: A lockfile from a newer JamCLI
- **WHEN** a lockfile records a version newer than the one this JamCLI writes
- **THEN** its plugins are off in the session and a notice says why
- **AND** installing, updating, or removing a plugin in that scope is refused rather than overwriting the record

### Requirement: Plugin Isolation
JamCLI SHALL run plugin code only as separate processes under the sandbox with the
plugin's declared permissions, and SHALL NOT load plugin code into its own process.

#### Scenario: Undeclared network access
- **WHEN** a plugin process attempts a network connection it did not declare
- **THEN** the connection fails

#### Scenario: Undeclared environment
- **WHEN** a plugin process reads a variable it did not declare
- **THEN** the variable is absent

#### Scenario: Plugin tools
- **WHEN** a plugin contributes tools
- **THEN** they are served by its MCP server and governed by the permission engine like any MCP tool

### Requirement: Workflow Definitions
JamCLI SHALL load workflows declared as a graph of steps with dependencies, conditions,
and inputs, and SHALL reject invalid graphs before running them.

#### Scenario: Validate a workflow
- **WHEN** a workflow has a dependency cycle, an unknown step reference, or an invalid condition
- **THEN** loading fails with the step and the reason

#### Scenario: Step kinds
- **WHEN** a workflow declares agent, command, tool, approval, commit, or nested workflow steps
- **THEN** each runs through the same runtime, permission engine, and sandbox as interactive work

#### Scenario: Conditions without code execution
- **WHEN** a step declares a condition
- **THEN** it is evaluated by a restricted expression grammar that cannot run code

### Requirement: Workflow Execution and Resumption
JamCLI SHALL run workflow steps in dependency order with bounded concurrency, record
every step transition, and resume an interrupted run at its first unfinished step.

#### Scenario: Bounded parallelism
- **WHEN** several steps are ready at once
- **THEN** at most the configured number run concurrently, and never more than four

#### Scenario: Human gate
- **WHEN** a run reaches an approval step
- **THEN** the interface asks, and a headless run pauses in a waiting state until `jamcli workflow approve` resumes it

#### Scenario: Resume
- **WHEN** a run is interrupted and later resumed
- **THEN** completed steps are not repeated and execution continues from the first unfinished step

#### Scenario: Failure propagation
- **WHEN** a step fails
- **THEN** its dependents are skipped unless they allow continuing after errors

### Requirement: Workflow Triggers
JamCLI SHALL start workflows manually, from git hooks, or on a schedule through the
operating system's scheduler, without a background daemon.

#### Scenario: Schedule a workflow
- **WHEN** the user schedules a workflow with a cron expression
- **THEN** JamCLI writes a crontab entry, launchd agent, or scheduled task that runs the workflow headlessly

#### Scenario: Git hook trigger
- **WHEN** the user installs a workflow on a git hook
- **THEN** the hook script runs the workflow when git invokes it

### Requirement: Language Server Integration
JamCLI SHALL start configured or detected language servers on demand, report their
diagnostics after file changes, and offer code navigation to the model.

#### Scenario: Diagnostics after an edit
- **WHEN** an edit introduces an error the language server reports
- **THEN** the edit's result includes the diagnostic

#### Scenario: Navigate code
- **WHEN** the model asks for a symbol's definition or references
- **THEN** JamCLI returns them from the language server

#### Scenario: No server available
- **WHEN** no language server is available for a file type
- **THEN** tools work without diagnostics and `jamcli doctor` reports the gap

### Requirement: Web Fetch Tool
JamCLI SHALL provide a tool that retrieves a URL as readable text, governed as network
access, preserving the page's links and preferring its main content.

#### Scenario: Fetch a page
- **WHEN** the model fetches a URL and the call is allowed
- **THEN** it receives the page as readable text with the final URL after redirects

#### Scenario: Ask by default
- **WHEN** no rule covers the URL's domain
- **THEN** the call asks for approval

#### Scenario: Links survive
- **WHEN** a fetched page contains a link
- **THEN** the text names both the link's words and its target, so the model can fetch it next

#### Scenario: Main content preferred
- **WHEN** a fetched page marks its main content
- **THEN** navigation, footers, and sidebars are left out of the text

#### Scenario: A repeated URL is served from memory
- **WHEN** the model fetches the same URL again within the cache lifetime
- **THEN** the text is returned without a second request to the site
- **AND** the cache is in-process, expires, and never touches disk

#### Scenario: A refinement stage stands between the page and the model
- **WHEN** a page has been reduced to text
- **THEN** it passes through a refinement stage before it is returned
- **AND** the stage is an identity pass, so the text is unchanged

### Requirement: Release Artifacts
JamCLI SHALL build single-file executables for Linux, macOS, and Windows, published with
checksums, a software bill of materials, and build provenance, and SHALL NOT publish to
npm.

#### Scenario: Build release binaries
- **WHEN** a release is built
- **THEN** executables are produced for each supported platform with a checksum file and a bill of materials

#### Scenario: Provenance
- **WHEN** a release is published from CI
- **THEN** each executable carries a build provenance attestation

### Requirement: Performance Budgets
JamCLI SHALL meet recorded budgets for startup, headless overhead, interface rendering,
memory, and search, measured in CI.

#### Scenario: Startup budget
- **WHEN** `jamcli --version` is measured in CI
- **THEN** its median over five runs is within the recorded budget

#### Scenario: Interface latency
- **WHEN** a keystroke is sent to the interface with a 1,000-message transcript loaded
- **THEN** the 95th percentile time to the next frame is within the recorded budget

#### Scenario: Budgets change only with evidence
- **WHEN** a budget is changed
- **THEN** the change records a measurement and a reason

### Requirement: ACP Observer Endpoint
A running interface SHALL be able to serve a standard ACP stream to an observing client
without making that client an approver.

#### Scenario: No endpoint
- **WHEN** `JAMCLI_ACP_ENDPOINT` is not set
- **THEN** the interface serves nothing and behaves as it does without the feature

#### Scenario: Observe a session
- **WHEN** `JAMCLI_ACP_ENDPOINT` names a Unix socket and a client connects to it
- **THEN** the client receives standard ACP session updates for the session on screen, including tool calls with their title, kind, and locations

#### Scenario: Need input
- **WHEN** a call waits for the person's approval
- **THEN** within a second the client receives the call with status `pending` and a `requires_action` state
- **AND** only the person, in the interface, can answer it

#### Scenario: Say whose answer it is
- **WHEN** the waiting call's tool always asks, such as a lesson from `/reflect`
- **THEN** the `requires_action` state names the tool and says that it always asks

#### Scenario: A client goes away
- **WHEN** the observing client disconnects or crashes during a turn
- **THEN** the interface keeps running, with no hang and no lost output

### Requirement: Web Search Tool
JamCLI SHALL provide a tool that answers a query with ranked web results from a
configured search provider, governed as network access.

#### Scenario: Search the web
- **WHEN** the model searches with a query and the call is allowed
- **THEN** it receives ranked results, each with its URL, title, and text
- **AND** a result carrying a publication date says so in its text

#### Scenario: Recency is the model's to ask for
- **WHEN** the model needs results from a named period rather than any time
- **THEN** it can state that period in the call, and the provider is asked for it

#### Scenario: No provider configured
- **WHEN** no search provider's key resolves
- **THEN** the tool is not offered to the model at all, rather than offered and failing

#### Scenario: Ask by default
- **WHEN** no rule covers the configured provider's host
- **THEN** the call asks for approval

#### Scenario: Rules name the provider
- **WHEN** a rule names the configured provider's host, as in `web_search(domain:api.langsearch.com)`
- **THEN** that rule decides the call
- **AND** a rule that names a host no configured provider reaches never silently decides it

#### Scenario: Duplicate results are dropped
- **WHEN** two results are the same page or repeat the same text
- **THEN** one of them is returned

#### Scenario: A refinement stage stands between the results and the model
- **WHEN** results have been retrieved
- **THEN** they pass through a refinement stage before they are returned
- **AND** the stage is an identity pass, so the results are unchanged

#### Scenario: The provider fails
- **WHEN** the provider returns an error or cannot be reached
- **THEN** the tool reports why, and the session continues

### Requirement: Search Provider Configuration
JamCLI SHALL let a user configure a web search provider in configuration the way model
providers are configured, naming the environment variable that holds its key.

#### Scenario: Declare a provider's key
- **WHEN** a provider entry names the environment variable holding its key
- **THEN** the key is read from that variable

#### Scenario: Key precedence
- **WHEN** a key is available from more than one place
- **THEN** the declared variable is preferred, then a key in the file, then the provider's
  well-known variable, then the stored credential

#### Scenario: The key stays out of output
- **WHEN** the key's value would appear in output, or a subprocess environment is built
- **THEN** the value is scrubbed from the output and the variable is withheld from the subprocess

#### Scenario: Replace a built-in provider's settings
- **WHEN** a user's configuration names a provider the built-in registry already names
- **THEN** the user's entry governs

### Requirement: Agent Definitions
JamCLI SHALL define a delegation agent as one markdown file whose frontmatter names its
description and model chain and whose body is its rules, SHALL load agent files from the
project, the user, and plugins in that order, and SHALL provide built-in agents that a
file of the same name replaces.

#### Scenario: Load an agent file
- **WHEN** `agents/<name>.md` exists in the project `.jamcli` directory, the user configuration directory, or a plugin
- **THEN** it is an agent named `<name>` with the frontmatter's description and chain and the body as its rules
- **AND** a project file wins over a user file, which wins over a plugin file, which wins over a built-in

#### Scenario: Built-in agents
- **WHEN** no file or configuration defines `quick`, `intelligent`, `explore`, or `writing`
- **THEN** each is offered with its built-in description and runs on the session's model
- **AND** they name no provider, so they work with whichever provider serves the session, a local one with no key and no network included

#### Scenario: Reject an unusable file
- **WHEN** an agent file has no description, an empty chain, or a name that breaks the naming rules
- **THEN** the file is reported by path and reason and skipped
- **AND** the other agents still load

#### Scenario: Tolerate keys from a later version
- **WHEN** an agent file carries a frontmatter key this version does not know
- **THEN** the key is reported by name
- **AND** the agent still loads

### Requirement: Delegation Choice Presentation
JamCLI SHALL present the agents to the model with each agent's description, the models
it runs on, and the default, together with guidance on when and how to delegate, and
SHALL offer only agents it could route.

#### Scenario: List the agents with their descriptions
- **WHEN** the `task` tool is offered to the model
- **THEN** its description lists one line per agent giving the name, the description, and the chain it runs on
- **AND** states which agent is used when none is named, or that an agent must always be named

#### Scenario: The chain is shown as it is
- **WHEN** an agent is listed
- **THEN** the models it runs on are generated from its configured chain, not written by hand
- **AND** an agent with no description is listed with its name and chain alone

#### Scenario: Offer only routable agents
- **WHEN** no entry in an agent's chain belongs to a configured provider
- **THEN** that agent is not listed
- **AND** the check makes no network request

#### Scenario: Guide the choice
- **WHEN** the `task` tool is offered to the model
- **THEN** its description says when to delegate, when to do the work directly, and how to brief a child that starts without the conversation

#### Scenario: Stable within a session
- **WHEN** agent files or configuration change while a session runs
- **THEN** the list the model sees and the routing the session uses stay consistent with each other until the next session

### Requirement: Delegation Settings
JamCLI SHALL let the person set the default agent through the settings command and
through configuration files, as one store, and SHALL show where each agent came from.

#### Scenario: List the agents
- **WHEN** the person runs `/agents`
- **THEN** each agent is shown with its source (a file path, `categories`, or built-in), its description, its chain, whether it has rules, and whether it is the default

#### Scenario: Set the default from the agents command
- **WHEN** the person chooses an agent in `/agents`
- **THEN** it is written as `delegation.default_agent` through the same writer `/config set` uses
- **AND** the notice names the file written and says the change applies from the next session

#### Scenario: Set it from the command line or the file
- **WHEN** the person runs `jamcli config set delegation.default_agent <name>` or edits the key by hand
- **THEN** `/agents` shows that agent as the default
- **AND** the next session uses it

#### Scenario: Default names no agent
- **WHEN** the configured default agent is not one of the agents in effect
- **THEN** JamCLI names the file, the key, and the agents that exist

### Requirement: Delegated Approvals
JamCLI SHALL ask the person about a child's call that needs a decision on the surface of
the session that delegated, naming the child that asks, and SHALL show there what the call
went on to do. A waiting ask that a later grant allows SHALL be settled without the person,
and identical waiting asks SHALL be put to the person as one.

#### Scenario: Answer a child's prompts in turn
- **WHEN** a foreground child's calls need a person's decision, one after another
- **THEN** each prompt is shown on the delegating session's surface
- **AND** each is taken down once answered, so the next can be read and answered

#### Scenario: Show what an answered call did
- **WHEN** a child's call the person answered finishes
- **THEN** the delegating surface shows its result where the prompt was
- **AND** the delegating session's transcript records the person's answer

#### Scenario: A prompt names the child that asks
- **WHEN** a child's call needs a decision
- **THEN** the request names the child as data: its task id, its title, and its agent
- **AND** every surface names the child from those, and the reason says only why the call asks

#### Scenario: A grant settles the asks it now allows
- **WHEN** asks are waiting and the person allows one of them, or adds a rule, for the session or the project
- **THEN** every other waiting ask is decided again by the engine of the run that raised it
- **AND** each one now allowed runs without the person, and its decision is recorded with the rule that allowed it and where that rule came from
- **AND** its prompt is taken down on every surface that showed it

#### Scenario: Identical asks are one prompt
- **WHEN** several runs of one session ask about the same call in the same working tree at once
- **THEN** the person is shown one prompt that says how many agents ask and names them
- **AND** the answer applies to each of them, and each is recorded on its own

### Requirement: MCP Server Surface
JamCLI SHALL serve the Model Context Protocol over stdio so that any MCP host can delegate
work to a JamCLI session and use JamCLI's interface, through the same program and the
same permissions as a person, without the calling agent answering what is the person's.

#### Scenario: Serve MCP
- **WHEN** a host runs `jamcli mcp serve`
- **THEN** JamCLI speaks MCP on stdio and offers the `session_*` and `terminal_*` tools

#### Scenario: Delegate work to a session
- **WHEN** a host starts a session in a directory and sends it a prompt or a command
- **THEN** the turn runs with the same runtime, commands, and permissions as every other surface
- **AND** the tool returns the output when the turn ends, when the session waits on an answer, or when the host's wait runs out

#### Scenario: Answer what the session waits on
- **WHEN** a session waits on an approval or a list, and neither is the person's
- **THEN** the host can answer it, and the turn goes on

#### Scenario: The person's answer
- **WHEN** a session or a driven interface waits on a call to a tool that always asks, or on a choice marked as the person's
- **THEN** the calling agent cannot answer it
- **AND** JamCLI asks the person by elicitation in their host, and denies when the host cannot ask or the person does not accept

#### Scenario: Use the interface itself
- **WHEN** a host starts a terminal in a directory
- **THEN** the ordinary `jamcli` program runs in a pseudo-terminal, launched as the shipped build launches it, with no mode of its own for being driven
- **AND** the host can type, press keys, read the screen, and wait, and every byte JamCLI wrote is kept as a recording

### Requirement: Failure Signals
JamCLI SHALL derive a session's failures from its log, without calling a model and
without recording anything new.

#### Scenario: A failed tool call
- **WHEN** the log holds a tool result that ended in error
- **THEN** the session's signals include a `tool_error` whose id is that event's index

#### Scenario: A repeated call
- **WHEN** the model repeats a tool call with the same name and arguments
- **THEN** the signals include a `retry`

#### Scenario: The user's pushback
- **WHEN** the user denies an approval or cancels a turn
- **THEN** the signals include a `denied` or `cancelled`, with the user's feedback when given

### Requirement: Session Reflection
JamCLI SHALL, only when the user asks, reflect on the current session and propose delta
edits to skills, rules, or agents that the user approves before anything is written.

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

### Requirement: Plan Artifacts
JamCLI SHALL keep one plan per project as a markdown file the model writes with a
`state`-classed tool and the person can edit by hand, and SHALL let the model hand that
plan to the person for approval, which ends plan mode.

#### Scenario: Write the plan in plan mode
- **WHEN** the mode is `plan` and the model calls `plan_write` with content
- **THEN** the content is saved as the project's plan under `.jamcli/` and the call runs without asking
- **AND** reading the file returns what it holds, including edits the person made by hand
- **AND** outside plan mode `plan_write` and `exit_plan_mode` are not offered, since they mean nothing there

#### Scenario: Present the plan for approval
- **WHEN** the model calls `exit_plan_mode` and a plan file exists
- **THEN** the person is asked, every time and whatever the rules allow, with the plan's text as the preview
- **AND** on approval the session returns to the mode it was in before plan mode, or `default` when it started in plan mode, for the turns that follow
- **AND** the switch is recorded in the transcript

#### Scenario: Decline the plan
- **WHEN** the person denies `exit_plan_mode`, with or without feedback
- **THEN** the mode stays `plan`
- **AND** the result tells the model it was denied and carries the feedback

#### Scenario: Exit without a plan
- **WHEN** the model calls `exit_plan_mode` and no plan file exists
- **THEN** the prompt says there is no plan
- **AND** the call fails with a result saying the plan must be written first, whether or not it was allowed, and the mode stays `plan`

#### Scenario: Exit where no one answers
- **WHEN** `exit_plan_mode` is called in a headless run
- **THEN** the call is denied as every always-asked call is, and the plan stays in the project's plan file for the person

### Requirement: Ask the Person
JamCLI SHALL provide `ask_user`, a tool that puts one question, with optional choices, to
the person and returns their answer to the model, and SHALL tell the model plainly when no
one can answer.

#### Scenario: Ask with choices in the interface
- **WHEN** the model calls `ask_user` with a question and choices while a turn runs in the interface
- **THEN** the interface shows the question and the choices and waits
- **AND** the chosen label is returned to the model as the result

#### Scenario: Ask for free text
- **WHEN** the model calls `ask_user` with a question and no choices
- **THEN** the interface takes typed text and returns it to the model

#### Scenario: Cancel the question
- **WHEN** the person dismisses the question
- **THEN** the result tells the model no answer was given and to state its assumption and continue

#### Scenario: Ask where no one answers
- **WHEN** `ask_user` is called in a headless run or through a surface that cannot ask
- **THEN** the result says no one can answer here and tells the model to state its assumption and continue
- **AND** the call is not an error

#### Scenario: Always allowed
- **WHEN** `ask_user` is called in any mode
- **THEN** it runs without a permission prompt, since it changes nothing

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

### Requirement: Running Work Indicator
The interface SHALL count, on its status line, the background commands and child agents
of the session that are running, whether or not a turn runs.

#### Scenario: Running work is counted on the status line
- **WHEN** a background command or a child agent of the session is running
- **THEN** the status line says how many jobs and how many agents run, whether or not a turn runs
- **AND** the count goes when the last of them ends

### Requirement: Permission Prompt Presentation
The interface's permission prompt SHALL say each fact once, SHALL put a choice's detail on
the row it belongs to, and SHALL color its frame by what the call does.

#### Scenario: A command is shown once
- **WHEN** a command that needs a decision fits whole in the prompt's heading
- **THEN** the heading names it and the preview does not repeat it, showing only its facts: where it runs, relative to the project, and whether it stays running in the background
- **AND** a command the heading has to cut is shown whole in the preview, behind a rail, wrapped and scrollable

#### Scenario: The pattern count sits on its row
- **WHEN** a prompt offers more than one pattern to grant
- **THEN** the session row shows the pattern and which of the patterns it is, where Up and Down change it
- **AND** the project row says it grants the same rule, and where it is saved

#### Scenario: The frame says how much care the answer needs
- **WHEN** the call would change files
- **THEN** the prompt's frame is drawn in the accent
- **AND** for a call that runs, reaches out, or delegates, in the warning color

#### Scenario: A grant is named where it was given
- **WHEN** the person allows a call for the session or the project with a pattern
- **THEN** the call's line in the transcript says it was allowed by them and names the pattern

#### Scenario: The heading names the child
- **WHEN** a child's call is asked about in the interface
- **THEN** the prompt's heading names the child's title and its agent before the call
- **AND** a key opens that child's view from the prompt, and the prompt is back when the view closes

#### Scenario: One prompt for several agents
- **WHEN** several agents' identical asks are shown as one prompt
- **THEN** the heading says how many agents ask
- **AND** the count of prompts waiting counts that prompt once

#### Scenario: The question before a fan-out
- **WHEN** the person is asked about the rules a fan-out's children need
- **THEN** the prompt lists the rules and how many agents start
- **AND** it offers three answers: allow for this session, allow for this project, ask as they go
- **AND** Escape stops the turn, and never means ask as they go

### Requirement: Decision Ledger
JamCLI SHALL record, with every decision it logs, the rule that decided and where that rule
came from, and SHALL list the decisions recorded across a project's sessions on request.

#### Scenario: Record where a rule came from
- **WHEN** a rule decides a call, allowing or refusing it
- **THEN** the session log's approval event names the rule as written and the file and key it came from

#### Scenario: List what changed and why
- **WHEN** the user runs `jamcli audit ledger` in a project
- **THEN** every call its sessions recorded as changing something or refused is listed, by session and in order
- **AND** each names its target, whether it was allowed, who decided, the rule and its source when a rule decided, and the files it changed

#### Scenario: Narrow the ledger
- **WHEN** the user passes `--session`, `--since`, or `--refused`
- **THEN** only the decisions of that session, of sessions started since that date, or that were refused are listed

#### Scenario: Machine-readable ledger
- **WHEN** the user passes `--json`
- **THEN** the decisions are written as a JSON array

#### Scenario: The ledger only reads
- **WHEN** the ledger runs
- **THEN** it writes nothing to the project or its logs

#### Scenario: A pre-flight grant is named in the ledger
- **WHEN** a rule granted at the question before a fan-out allows a child's call
- **THEN** that call's decision names the rule and says it was granted before that fan-out started
- **AND** the answer to the question is itself recorded, with the rules it granted and the scope

### Requirement: Prompt Recall
The interface SHALL let the person recall what they sent earlier in the session with Up and
Down, one prompt at a time, into the composer exactly as it was typed or pasted, and SHALL
never lose the unsent draft while they do.

#### Scenario: Up recalls the previous prompt
- **WHEN** the person presses Up with the cursor on the composer's first line and no list of commands or references showing
- **THEN** the composer holds the prompt sent last, with its lines and pasted text as they were, and the cursor at its end
- **AND** a row above the composer says which prompt of how many it is and how to go on

#### Scenario: Up walks back and Down walks forward
- **WHEN** the composer still holds a recalled prompt as it was recalled and the person presses Up or Down, wherever the cursor is in it
- **THEN** the composer holds the next older or the next newer prompt
- **AND** Up at the oldest prompt stays on it

#### Scenario: A recalled slash line does not open the command list
- **WHEN** the composer holds a recalled prompt, unedited, that begins with `/` or holds an `@` word
- **THEN** no list of commands or references is shown, and Up and Down keep walking the history

#### Scenario: The draft comes back
- **WHEN** the person had text in the composer before pressing Up, and presses Down past the newest prompt, or Escape
- **THEN** the composer holds that text again, with its chips, and the recall row goes

#### Scenario: A multi-line draft is walked through first
- **WHEN** the composer holds several lines and the cursor is below the first
- **THEN** Up moves the cursor up a line and does not recall a prompt
- **AND** Up recalls a prompt only once the cursor is on the first line

#### Scenario: Recalled text is edited or sent like any text
- **WHEN** the person edits a recalled prompt, or adds to its end, or sends it
- **THEN** the edit is an ordinary draft, walked out of by the first-line and last-line rules, and the earlier draft is dropped only when something is sent

#### Scenario: An edited prompt is kept when the person walks away from it
- **WHEN** the person has edited a recalled prompt and then presses Up or Down past it, or Escape
- **THEN** the edited text is kept as a cleared prompt that Up recalls
- **AND** the walk goes on from where it was

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

#### Scenario: Choosing from the search keeps the draft it replaces
- **WHEN** the composer holds text and the person chooses an earlier message from the search
- **THEN** the composer holds the chosen message
- **AND** the text it held is kept as a cleared prompt that Up recalls

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
