## ADDED Requirements

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
