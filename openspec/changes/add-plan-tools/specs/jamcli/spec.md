# Spec Delta

## ADDED Requirements

### Requirement: Plan Artifacts
JamCLI SHALL keep one plan per project as a markdown file the model writes with a
`state`-classed tool and the person can edit by hand, and SHALL let the model hand that
plan to the person for approval, which ends plan mode.

#### Scenario: Write the plan in plan mode
- **WHEN** the mode is `plan` and the model calls `plan_write` with content
- **THEN** the content is saved as the project's plan under `.jamcli/` and the call runs without asking
- **AND** `plan_read` returns what the file holds, including edits the person made by hand

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
- **THEN** the call fails with a result saying the plan must be written first, and no one is asked

#### Scenario: Exit where no one answers
- **WHEN** `exit_plan_mode` is called in a headless run
- **THEN** the call is denied as every always-asked call is, and the run's report carries the plan

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
it done, and SHALL show it wherever the item is shown.

#### Scenario: Write an item with a check
- **WHEN** the model calls `todo_write` with an item that has a `check`
- **THEN** the check is persisted with the item and returned by `todo_read`
- **AND** the list the model and the interface see shows the check beside the item

#### Scenario: Completion means the check passed
- **WHEN** the model reads the `todo_write` tool's description
- **THEN** it is told an item is marked completed only after its check has passed

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
