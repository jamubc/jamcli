# Spec Delta

## MODIFIED Requirements

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
