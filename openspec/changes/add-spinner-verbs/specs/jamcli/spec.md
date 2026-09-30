# Spec Delta

## MODIFIED Requirements

### Requirement: UI Style Configuration
JamCLI SHALL let the user choose and create status indicator styles, and a word style SHALL
be able to name the words the indicator shows for a phase, never replacing what the phase is.

#### Scenario: Choose a built-in style
- **WHEN** the user selects a status text style or spinner style
- **THEN** JamCLI persists the choice in the UI configuration
- **AND** the status indicator uses it on the next render

#### Scenario: Create a custom style
- **WHEN** the user creates a custom style
- **THEN** JamCLI writes a definition file into the project's status styles directory
- **AND** registers it for later selection

#### Scenario: Preview a style
- **WHEN** the user previews a status style
- **THEN** the interface renders the indicator using that style before it is saved

#### Scenario: Follow the theme
- **WHEN** a style names a theme role, such as `accent` or `dim`, in place of a color
- **THEN** the indicator takes that role's color from the active theme
- **AND** a style name saved by an earlier version still resolves to a style

#### Scenario: Words for a phase
- **WHEN** the chosen word style lists words for thinking, writing, or running a tool
- **THEN** while the indicator shows that phase it shows one of that phase's words, picked once when the phase begins and kept until the phase changes
- **AND** a phase the style lists no words for shows its own word, as every style without words does

#### Scenario: What words do not replace
- **WHEN** the session retries a request or compacts its context, or runs in screen reader mode or with reduced motion
- **THEN** the phase's own word is shown, whatever words the style lists

#### Scenario: A long word keeps the status line to its row
- **WHEN** the indicator shows a word longer than the phase's own
- **THEN** the rest of the status line is fitted to the room that word leaves, and the line does not run past the terminal's width

#### Scenario: A builtin style with words
- **WHEN** the user lists the word styles
- **THEN** one builtin style carries words for each of the three phases, and choosing it needs no file
