# Spec Delta

## ADDED Requirements

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
