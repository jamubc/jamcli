# Spec Delta

## MODIFIED Requirements

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
- **AND** the reason says that those files decide what git and JamCLI run

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
