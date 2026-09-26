## MODIFIED Requirements

### Requirement: Command Sandbox
JamCLI SHALL run shell commands, user hooks, plugin processes, and language servers it
starts inside an operating system sandbox when one is available, with the project
writable, the rest of the file system read-only, known credential locations hidden, and
network access off unless allowed.

#### Scenario: Write outside the project
- **WHEN** a sandboxed command writes outside the project and the temporary directory
- **THEN** the write fails

#### Scenario: Network off by default
- **WHEN** a sandboxed command opens a network connection and network access is not allowed
- **THEN** the connection fails

#### Scenario: Hidden credentials
- **WHEN** a sandboxed command reads a hidden credential location such as `~/.ssh`
- **THEN** it finds nothing there

#### Scenario: No sandbox available
- **WHEN** no sandbox is available on the platform
- **THEN** commands run unsandboxed and the interface, headless output, and `jamcli doctor` all say so

#### Scenario: Windows sandbox
- **WHEN** a sandboxed command runs on Windows
- **THEN** it runs inside the platform's own primitive (a Job Object and restricted token, or the decision this change records if that proves insufficient)
- **AND** `jamcli doctor` and the sandbox notice name exactly what it restricts, not a claim of parity with bubblewrap or Seatbelt it does not meet

### Requirement: Credential Storage
JamCLI SHALL read provider credentials from environment variables or the operating
system's credential store, and SHALL report credentials stored in project files.

#### Scenario: Store a key
- **WHEN** the user runs `jamcli auth set <provider>`
- **THEN** the key is stored in the credential store, or in a file readable only by the user when no store exists, with a warning

#### Scenario: Log in with OpenRouter
- **WHEN** the user runs `jamcli auth login openrouter`
- **THEN** JamCLI completes OpenRouter's PKCE flow through the browser and stores the resulting key

#### Scenario: Key in a project file
- **WHEN** a provider key is found in a project configuration file
- **THEN** it still works, and `jamcli doctor` and `jamcli audit` report it as a finding

#### Scenario: Windows credential store
- **WHEN** the user runs `jamcli auth set <provider>` on Windows
- **THEN** the key is stored in Windows Credential Manager, read back the same way the macOS Keychain and Linux Secret Service paths already are

### Requirement: Shell Command Execution
JamCLI SHALL run commands with a timeout, report the exit status and both output streams,
support cancellation, and support long-running commands in the background.

#### Scenario: Report failure honestly
- **WHEN** a command exits with a non-zero status
- **THEN** the result reports the exit code with its stdout and stderr labeled

#### Scenario: Time out
- **WHEN** a command runs past its timeout
- **THEN** its process group is terminated and the result reports a timeout with the output collected so far

#### Scenario: Truncate long output
- **WHEN** output exceeds the configured limit
- **THEN** the result keeps the beginning and the end and states how much was removed

#### Scenario: Run in the background
- **WHEN** the model starts a command in the background
- **THEN** JamCLI returns a job identifier at once
- **AND** the model can read the job's output and stop it later

#### Scenario: Windows cancellation
- **WHEN** a command running on Windows times out or is cancelled
- **THEN** its Job Object is terminated, stopping it and everything it spawned, the same guarantee the process group gives on Linux and macOS
