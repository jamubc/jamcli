# JamCLI Specification

## Purpose

Current behavior as built. This file describes what JamCLI does today and is updated
only when a change is archived, never while a change is open. Proposals to alter this
behavior live in `openspec/changes/`.

## Requirements

### Requirement: Terminal User Interface
JamCLI SHALL provide an interactive terminal interface with a chat viewport, a status
indicator, and a single-line input bar.

#### Scenario: Launch the interface
- **WHEN** the user runs `jamcli` in a directory
- **THEN** the terminal interface renders
- **AND** input is focused in the input bar

#### Scenario: Render a streaming reply
- **WHEN** a model response is streaming
- **THEN** the status indicator reports a thinking phase before first token and a streaming phase after
- **AND** the reply text appears incrementally in the chat viewport

#### Scenario: Handle a multi-line paste
- **WHEN** pasted content arrives inside bracketed paste markers
- **THEN** the input bar normalizes line endings
- **AND** long pastes collapse into a preview rather than expanding the input box

### Requirement: Slash Command Surface
JamCLI SHALL provide slash commands through the input bar, with suggestions shown when
the user types `/`.

#### Scenario: List available commands
- **WHEN** the user types `/` in the input bar
- **THEN** the interface lists `/model`, `/copy`, `/profile`, `/resume`, `/tools`, `/mcp`, `/config`, `/compact`, `/clear`, `/help`, and `/exit`

#### Scenario: Configure the provider
- **WHEN** the user runs `/config provider`
- **THEN** the interface offers `list` and `set` for the `ollama` and `openrouter` providers
- **AND** API keys are masked when displayed

#### Scenario: Manage tool permissions
- **WHEN** the user runs `/tools status`
- **THEN** the interface prints each tool with its enabled state, approval mode, and description

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
JamCLI SHALL support Ollama and OpenRouter as working providers, and SHALL expose
OpenAI and Anthropic as declared but unimplemented provider entries in configuration.

#### Scenario: Configure Ollama
- **WHEN** the user sets the Ollama endpoint
- **THEN** JamCLI persists it in `.jamcli/config.json` under `api_registry.ollama.endpoint`

#### Scenario: Configure OpenRouter
- **WHEN** the user supplies an OpenRouter API key
- **THEN** JamCLI persists it and uses it for subsequent OpenRouter requests

#### Scenario: Request an unimplemented provider
- **WHEN** a provider other than `ollama` or `openrouter` is requested
- **THEN** JamCLI fails with a message naming the provider as not implemented

### Requirement: Model Discovery
JamCLI SHALL discover available models from the active provider rather than requiring
the user to type a model identifier.

#### Scenario: Discover Ollama models
- **WHEN** the model selector opens with Ollama active
- **THEN** JamCLI queries the Ollama tags endpoint and lists the returned model names

#### Scenario: Select a model
- **WHEN** the user selects a model in the model selector
- **THEN** JamCLI persists it as the active profile's preferred model
- **AND** subsequent turns use that model

#### Scenario: View model details
- **WHEN** the user opens details for a model
- **THEN** the interface shows the model identifier, provider, description, and whether it supports tool calling

### Requirement: Read-Only Tool Execution
JamCLI SHALL execute `list_files`, `read_file`, and `search_code` without approval,
constrained to the project root.

#### Scenario: List files
- **WHEN** the model requests `list_files` with an optional glob pattern
- **THEN** JamCLI returns matching paths under the project root
- **AND** respects the configured ignore patterns
- **AND** caps results at 200

#### Scenario: Read a file range
- **WHEN** the model requests `read_file` with a path and optional line range
- **THEN** JamCLI returns the requested lines prefixed with their line numbers
- **AND** truncates output beyond 64 KB

#### Scenario: Search code
- **WHEN** the model requests `search_code` with a query or a regular expression
- **THEN** JamCLI returns matching file, line, and trimmed line text
- **AND** caps matches at 40 and scanned files at 400
- **AND** skips files larger than 512 KB

#### Scenario: Refuse a path outside the project
- **WHEN** a read or list target resolves outside the project root
- **THEN** JamCLI rejects the call with a message stating the path escapes the project root

### Requirement: Approval-Gated State Changes
JamCLI SHALL require explicit user approval before applying a patch or running a shell
command.

#### Scenario: Request approval for a patch
- **WHEN** the model proposes `apply_patch`
- **THEN** the interface presents the action for approval
- **AND** the patch is applied only after the user approves

#### Scenario: Request approval for a command
- **WHEN** the model proposes `run_command`
- **THEN** the interface presents the command for approval
- **AND** the command runs only after the user approves

#### Scenario: Reject a proposed action
- **WHEN** the user rejects a proposed action
- **THEN** the action is recorded as rejected
- **AND** nothing is written to disk and no command runs

### Requirement: Tool Permission Policy
JamCLI SHALL let the user enable, disable, or require approval per tool, and SHALL
persist those decisions in the MCP configuration.

#### Scenario: Disable a tool
- **WHEN** the user disables a tool
- **THEN** JamCLI does not offer that tool to the model on subsequent turns

#### Scenario: Require approval for a safe tool
- **WHEN** the user sets a safe tool to require approval
- **THEN** that tool routes through the approval flow

#### Scenario: Persist a permission change
- **WHEN** a permission changes
- **THEN** JamCLI writes it to `.jamcli/mcp.json` under `tools`

### Requirement: MCP Server Integration
JamCLI SHALL connect to MCP servers over stdio and expose their tools to the model.

#### Scenario: Connect to a server
- **WHEN** an enabled stdio server is configured in `.jamcli/mcp.json`
- **THEN** JamCLI spawns it with the configured command, arguments, environment, and working directory
- **AND** caches the connection for the session

#### Scenario: Namespace a discovered tool
- **WHEN** a server reports a tool
- **THEN** JamCLI exposes it as `<serverId>__<toolName>`
- **AND** preserves the native tool name for the call

#### Scenario: Survive a failing server
- **WHEN** a configured server fails to start or list tools
- **THEN** JamCLI logs the failure
- **AND** continues with the remaining servers and built-in tools

#### Scenario: Test a server
- **WHEN** the user requests a server test
- **THEN** JamCLI connects, lists the server's tools, and reports their schemas

### Requirement: MCP Tool Discovery
JamCLI SHALL provide a `search_tools` meta-tool so the model can find MCP tools by
keyword instead of receiving every schema in context.

#### Scenario: Search discovered tools
- **WHEN** the model calls `search_tools` with a query
- **THEN** JamCLI returns tools whose name or description contains the query
- **AND** caps the result at the requested limit

#### Scenario: Select relevant tools per turn
- **WHEN** a user message requires tools
- **THEN** JamCLI selects a bounded subset of available tools for that turn rather than sending all of them

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
JamCLI SHALL compose the system prompt from the active profile, project rules, and tool
guidance.

#### Scenario: Load project instructions
- **WHEN** a session starts
- **THEN** JamCLI reads a project rules file into the system prompt if one exists

#### Scenario: Describe available tools
- **WHEN** tools are available for a turn
- **THEN** the system prompt describes how to invoke them and warns against guessing instead of inspecting

### Requirement: Context Management
JamCLI SHALL keep the conversation within a configured token budget using a configured
strategy.

#### Scenario: Compress by summarization
- **WHEN** the estimated token count exceeds the configured threshold and the strategy is `summarize`
- **THEN** JamCLI summarizes the older turns into a single system message stating the primary request, key technical concepts, and files and code sections discussed
- **AND** keeps the most recent turns verbatim

#### Scenario: Compress by truncation
- **WHEN** the strategy is `truncate`
- **THEN** JamCLI drops the oldest turns until the budget fits
- **AND** always preserves the system prompt

#### Scenario: Report compression
- **WHEN** context is compressed or truncated
- **THEN** JamCLI surfaces a notice stating the before and after token counts

#### Scenario: Fall back after a failed summary
- **WHEN** the summarization call fails
- **THEN** JamCLI keeps the original context and reports the failure

#### Scenario: Force compaction
- **WHEN** the user runs `/compact`
- **THEN** JamCLI compresses the context regardless of the threshold

### Requirement: Token Accounting
JamCLI SHALL count tokens for the conversation and for each model used.

#### Scenario: Report session usage
- **WHEN** a turn completes with provider usage data
- **THEN** JamCLI adds the prompt, completion, and total token counts to the session usage

#### Scenario: Track usage per model
- **WHEN** a model produces usage data
- **THEN** JamCLI accumulates that model's prompt, completion, and total counts separately

### Requirement: Session History Persistence
JamCLI SHALL persist each session as JSONL under `.jamcli/history/` and SHALL allow
resuming a previous session.

#### Scenario: Persist a turn
- **WHEN** an assistant response completes
- **THEN** JamCLI appends the user message and the assistant message to the session file

#### Scenario: Resume a session
- **WHEN** the user runs `/resume` and selects a session
- **THEN** JamCLI loads that session's messages into the chat viewport
- **AND** continues appending to the same session file

#### Scenario: Resume a session with no messages
- **WHEN** the selected session contains no messages
- **THEN** JamCLI reports that the session cannot be resumed and keeps the current one

### Requirement: Session Listing and Export
JamCLI SHALL support listing, searching, and exporting stored sessions.

#### Scenario: List sessions
- **WHEN** sessions are listed
- **THEN** JamCLI returns the most recent sessions with their metadata

#### Scenario: Search sessions
- **WHEN** a search query is supplied
- **THEN** JamCLI returns sessions whose content matches, up to a limit

#### Scenario: Export a session
- **WHEN** the user exports a session
- **THEN** JamCLI renders it as Markdown and writes the export to disk

### Requirement: Workspace References
JamCLI SHALL expand `@` references in user input into file or directory content before
sending the turn.

#### Scenario: Reference a file
- **WHEN** the user writes `@path/to/file` in a message
- **THEN** JamCLI inlines that file's content into the turn
- **AND** caps a single file at 192 KB

#### Scenario: Reference a directory
- **WHEN** the user references a directory
- **THEN** JamCLI inlines its entries up to 128 entries

#### Scenario: Report a missing reference
- **WHEN** a referenced path does not exist
- **THEN** JamCLI reports the missing reference rather than silently dropping it

#### Scenario: Bound reference expansion
- **WHEN** a single message contains many references
- **THEN** JamCLI expands at most 12 operations per message

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

### Requirement: Fenced JSON Action Protocol
JamCLI SHALL interpret fenced JSON blocks in model output as tool or action requests,
in addition to native tool calls.

#### Scenario: Parse a safe action
- **WHEN** model output contains a fenced JSON block naming `list_files`, `read_file`, or `search_code`
- **THEN** JamCLI executes that tool

#### Scenario: Parse an elevated action
- **WHEN** model output contains a fenced JSON block naming `apply_patch`, `run_command`, `run_shell`, or `shell_exec`
- **THEN** JamCLI queues the action for approval

#### Scenario: Ignore malformed JSON
- **WHEN** a fenced block does not parse as JSON or names an unknown action
- **THEN** JamCLI ignores the block and continues

### Requirement: Bounded Agent Loop
JamCLI SHALL bound each turn's agent loop by a maximum step count and a maximum number
of tool calls per step.

#### Scenario: Reach the step limit
- **WHEN** the loop reaches the configured maximum step count
- **THEN** JamCLI stops the loop and reports that the limit was reached

#### Scenario: Bound tool calls per step
- **WHEN** a step returns more tool calls than the per-step maximum
- **THEN** JamCLI executes only up to that maximum

#### Scenario: Truncate tool output
- **WHEN** a tool returns more than 2000 characters
- **THEN** JamCLI truncates the output before placing it in context

### Requirement: Configuration Persistence
JamCLI SHALL persist configuration under `.jamcli/` and SHALL NOT commit it.

#### Scenario: Initialize configuration
- **WHEN** JamCLI starts in a project with no `.jamcli` directory
- **THEN** it creates the directory and writes default configuration files

#### Scenario: Keep secrets out of the repository
- **WHEN** `.jamcli/` exists in the project root
- **THEN** git ignores it

#### Scenario: Toggle telemetry
- **WHEN** the user changes the telemetry setting
- **THEN** JamCLI persists it, and it defaults to disabled
