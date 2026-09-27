## MODIFIED Requirements

### Requirement: Slash Command Surface
JamCLI SHALL provide slash commands through the composer, with a palette shown when the
user types `/`, including built-in commands, custom commands, skill-provided commands,
and MCP prompts. Built-in commands SHALL be defined once, outside the interface, and every
one SHALL be reachable on every surface.

#### Scenario: List available commands
- **WHEN** the user types `/` in the composer
- **THEN** the palette lists at least `/help`, `/model`, `/mode`, `/permissions`, `/context`, `/cost`, `/compact`, `/clear`, `/resume`, `/fork`, `/rewind`, `/undo`, `/diff`, `/commit`, `/tools`, `/mcp`, `/skills`, `/hooks`, `/plugins`, `/workflows`, `/config`, `/theme`, `/doctor`, `/export`, `/copy`, `/profile`, and `/exit`
- **AND** shows the source of each custom command

#### Scenario: Configure the provider
- **WHEN** the user runs `/config provider`
- **THEN** the interface offers the configured providers and custom endpoints
- **AND** API keys are masked when displayed

#### Scenario: Manage tool permissions
- **WHEN** the user runs `/permissions`
- **THEN** the interface lists the active mode and every rule with its scope, and lets the user add or remove rules

#### Scenario: Every built-in command has one definition
- **WHEN** any built-in command is run in the interface, headlessly, over ACP, or through the driver
- **THEN** the same definition of it runs
- **AND** what only a terminal can do, such as repainting in a new theme, is done where there is one, while the rest of the command, such as saving the theme, is done everywhere

#### Scenario: A choice without a terminal
- **WHEN** a command offers a choice on a surface with no terminal
- **THEN** the choices are listed with their keys
- **AND** `/choose <key>` answers it, or headless `--choose <key>` answers it in advance

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

## ADDED Requirements

### Requirement: Interface Driver
JamCLI SHALL let a program drive the interface itself, on a session in a project, typing
into it, pressing keys, and reading its screen and state, without a terminal.

#### Scenario: Start and stop a driven interface
- **WHEN** a program runs `jamcli drive start` in a project
- **THEN** the interface opens offscreen in a local process listening on a socket private to the user, and the command prints its id
- **AND** `jamcli drive stop <id>` closes it and its session stays in history

#### Scenario: Send and read
- **WHEN** a program sends text, types, or presses keys
- **THEN** the interface receives them as it would from a keyboard
- **AND** the reply comes once the interface settles or needs an answer, with the screen as text and the state: whether a turn runs, the pending approval or list, the status line, and the latest rows

#### Scenario: The person's answers
- **WHEN** the interface waits on a call to a tool that always asks, the bypass confirmation, or a choice marked as the person's
- **THEN** the state says the answer is the person's
- **AND** input is refused unless the request says it relays the person's own answer
