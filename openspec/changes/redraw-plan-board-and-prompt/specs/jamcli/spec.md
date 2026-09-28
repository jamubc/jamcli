# Spec Delta

## MODIFIED Requirements

### Requirement: Todo Acceptance Checks
JamCLI SHALL let a todo item carry a check, the test, command, or observation that proves
it done, and SHALL show it wherever the item is shown. The interface SHALL draw the list as
a board whose state is read by mark and color, that stays up while a call waits, and that
shows what runs beside the turn.

#### Scenario: Write an item with a check
- **WHEN** the model calls `todo_write` with an item that has a `check`
- **THEN** the check is persisted with the item and returned by `todo_read`
- **AND** the list the model and the interface see shows the check beside the item

#### Scenario: Show the checklist in the interface
- **WHEN** the model writes a todo list or the plan in the interface
- **THEN** the board appears above the composer on its own, its header the whole plan as a strip of marks with the count of steps done and what the turn is doing, and the plan's path when there is one
- **AND** each step is a mark and a color for its state: done in the settled tone, running in the accent with how long it has run, pending in the text color, with the running step's check behind a rail beneath it
- **AND** screen reader mode reads the same facts as lines of words, each step's state a word in brackets and its check beneath it
- **AND** the todos key hides and shows it

#### Scenario: The board stays up beside a prompt
- **WHEN** a call waits for the person's decision while the board is shown
- **THEN** the board is still drawn, above the prompt, with its running step and its clock

#### Scenario: The board lists what runs beside the turn
- **WHEN** a background command or a child agent of the session is running
- **THEN** the board lists it under its header with what it is, how long it has run, and the `/jobs stop` that ends it
- **AND** the line goes when it ends

#### Scenario: Completion means the check passed
- **WHEN** the model reads the `todo_write` tool's description
- **THEN** it is told an item is marked completed only after its check has passed

## ADDED Requirements

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
