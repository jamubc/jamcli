# Spec Delta

## MODIFIED Requirements

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

#### Scenario: Prevent unbounded nesting
- **WHEN** a child run would delegate further
- **THEN** delegation depth is bounded by configuration
- **AND** exceeding it returns an error instead of spawning another level

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

## ADDED Requirements

### Requirement: Running Work Indicator
The interface SHALL count, on its status line, the background commands and child agents
of the session that are running, whether or not a turn runs.

#### Scenario: Running work is counted on the status line
- **WHEN** a background command or a child agent of the session is running
- **THEN** the status line says how many jobs and how many agents run, whether or not a turn runs
- **AND** the count goes when the last of them ends
