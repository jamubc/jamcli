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
