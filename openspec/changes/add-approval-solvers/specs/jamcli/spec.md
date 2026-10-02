# Spec Delta

## ADDED Requirements

### Requirement: Approval Solvers
JamCLI SHALL let a solver, chosen by the person from the solvers it finds, allow calls that
auto mode would otherwise ask the person about, and SHALL leave every other decision where
it is. A solver SHALL only allow or abstain, and anything but an allow SHALL reach the
person as the prompt they would have seen without it.

#### Scenario: A solver allows a call the mode would ask about
- **WHEN** the session is in auto mode, a solver is selected, and the mode alone would ask about a call, such as `web_fetch` or a write outside the project
- **THEN** the solver is asked first, and when it allows, the call runs without a prompt
- **AND** the session log records the approval as decided by the solver, naming the solver, the file it came from, and its reason

#### Scenario: A solver abstains
- **WHEN** the selected solver abstains, fails, answers with anything but allow or abstain, or does not answer within its time limit
- **THEN** the person is asked as they would have been without a solver, and the prompt carries what the solver said or why it gave no answer

#### Scenario: What a solver never decides
- **WHEN** a call is denied by a rule, a hook, or the mode; is asked about by an ask rule or a pre_tool hook; is by a tool that always asks, such as a commit; or changes the project's `.git/` or `.jamcli/`
- **THEN** the solver is not asked, and the call is decided exactly as it is with no solver

#### Scenario: Solvers only in auto mode
- **WHEN** the session is in plan, default, accept-edits, or bypass mode
- **THEN** no solver is asked, whatever is selected

#### Scenario: Find solvers
- **WHEN** the person runs `/solver`
- **THEN** every solver is listed by name with its one-line description and where it came from: JamCLI's own `none` and `jev`, the files in `~/.config/jamcli/solvers/`, and the files in the project's `.jamcli/solvers/`
- **AND** the list says which is selected and whether the project's solvers are trusted
- **AND** a file that fails to load is listed with why

#### Scenario: Select a solver
- **WHEN** the person runs `/solver jev`
- **THEN** `trust.solver` is set to `jev` in their own configuration, or in the project-local file when they choose that scope, and later calls in this session use it

#### Scenario: A repository cannot choose the solver
- **WHEN** the project's shared `.jamcli/config.json` sets `trust.solver`
- **THEN** that value is not used, and the session says so once, naming the file

#### Scenario: Project solvers wait for trust
- **WHEN** a project solver is selected and the project's solvers are not trusted, or a file among them has changed since they were
- **THEN** no solver runs, the session says so and how to trust them with `/solver trust`, and every call the mode asks about goes to the person

#### Scenario: No solver selected
- **WHEN** `trust.solver` is absent or `none`
- **THEN** every decision is what it is without solvers, and no solver file is loaded

#### Scenario: The Jev solver
- **WHEN** `jev` is selected and TypeSafe's key is available
- **THEN** each call put to it is sent to Jev with the turn's prompt, and allowed when Jev's probability that the call serves that prompt without reaching beyond it is at or above `trust.threshold`, 0.9 when unset, on the model `trust.model` names, `jev-latest` when unset
- **AND** what the request cost is counted in `/cost` under the Jev model

#### Scenario: The Jev solver without a key
- **WHEN** `jev` is selected and no TypeSafe key is stored, set in the environment, or named by `api_registry.typesafe.key_env_var`
- **THEN** the session says once that the Jev solver cannot run and how to store the key, and every call the mode asks about goes to the person

#### Scenario: Solvers on every surface
- **WHEN** a session runs in the interface, headless, or over ACP with a solver selected
- **THEN** the solver decides the same calls the same way, and a call it allows is reported to that surface as any call allowed without asking is

#### Scenario: A child's calls
- **WHEN** a delegated task in an auto mode session makes a call its mode would ask about
- **THEN** the session's selected solver is asked about it before the question reaches the person

#### Scenario: The ledger names the solver
- **WHEN** the person runs `jamcli audit ledger` in a project whose sessions had calls allowed by a solver
- **THEN** each such call is listed as decided by the solver, with the solver's name and file as its source
