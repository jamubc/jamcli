## ADDED Requirements

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
