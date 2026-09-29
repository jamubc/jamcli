# Spec Delta

## MODIFIED Requirements

### Requirement: Plugin Packaging and Installation
JamCLI SHALL install plugins from a local path or a git URL, verify them against a
manifest and a lockfile, and require consent to their declared permissions.

#### Scenario: Install a plugin
- **WHEN** the user installs a plugin
- **THEN** JamCLI validates the manifest, checks the engine range, shows the declared permissions and contributions, and asks for consent
- **AND** records the source, commit, integrity hash, and permissions in the lockfile

#### Scenario: Update widens permissions
- **WHEN** an update declares more permissions than the installed version
- **THEN** JamCLI shows the difference and asks for consent again

#### Scenario: Tampered files
- **WHEN** an installed plugin's files no longer match the lockfile hash
- **THEN** verification fails and the plugin is disabled until reinstalled or approved again

#### Scenario: Lifecycle
- **WHEN** the user lists, enables, disables, updates, or removes a plugin
- **THEN** the operation is applied and reflected in the lockfile

#### Scenario: A lockfile from a newer JamCLI
- **WHEN** a lockfile records a version newer than the one this JamCLI writes
- **THEN** its plugins are off in the session and a notice says why
- **AND** installing, updating, or removing a plugin in that scope is refused rather than overwriting the record
