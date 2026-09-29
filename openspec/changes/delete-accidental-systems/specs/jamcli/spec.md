# Spec Delta

## MODIFIED Requirements

### Requirement: Session Runtime Assembly
JamCLI SHALL assemble every session through one runtime factory that builds the provider,
tool registry, permission engine, sandbox, rules, hooks, context management, and
transcript, and every surface SHALL obtain its session from that factory.

#### Scenario: Identical tools across surfaces
- **WHEN** the interface, a headless run, and an ACP session are started in the same project with the same configuration
- **THEN** the model is offered the same tools with the same schemas on all three

#### Scenario: Surfaces differ only in presentation and approval
- **WHEN** the same scripted conversation runs through each surface
- **THEN** the provider requests and the recorded transcripts are identical apart from session identifiers, timestamps, and the recorded deciding surface

#### Scenario: Registration reaches every surface
- **WHEN** a tool is added to the registry, by a built-in, an MCP server, a skill, or a plugin
- **THEN** every surface offers it without a change to any surface module

### Requirement: Delegation Audit
JamCLI SHALL provide an audit command that reviews agent definitions, rules files, skills,
hooks, plugins, tool permissions, and stored credentials for unsafe combinations.

#### Scenario: Run the audit
- **WHEN** the user runs `jamcli audit`
- **THEN** JamCLI scans instruction files, agent definitions, skill definitions, hook configuration, installed plugins, and permission rules in the project
- **AND** reports findings with a severity of critical, warning, or informational

#### Scenario: Flag the read-untrusted-plus-write combination
- **WHEN** a definition can both read untrusted content and write or execute
- **THEN** the audit reports it as critical

#### Scenario: Flag unnecessary tool access
- **WHEN** a definition holds a tool that its stated role does not require
- **THEN** the audit reports it as a warning

#### Scenario: Flag missing guardrails
- **WHEN** a definition lacks scope restriction, two-phase execution for writes, or error handling
- **THEN** the audit reports it

#### Scenario: Flag stored secrets and broad rules
- **WHEN** a provider key is stored in a project file or a rule allows every command
- **THEN** the audit reports it

#### Scenario: Report what the engine decides
- **WHEN** the audit reports what each tool may do
- **THEN** each verdict is the one the session's permission engine gives in the configured mode, from the same rules, with the rule and the file that decided it
- **AND** a tool whose calls the engine judges by their arguments, such as a command, is reported as depending on them rather than as one verdict

#### Scenario: Machine-readable output
- **WHEN** the user runs `jamcli audit --format sarif`
- **THEN** findings are emitted as SARIF

#### Scenario: Report without modifying
- **WHEN** the audit runs
- **THEN** it only reads and reports
- **AND** writes no files

## REMOVED Requirements

### Requirement: Tool Output Trust Gate
**Reason**: It was a relevance filter at threshold 0.3 doing duty as an injection defense, it
flagged the owner's own skill as an injection at 62%, and it was never measured against a
labelled set of injections. The sandbox and the network rules are what hold auto mode.
**Migration**: `trust.*` settings are still accepted and read by nothing; a session whose
configuration names `trust.model` says once that the gate is gone. Old session logs that
record a withheld result still read.
