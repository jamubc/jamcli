## MODIFIED Requirements

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
- **THEN** the body is appended to the child's system prompt after the rules the child already receives
- **AND** the parent does not receive it
- **AND** the transcript records the file the rules came from

#### Scenario: Children can do the work
- **WHEN** a child run needs to read, edit, or run a command
- **THEN** it has the same tools as the parent, governed by the delegated policy

#### Scenario: Never inherit the parent model
- **WHEN** a child run starts
- **THEN** its model is resolved from its agent's chain
- **AND** it does not inherit the parent session's model

#### Scenario: Run a task in the background
- **WHEN** a task is requested in the background
- **THEN** the parent turn continues without waiting
- **AND** the result is retrievable when the child finishes

#### Scenario: Retrieve a background result
- **WHEN** the model requests the output of a background task
- **THEN** JamCLI returns the result if complete, and the current status otherwise

#### Scenario: Cancel a background task
- **WHEN** a background task is cancelled
- **THEN** the child run terminates and its partial output is reported

#### Scenario: Bound child permissions
- **WHEN** a child run needs a state-changing tool
- **THEN** it is governed by the policy configured for delegated runs
- **AND** a child cannot grant itself broader permissions than the parent

#### Scenario: Prevent unbounded nesting
- **WHEN** a child run would delegate further
- **THEN** delegation depth is bounded by configuration
- **AND** exceeding it returns an error instead of spawning another level

## ADDED Requirements

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
- **THEN** each is offered with its built-in description and the local-first chain
- **AND** they work with no key and no network

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
