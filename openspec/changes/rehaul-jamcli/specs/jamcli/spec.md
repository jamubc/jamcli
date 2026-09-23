## ADDED Requirements

### Requirement: Session Runtime Assembly
JamCLI SHALL assemble every session through one runtime factory that builds the provider,
tool registry, permission engine, sandbox, rules, hooks, context management, trust gate,
and transcript, and every surface SHALL obtain its session from that factory.

#### Scenario: Identical tools across surfaces
- **WHEN** the interface, a headless run, and an ACP session are started in the same project with the same configuration
- **THEN** the model is offered the same tools with the same schemas on all three

#### Scenario: Surfaces differ only in presentation and approval
- **WHEN** the same scripted conversation runs through each surface
- **THEN** the provider requests and the recorded transcripts are identical apart from session identifiers, timestamps, and the recorded deciding surface

#### Scenario: Registration reaches every surface
- **WHEN** a tool is added to the registry, by a built-in, an MCP server, a skill, or a plugin
- **THEN** every surface offers it without a change to any surface module

### Requirement: Honest Tool Batches
JamCLI SHALL give every tool call the model makes exactly one recorded result, and SHALL
never drop a call silently.

#### Scenario: Approval in the middle of a batch
- **WHEN** a step returns three calls and the second requires approval
- **THEN** the first runs, the second waits for its decision, and the third is decided and run or refused on its own terms
- **AND** each call receives its own result

#### Scenario: A denied call
- **WHEN** a call is denied by the user, a rule, a mode, or a hook
- **THEN** the model receives a result stating that it was denied, by whom, and why
- **AND** the call is not executed

#### Scenario: A cancelled turn
- **WHEN** the user cancels while calls are running or pending
- **THEN** running calls are aborted and every unanswered call receives a cancelled result
- **AND** the next request to the provider is well formed

#### Scenario: Text beside tool calls
- **WHEN** the model returns text, reasoning, and tool calls in one step
- **THEN** all three are kept in one assistant message in the transcript and in later requests

#### Scenario: Concurrent reads
- **WHEN** a step returns several consecutive read-only calls
- **THEN** they may run concurrently
- **AND** state-changing calls run one at a time in the order given

### Requirement: Transcript Event Log
JamCLI SHALL record each session as an append-only event log from which any run can be
explained afterward and from which every other session view is derived.

#### Scenario: Record what happened
- **WHEN** a turn runs
- **THEN** the log records the user input, each assistant message with its tool calls, each tool result with its status, each approval decision with who decided and which rule applied, notices, usage, and cost

#### Scenario: Resume with tool context
- **WHEN** a session whose turns included tool calls is resumed
- **THEN** the next request contains those calls and their results

#### Scenario: Read older history
- **WHEN** a session file written before this format is listed, resumed, or exported
- **THEN** it loads without migration and is never rewritten

#### Scenario: Redact secrets
- **WHEN** tool output contains the value of a credential present in the environment or the credential store
- **THEN** the value is replaced by a marker naming its source before it reaches the model or the log

### Requirement: Permission Modes
JamCLI SHALL provide the permission modes `plan`, `default`, `accept-edits`, `auto`, and
`bypass`, each setting a default decision per tool class, switchable during a session.

#### Scenario: Plan mode
- **WHEN** the mode is `plan`
- **THEN** read tools run and state-changing tools are refused with a result telling the model it is planning

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

### Requirement: Permission Rules and Grants
JamCLI SHALL refine modes with allow, ask, and deny rules that match tool calls by
pattern, collected from every configuration scope, with deny taking precedence over ask
and ask over allow.

#### Scenario: Allow a command pattern
- **WHEN** a rule allows `run_command(npm test*)`
- **THEN** `npm test -- --watch=false` runs without asking

#### Scenario: Compound commands
- **WHEN** a command joins several commands with `&&`, `;`, `||`, or `|`
- **THEN** it runs without asking only if every part is allowed
- **AND** a command containing substitution always asks

#### Scenario: Deny wins
- **WHEN** any scope denies a call and another scope or flag allows it
- **THEN** the call is denied

#### Scenario: Show the deciding rule
- **WHEN** a call is allowed, asked about, or denied
- **THEN** the rule and scope that decided it are shown in the approval prompt and recorded in the transcript

#### Scenario: Remember a decision
- **WHEN** the user approves a call and chooses to allow the suggested pattern for the session or the project
- **THEN** later matching calls run without asking for that scope
- **AND** a project grant is written to the project-local configuration file

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

### Requirement: Subprocess Environment Isolation
JamCLI SHALL start every subprocess with a minimal environment and SHALL NOT pass
provider credentials to a subprocess unless they are named for it.

#### Scenario: Provider key absent from a command
- **WHEN** a provider key is set in JamCLI's environment and the model runs a command that prints the environment
- **THEN** the key is absent from the output

#### Scenario: Declared variables pass through
- **WHEN** an MCP server, a plugin, or the sandbox configuration declares a variable name
- **THEN** that variable is passed to that process only

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

### Requirement: Model Catalog
JamCLI SHALL resolve, for any configured model, its context window, output limit,
supported features, and price, from configuration, provider metadata, a bundled table,
or conservative defaults, in that order.

#### Scenario: Metadata from the provider
- **WHEN** a provider reports a model's context length or price
- **THEN** the catalog uses it unless configuration overrides it

#### Scenario: Unknown model
- **WHEN** no source knows a model
- **THEN** conservative defaults apply and its price is reported as unknown rather than guessed

#### Scenario: Local context size
- **WHEN** an Ollama model is used
- **THEN** its context size is sent with each request so Ollama does not truncate silently

### Requirement: Cost Tracking
JamCLI SHALL compute the cost of each model request from its usage and the catalog
price, and SHALL report it per session and per model.

#### Scenario: Show session cost
- **WHEN** a priced model completes a request
- **THEN** the status line, `/cost`, and headless JSON output include the running cost

#### Scenario: Unpriced models
- **WHEN** a model has no known price
- **THEN** its usage is reported as unpriced rather than as zero

#### Scenario: Local models
- **WHEN** a request is served by a local provider
- **THEN** its cost is zero

### Requirement: Layered Configuration
JamCLI SHALL resolve configuration from built-in defaults, user, project, project-local,
environment, and flag layers, and SHALL report where each resolved value came from.

#### Scenario: Show origins
- **WHEN** the user runs `jamcli config list --show-origin`
- **THEN** each value is printed with the layer and file that set it

#### Scenario: Invalid configuration
- **WHEN** a configuration file contains an invalid value
- **THEN** JamCLI names the file, the key, and the expected shape

#### Scenario: Published schema
- **WHEN** an editor loads the published configuration schema
- **THEN** it can validate and complete every configuration key

#### Scenario: Existing files keep working
- **WHEN** a project has configuration written by an earlier version
- **THEN** it loads unchanged, and migration happens only when the user asks for it

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

### Requirement: Observability
JamCLI SHALL provide structured logs with verbosity levels, a local trace of sessions,
turns, model requests, and tool calls, and an optional OpenTelemetry export that is off
by default.

#### Scenario: Verbose output
- **WHEN** the user passes `-v` or `-vv`
- **THEN** informational or debug records are written to the log without any credential

#### Scenario: Local trace
- **WHEN** the user passes `--trace-file`
- **THEN** spans for the session, turns, model requests, tool calls, and hooks are written to that file

#### Scenario: Export to a collector
- **WHEN** OpenTelemetry export is enabled with an endpoint
- **THEN** traces and usage metrics are sent using the GenAI semantic conventions
- **AND** prompt and output content are excluded unless explicitly enabled

#### Scenario: Off by default
- **WHEN** nothing is configured
- **THEN** no telemetry leaves the machine

### Requirement: Diagnostics Command
JamCLI SHALL provide `jamcli doctor`, which checks the environment and reports each
problem with a fix.

#### Scenario: Run diagnostics
- **WHEN** the user runs `jamcli doctor`
- **THEN** it reports provider reachability, available models, search backend, sandbox kind, git and `gh` availability, MCP and language server status, credential storage, and configuration errors

#### Scenario: Suggest a fix
- **WHEN** a check fails
- **THEN** the report names the cause and the command or setting that fixes it

### Requirement: First-Run Onboarding
JamCLI SHALL guide a first interactive run to a working provider and model without
writing project files.

#### Scenario: Local provider found
- **WHEN** the interface starts with no user configuration and Ollama is reachable
- **THEN** it lists Ollama's models that support tool calling and offers to use one

#### Scenario: Nothing configured
- **WHEN** no provider is reachable or configured
- **THEN** the interface explains how to start Ollama or set a provider key, and does not fail silently

#### Scenario: Choices are stored for the user
- **WHEN** onboarding completes
- **THEN** the choices are written to user configuration only

### Requirement: Keybindings and Themes
JamCLI SHALL let the user rebind interface keys and choose light, dark, high-contrast, or
monochrome themes, and SHALL honor `NO_COLOR`.

#### Scenario: Rebind a key
- **WHEN** the keybindings file maps an action to another key
- **THEN** the interface uses that key and its help shows it

#### Scenario: No color
- **WHEN** `NO_COLOR` is set
- **THEN** the interface renders without color and every state remains distinguishable by symbol and text

### Requirement: Accessibility Mode
JamCLI SHALL provide a screen reader mode and a reduced motion setting.

#### Scenario: Screen reader mode
- **WHEN** screen reader mode is enabled
- **THEN** the interface renders a linear sequence of labeled lines with no animation or box drawing
- **AND** each message and tool step is announced with its role or tool name

#### Scenario: Reduced motion
- **WHEN** reduced motion is enabled
- **THEN** spinners and shimmer effects are replaced by static indicators

### Requirement: Checkpoints and Undo
JamCLI SHALL checkpoint the working tree before state-changing tool calls and SHALL let
the user restore a checkpoint, without altering the user's git index, branches, HEAD, or
stash.

#### Scenario: Checkpoint in a repository
- **WHEN** a state-changing tool is about to run in a git repository
- **THEN** a snapshot of the working tree, excluding ignored files, is recorded on a private reference

#### Scenario: Undo
- **WHEN** the user runs `/undo`
- **THEN** JamCLI shows what will change and, after confirmation, restores the previous checkpoint

#### Scenario: Rewind
- **WHEN** the user rewinds to an earlier point
- **THEN** they can restore the code, the conversation, or both

#### Scenario: Outside a repository
- **WHEN** the project is not a git repository
- **THEN** files are backed up before they are changed and can be restored the same way

### Requirement: Diff Review
JamCLI SHALL show the working tree's changes by file and hunk and let the user stage,
unstage, or revert individual hunks.

#### Scenario: Review changes
- **WHEN** the user runs `/diff`
- **THEN** the interface lists changed files and their hunks

#### Scenario: Revert a hunk
- **WHEN** the user reverts a hunk
- **THEN** only that hunk is removed from the working tree

### Requirement: Commit and Pull Request Workflow
JamCLI SHALL create commits and pull requests only through an explicit approval that
shows exactly what will be recorded, and no mode or rule SHALL approve them in advance
unless configuration explicitly permits it for bypass mode.

#### Scenario: Commit with approval
- **WHEN** the model or the user requests a commit
- **THEN** JamCLI drafts a message from the staged changes and shows the message, files, and diff statistics for approval
- **AND** commits only after approval, running the repository's own hooks

#### Scenario: No attribution by default
- **WHEN** a commit is created
- **THEN** no attribution trailer is added unless configuration enables it

#### Scenario: Pull request
- **WHEN** the user requests a pull request and `gh` is installed and authenticated
- **THEN** pushing and creating the pull request are each approved separately

### Requirement: Worktree Isolation
JamCLI SHALL be able to run a session or a delegated task in a separate git worktree.

#### Scenario: Start in a worktree
- **WHEN** the user passes `--worktree <name>`
- **THEN** the session runs in a new worktree on a branch named for it

#### Scenario: Isolate a delegated task
- **WHEN** a task is delegated with worktree isolation
- **THEN** its changes are made in its own worktree and reported with that location

### Requirement: Custom Commands
JamCLI SHALL load slash commands from Markdown files in the user and project command
directories.

#### Scenario: Run a custom command
- **WHEN** the user runs `/name arguments` for a command file named `name.md`
- **THEN** its body, with arguments substituted and references expanded, is sent as the prompt

#### Scenario: Project shadows user
- **WHEN** a project command and a user command share a name
- **THEN** the project command is used and the palette shows the source of each

### Requirement: Agent Skills
JamCLI SHALL discover skills in the Agent Skills format and SHALL load a skill's
instructions only when the model asks for it.

#### Scenario: Advertise skills
- **WHEN** skills are installed
- **THEN** the system prompt lists each skill's name and description only

#### Scenario: Load a skill
- **WHEN** the model calls the skill tool with a skill's name
- **THEN** it receives the skill's instructions and the list of its bundled files

#### Scenario: Scripts stay governed
- **WHEN** a skill's instructions call for running a bundled script
- **THEN** the script runs through the command tool under the permission engine and the sandbox

### Requirement: User Command Hooks
JamCLI SHALL run configured commands at lifecycle events, passing the event as JSON and
honoring decisions returned by the command.

#### Scenario: Block a tool call
- **WHEN** a pre-tool hook exits with status 2
- **THEN** the call is denied and the hook's message is given as the reason

#### Scenario: Add context
- **WHEN** a hook returns additional context
- **THEN** that text is added to what the model sees for that event

#### Scenario: Modify input safely
- **WHEN** a hook returns replacement arguments for a tool call
- **THEN** they are validated against the tool's schema before the call runs

#### Scenario: Trust project hooks
- **WHEN** a project defines hooks the user has not yet trusted
- **THEN** JamCLI asks once before running them

#### Scenario: A failing hook
- **WHEN** a hook fails for a reason other than a block
- **THEN** a notice reports it and the turn continues

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

### Requirement: Plugin Isolation
JamCLI SHALL run plugin code only as separate processes under the sandbox with the
plugin's declared permissions, and SHALL NOT load plugin code into its own process.

#### Scenario: Undeclared network access
- **WHEN** a plugin process attempts a network connection it did not declare
- **THEN** the connection fails

#### Scenario: Undeclared environment
- **WHEN** a plugin process reads a variable it did not declare
- **THEN** the variable is absent

#### Scenario: Plugin tools
- **WHEN** a plugin contributes tools
- **THEN** they are served by its MCP server and governed by the permission engine like any MCP tool

### Requirement: Workflow Definitions
JamCLI SHALL load workflows declared as a graph of steps with dependencies, conditions,
and inputs, and SHALL reject invalid graphs before running them.

#### Scenario: Validate a workflow
- **WHEN** a workflow has a dependency cycle, an unknown step reference, or an invalid condition
- **THEN** loading fails with the step and the reason

#### Scenario: Step kinds
- **WHEN** a workflow declares agent, command, tool, approval, commit, or nested workflow steps
- **THEN** each runs through the same runtime, permission engine, and sandbox as interactive work

#### Scenario: Conditions without code execution
- **WHEN** a step declares a condition
- **THEN** it is evaluated by a restricted expression grammar that cannot run code

### Requirement: Workflow Execution and Resumption
JamCLI SHALL run workflow steps in dependency order with bounded concurrency, record
every step transition, and resume an interrupted run at its first unfinished step.

#### Scenario: Bounded parallelism
- **WHEN** several steps are ready at once
- **THEN** at most the configured number run concurrently, and never more than four

#### Scenario: Human gate
- **WHEN** a run reaches an approval step
- **THEN** the interface asks, and a headless run pauses in a waiting state until `jamcli workflow approve` resumes it

#### Scenario: Resume
- **WHEN** a run is interrupted and later resumed
- **THEN** completed steps are not repeated and execution continues from the first unfinished step

#### Scenario: Failure propagation
- **WHEN** a step fails
- **THEN** its dependents are skipped unless they allow continuing after errors

### Requirement: Workflow Triggers
JamCLI SHALL start workflows manually, from git hooks, or on a schedule through the
operating system's scheduler, without a background daemon.

#### Scenario: Schedule a workflow
- **WHEN** the user schedules a workflow with a cron expression
- **THEN** JamCLI writes a crontab entry, launchd agent, or scheduled task that runs the workflow headlessly

#### Scenario: Git hook trigger
- **WHEN** the user installs a workflow on a git hook
- **THEN** the hook script runs the workflow when git invokes it

### Requirement: Language Server Integration
JamCLI SHALL start configured or detected language servers on demand, report their
diagnostics after file changes, and offer code navigation to the model.

#### Scenario: Diagnostics after an edit
- **WHEN** an edit introduces an error the language server reports
- **THEN** the edit's result includes the diagnostic

#### Scenario: Navigate code
- **WHEN** the model asks for a symbol's definition or references
- **THEN** JamCLI returns them from the language server

#### Scenario: No server available
- **WHEN** no language server is available for a file type
- **THEN** tools work without diagnostics and `jamcli doctor` reports the gap

### Requirement: Web Fetch Tool
JamCLI SHALL provide a tool that retrieves a URL as readable text, governed as network
access.

#### Scenario: Fetch a page
- **WHEN** the model fetches a URL and the call is allowed
- **THEN** it receives the page as readable text with the final URL after redirects

#### Scenario: Ask by default
- **WHEN** no rule covers the URL's domain
- **THEN** the call asks for approval

### Requirement: Release Artifacts
JamCLI SHALL build single-file executables for Linux, macOS, and Windows, published with
checksums, a software bill of materials, and build provenance, and SHALL NOT publish to
npm.

#### Scenario: Build release binaries
- **WHEN** a release is built
- **THEN** executables are produced for each supported platform with a checksum file and a bill of materials

#### Scenario: Provenance
- **WHEN** a release is published from CI
- **THEN** each executable carries a build provenance attestation

### Requirement: Performance Budgets
JamCLI SHALL meet recorded budgets for startup, headless overhead, interface rendering,
memory, and search, measured in CI.

#### Scenario: Startup budget
- **WHEN** `jamcli --version` is measured in CI
- **THEN** its median over five runs is within the recorded budget

#### Scenario: Interface latency
- **WHEN** a keystroke is sent to the interface with a 1,000-message transcript loaded
- **THEN** the 95th percentile time to the next frame is within the recorded budget

#### Scenario: Budgets change only with evidence
- **WHEN** a budget is changed
- **THEN** the change records a measurement and a reason

## MODIFIED Requirements

### Requirement: Terminal User Interface
JamCLI SHALL provide an interactive terminal interface with a header, a scrollable
transcript, a multi-line composer, and a status line, rendering the same runtime events
every other surface receives.

#### Scenario: Launch the interface
- **WHEN** the user runs `jamcli` in a directory
- **THEN** the terminal interface renders
- **AND** input is focused in the composer

#### Scenario: Render a streaming reply
- **WHEN** a model response is streaming, with or without tool calls
- **THEN** the status line reports a thinking phase before first token and a streaming phase after
- **AND** the reply text appears incrementally in the transcript

#### Scenario: Show tool activity
- **WHEN** a tool call runs
- **THEN** the transcript shows it as a block with the tool, a summary of its arguments, its status, and its duration
- **AND** edits show their diff and commands show the end of their output

#### Scenario: Show the session state
- **WHEN** a session is active
- **THEN** the status line shows the permission mode, the provider and model, the share of the context window in use, the session cost, the sandbox kind, and the connected server counts

#### Scenario: Handle a multi-line paste
- **WHEN** pasted content arrives inside bracketed paste markers
- **THEN** the composer normalizes line endings
- **AND** long pastes collapse into a preview rather than expanding the composer

#### Scenario: Interrupt
- **WHEN** the user presses the interrupt key during a turn
- **THEN** the turn is cancelled and the session remains usable

### Requirement: Slash Command Surface
JamCLI SHALL provide slash commands through the composer, with a palette shown when the
user types `/`, including built-in commands, custom commands, skill-provided commands,
and MCP prompts.

#### Scenario: List available commands
- **WHEN** the user types `/` in the composer
- **THEN** the palette lists at least `/help`, `/model`, `/mode`, `/permissions`, `/context`, `/cost`, `/compact`, `/clear`, `/resume`, `/fork`, `/rewind`, `/undo`, `/diff`, `/commit`, `/tools`, `/mcp`, `/skills`, `/hooks`, `/plugins`, `/workflows`, `/config`, `/theme`, `/doctor`, `/export`, `/copy`, `/profile`, and `/exit`
- **AND** shows the source of each custom command

#### Scenario: Configure the provider
- **WHEN** the user runs `/config provider`
- **THEN** the interface offers the configured providers and custom endpoints
- **AND** API keys are masked when displayed

#### Scenario: Manage tool permissions
- **WHEN** the user runs `/permissions`
- **THEN** the interface lists the active mode and every rule with its scope, and lets the user add or remove rules

### Requirement: Provider Configuration
JamCLI SHALL support a local provider, any OpenAI-compatible endpoint, and a translated
Anthropic-shaped endpoint on every surface, and SHALL NOT present providers it cannot
serve.

#### Scenario: Configure Ollama
- **WHEN** the user sets the Ollama endpoint
- **THEN** JamCLI persists it in `.jamcli/config.json` under `api_registry.ollama.endpoint`

#### Scenario: Configure OpenRouter
- **WHEN** the user supplies an OpenRouter API key, names an environment variable holding it, or logs in with `jamcli auth login openrouter`
- **THEN** JamCLI uses that credential for subsequent OpenRouter requests

#### Scenario: Configure a custom compatible endpoint
- **WHEN** the user registers an endpoint with an identifier and a base URL
- **THEN** JamCLI persists it and offers it as a provider in the model selector

#### Scenario: Configure an Anthropic-shaped endpoint
- **WHEN** the user registers an endpoint that speaks the Anthropic Messages format
- **THEN** JamCLI translates requests and responses through the Anthropic seam

#### Scenario: Same provider on every surface
- **WHEN** a profile selects any supported provider
- **THEN** the interface, headless runs, and ACP sessions all use that provider

#### Scenario: Reject an unconfigured provider
- **WHEN** a provider is requested that has no endpoint or credential configured
- **THEN** JamCLI reports the provider as unconfigured
- **AND** names the configuration key that would enable it

#### Scenario: Keep credentials out of the project file
- **WHEN** a provider supports reading its key from the environment or the credential store
- **THEN** JamCLI prefers those over a value stored in configuration

### Requirement: Model Discovery
JamCLI SHALL discover models from the configured providers rather than requiring a
hand-maintained list, and SHALL show catalog information for each.

#### Scenario: Discover models from a compatible endpoint
- **WHEN** the model selector opens for a configured endpoint
- **THEN** JamCLI queries that endpoint's models route and lists the results

#### Scenario: Discover Ollama models
- **WHEN** the model selector opens with Ollama active
- **THEN** JamCLI queries the Ollama tags endpoint and lists the returned model names

#### Scenario: Merge discovered and configured models
- **WHEN** configuration declares additional models for a provider
- **THEN** JamCLI lists discovered models and configured models together
- **AND** labels where each came from

#### Scenario: Report a reachable failure
- **WHEN** model discovery fails for a provider
- **THEN** JamCLI reports the failure for that provider
- **AND** continues to list models for the others

#### Scenario: Select a model
- **WHEN** the user selects a model in the model selector
- **THEN** JamCLI persists it as the active profile's preferred model
- **AND** subsequent turns use that model

#### Scenario: View model details
- **WHEN** the user opens details for a model
- **THEN** the interface shows the model identifier, provider, description, context window, price, and whether it supports tool calling and reasoning

### Requirement: Read-Only Tool Execution
JamCLI SHALL execute read tools without approval in the default mode, constrained to the
project root after resolving symbolic links, and SHALL resolve them through the tool
registry with real JSON Schemas.

#### Scenario: List files by pattern
- **WHEN** the model requests `glob` with a pattern
- **THEN** JamCLI returns matching paths ordered by most recently modified
- **AND** respects `.gitignore`, `.ignore`, and the configured ignore patterns

#### Scenario: Read a file range
- **WHEN** the model requests `read_file` with a path and optional line window
- **THEN** JamCLI returns the requested lines with their line numbers and anchors
- **AND** cuts overlong lines and reports when output was truncated
- **AND** refuses binary files with their size

#### Scenario: Search by regular expression
- **WHEN** the model requests `grep` with a pattern
- **THEN** JamCLI returns matches with file, line, and requested context, file names only, or counts
- **AND** uses ripgrep when it is available and an equivalent walk otherwise, both honoring the same ignore rules

#### Scenario: Never stop silently
- **WHEN** a search reaches a time or result limit before covering every file
- **THEN** the result states that it was limited and how far it got

#### Scenario: List files
- **WHEN** a tool call, a permission rule, or a profile names `list_files`
- **THEN** JamCLI serves it as `glob`, with the same ignore rules
- **AND** the model is offered only `glob`

#### Scenario: Search code
- **WHEN** a tool call, a permission rule, or a profile names `search_code`
- **THEN** JamCLI serves it as `grep`, with the same ignore rules
- **AND** the model is offered only `grep`

#### Scenario: Refuse a path outside the project
- **WHEN** a read or list target resolves outside the project root, including through a symbolic link
- **THEN** JamCLI rejects the call with a message stating the path escapes the project root

#### Scenario: Validate arguments
- **WHEN** a read tool call arrives with arguments that fail its schema
- **THEN** JamCLI returns a tool error naming the invalid argument
- **AND** does not execute the tool

### Requirement: Approval-Gated State Changes
JamCLI SHALL require a decision before any state-changing action that the active mode and
rules do not already allow, and the decision SHALL come from the active surface.

#### Scenario: Request approval for a patch
- **WHEN** the model proposes a file change, edit, or patch that requires approval in the interactive interface
- **THEN** the interface presents the change with its diff for approval
- **AND** the change is made only after the user approves

#### Scenario: Request approval for a command
- **WHEN** the model proposes `run_command` and it requires approval
- **THEN** the interface presents the command, its working directory, and whether it will run sandboxed
- **AND** the command runs only after the user approves

#### Scenario: Reject a proposed action
- **WHEN** an action is rejected
- **THEN** it is recorded as rejected and the model receives a result saying so
- **AND** nothing is written to disk and no command runs

#### Scenario: Reject with feedback
- **WHEN** the user rejects an action and writes feedback
- **THEN** the feedback is given to the model and the turn continues

#### Scenario: Resolve approval in a non-interactive run
- **WHEN** a state-changing action is proposed in a headless run
- **THEN** the decision is resolved from the run's mode, rules, and flags
- **AND** an action that they do not allow is refused rather than prompted

#### Scenario: Record every decision
- **WHEN** any approval request is resolved
- **THEN** the transcript records the action, the decision, who decided, the surface, and the rule that applied

### Requirement: Tool Permission Policy
JamCLI SHALL govern each tool call through the active permission mode and the permission
rules, SHALL let non-interactive runs constrain and extend tools with flags without
changing project configuration, and SHALL keep legacy per-tool settings working.

#### Scenario: Disable a tool
- **WHEN** a deny rule matches a whole tool
- **THEN** JamCLI does not offer that tool to the model on subsequent turns

#### Scenario: Require approval for a read tool
- **WHEN** an ask rule matches a read tool
- **THEN** that tool routes through the approval flow

#### Scenario: Allow a state-changing tool
- **WHEN** an allow rule matches a state-changing tool call
- **THEN** it runs without prompting in the interactive surface
- **AND** the rule is visible in configuration rather than implicit

#### Scenario: Allow a tool for one run
- **WHEN** `--allow-tool` names a tool
- **THEN** that tool runs without prompting in that run unless a deny rule matches it
- **AND** other tools keep the decisions they would otherwise have

#### Scenario: Constrain a non-interactive run
- **WHEN** `--deny-tool` is passed for a tool
- **THEN** that tool cannot run in the run regardless of any other configuration

#### Scenario: Default to gating
- **WHEN** no rule matches a state-changing tool call in the default mode
- **THEN** it requires approval

#### Scenario: Persist a permission change
- **WHEN** the user saves a permission rule or a project grant
- **THEN** JamCLI writes it to the configuration file of the chosen scope

#### Scenario: Read legacy settings
- **WHEN** `.jamcli/mcp.json` carries per-tool `allowed` and `require_approval` settings
- **THEN** JamCLI applies them as deny, ask, or allow rules

### Requirement: MCP Server Integration
JamCLI SHALL connect to MCP servers over stdio and streamable HTTP, on every surface, and
expose their tools, prompts, and resources.

#### Scenario: Connect to a server
- **WHEN** an enabled stdio server is configured
- **THEN** JamCLI spawns it with the configured command, arguments, declared environment variables, and working directory, and a minimal environment otherwise
- **AND** caches the connection for the session

#### Scenario: Namespace a discovered tool
- **WHEN** a server reports a tool
- **THEN** JamCLI exposes it as `<serverId>__<toolName>`
- **AND** preserves the native tool name for the call

#### Scenario: Use servers on every surface
- **WHEN** a session starts in the interface, headless, or over ACP
- **THEN** the configured servers' tools are available in that session

#### Scenario: Survive a failing server
- **WHEN** a configured server fails to start or list tools
- **THEN** JamCLI reports the failure
- **AND** continues with the remaining servers and built-in tools

#### Scenario: Test a server
- **WHEN** the user requests a server test
- **THEN** JamCLI connects, lists the server's tools, and reports their schemas

#### Scenario: Prompts and resources
- **WHEN** a server offers prompts or resources
- **THEN** prompts appear as slash commands and resources can be referenced with `@`

### Requirement: MCP Tool Discovery
JamCLI SHALL provide a `search_tools` meta-tool and SHALL defer MCP tool schemas behind it
only when the number of MCP tools exceeds a configured threshold, and SHALL NOT withhold
built-in tools based on the wording of the user's message.

#### Scenario: Search discovered tools
- **WHEN** the model calls `search_tools` with a query
- **THEN** JamCLI returns tools whose name or description contains the query
- **AND** caps the result at the requested limit

#### Scenario: Many MCP tools
- **WHEN** the configured servers expose more tools than the threshold
- **THEN** their schemas are withheld from the request and the model discovers them through `search_tools`

#### Scenario: Select relevant tools per turn
- **WHEN** a turn is prepared
- **THEN** every built-in tool the permission engine does not deny is offered to the model, whatever the wording of the user's message
- **AND** only MCP tool schemas may be deferred, and only by the threshold

### Requirement: Project Rules and Tool Guidance
JamCLI SHALL compose the system prompt from the active profile, the project rules
hierarchy, available skills, and tool guidance on every surface, and SHALL keep that
composition outside the UI layer.

#### Scenario: Load project instructions
- **WHEN** a session starts on any surface
- **THEN** JamCLI loads the instruction files between the project root and the working directory and includes them in the system prompt

#### Scenario: Describe available tools
- **WHEN** tools are available for a turn
- **THEN** the system prompt names the tools and their purpose
- **AND** instructs the model to inspect rather than guess
- **AND** does not instruct the model to emit a JSON action block

#### Scenario: Compose outside the interface
- **WHEN** the system prompt is built
- **THEN** it is built by the core
- **AND** the interface only displays the result

#### Scenario: Show the effective prompt
- **WHEN** the user inspects configuration
- **THEN** JamCLI shows the effective system prompt that is actually sent and which parts came from the profile, the rules hierarchy, skills, and tool guidance

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

### Requirement: Token Accounting
JamCLI SHALL count tokens and cost for the conversation and for each model used,
including cached tokens where the provider reports them.

#### Scenario: Report session usage
- **WHEN** a request completes with provider usage data
- **THEN** JamCLI adds the prompt, completion, cached, and total token counts to the session usage

#### Scenario: Track usage per model
- **WHEN** a model produces usage data
- **THEN** JamCLI accumulates that model's counts and cost separately

#### Scenario: Request usage when streaming
- **WHEN** a streaming request is sent to an OpenAI-compatible endpoint
- **THEN** JamCLI asks the endpoint to include usage in the stream

### Requirement: Session History Persistence
JamCLI SHALL persist each session as an event log under `.jamcli/history/` from every
surface and SHALL allow resuming a previous session with its tool context.

#### Scenario: Persist a turn
- **WHEN** a turn runs on any surface
- **THEN** JamCLI appends its events to the session file as they happen

#### Scenario: Resume a session
- **WHEN** the user runs `/resume` and selects a session, or passes `--resume` or `--continue`
- **THEN** JamCLI loads that session's messages, tool calls, and results
- **AND** continues appending to the same session file

#### Scenario: Resume a session with no messages
- **WHEN** the selected session contains no messages
- **THEN** JamCLI reports that the session cannot be resumed and keeps the current one

### Requirement: Session Listing and Export
JamCLI SHALL list, search, show, fork, and export stored sessions from the command line
as well as the interface.

#### Scenario: List sessions
- **WHEN** the user runs `jamcli sessions list`
- **THEN** JamCLI returns the most recent sessions with their metadata

#### Scenario: Search sessions
- **WHEN** the user runs `jamcli sessions search` with a query
- **THEN** JamCLI returns sessions whose content matches, up to a limit

#### Scenario: Export a session
- **WHEN** the user runs `jamcli sessions export`
- **THEN** JamCLI renders the session, including tool calls, results, and decisions, as Markdown and writes the export to disk

#### Scenario: Fork a session from the command line
- **WHEN** the user runs `jamcli sessions fork <id>`
- **THEN** a new session is created from that transcript and the original is unchanged

#### Scenario: Keep session storage compatible
- **WHEN** sessions are listed, searched, or exported
- **THEN** existing session files under `.jamcli/history/` are read without migration

### Requirement: Workspace References
JamCLI SHALL expand `@` references in user input into file, directory, or MCP resource
content before sending the turn, on every surface.

#### Scenario: Reference a file
- **WHEN** the user writes `@path/to/file` in a message on any surface
- **THEN** JamCLI inlines that file's content into the turn
- **AND** caps a single file at 192 KB

#### Scenario: Reference a directory
- **WHEN** the user references a directory
- **THEN** JamCLI inlines its entries up to 128 entries

#### Scenario: Reference an MCP resource
- **WHEN** the user references `@server:uri`
- **THEN** JamCLI reads the resource from that server and inlines it

#### Scenario: Report a missing reference
- **WHEN** a referenced path does not exist
- **THEN** JamCLI reports the missing reference rather than silently dropping it

#### Scenario: Bound reference expansion
- **WHEN** a single message contains many references
- **THEN** JamCLI expands at most 12 operations per message

### Requirement: Bounded Agent Loop
JamCLI SHALL bound each turn by configurable limits sized for multi-step work and SHALL
enforce them in the core rather than in the interface.

#### Scenario: Reach the step limit
- **WHEN** the loop reaches the configured maximum step count, 50 by default
- **THEN** JamCLI stops the loop and reports that the limit was reached
- **AND** the interface offers to continue
- **AND** the limit is readable and configurable rather than a constant in a component

#### Scenario: Bound tool calls per step
- **WHEN** a tool call cap is configured and a step returns more calls than it allows
- **THEN** JamCLI runs calls up to the cap and gives every remaining call a result stating it was not run because of the cap
- **AND** no cap applies when it is zero, the default

#### Scenario: Truncate tool output
- **WHEN** a tool returns more than the configured character limit, 30,000 by default
- **THEN** JamCLI keeps the beginning and the end, states how much was removed, and places the result in context
- **AND** the truncation limit is configurable per tool class

#### Scenario: Budgets
- **WHEN** a token or cost budget is configured for a run
- **THEN** the run stops when the budget is exceeded and reports it

#### Scenario: Enforce limits in the core
- **WHEN** a turn runs from any surface
- **THEN** the same limits apply
- **AND** no surface can raise them implicitly

### Requirement: Configuration Persistence
JamCLI SHALL persist project configuration under `.jamcli/`, SHALL create that directory
only when something must be stored there, and SHALL keep it out of version control.

#### Scenario: Initialize configuration
- **WHEN** JamCLI starts in a project with no `.jamcli` directory
- **THEN** it runs on built-in and user defaults without creating files

#### Scenario: Create the directory when needed
- **WHEN** JamCLI first needs to store history or project configuration
- **THEN** it creates `.jamcli/` with a `.gitignore` that ignores the directory's contents

#### Scenario: Keep secrets out of the repository
- **WHEN** `.jamcli/` exists in a git repository
- **THEN** git ignores it whether or not the repository's own `.gitignore` mentions it

#### Scenario: Toggle telemetry
- **WHEN** the user changes the telemetry setting
- **THEN** JamCLI persists it, and it defaults to disabled

### Requirement: Transport-Agnostic Agent Core
JamCLI SHALL implement the agent loop in a core module that imports neither the terminal
interface nor its rendering libraries, and SHALL expose it to every consumer through the
runtime factory.

#### Scenario: Run a turn without the terminal UI
- **WHEN** a caller creates a runtime and runs a prompt
- **THEN** the turn executes, tools dispatch, and results stream back
- **AND** no terminal UI module is loaded

#### Scenario: Emit events instead of importing UI
- **WHEN** the core produces output during a turn
- **THEN** it emits typed events for turn and step boundaries, text, reasoning, tool calls, tool progress, tool results, usage, retries, compaction, notices, and approval requests
- **AND** it never imports a component from the UI tree

#### Scenario: Resolve approval through a callback
- **WHEN** the core needs a decision on an action
- **THEN** it emits an approval request carrying a decision callback
- **AND** the consuming surface answers the callback

#### Scenario: Share one core across consumers
- **WHEN** the terminal UI, the headless invocation, the ACP server, and workflow steps each start a session
- **THEN** all of them drive the same runtime
- **AND** behavior differences come only from rendering, configuration, and how approvals are answered

#### Scenario: Keep conversation state between prompts
- **WHEN** a consumer sends a second prompt to the same session
- **THEN** the provider receives the earlier exchange with it

#### Scenario: Cancel a running turn
- **WHEN** a consumer cancels a session
- **THEN** the in-flight provider stream and running tool calls abort
- **AND** the session remains usable for the next turn

### Requirement: Single Tool Protocol
JamCLI SHALL invoke tools exclusively through native tool calls, SHALL NOT interpret prose
as tool requests, and SHALL stream every step of a turn.

#### Scenario: Advertise tools natively
- **WHEN** a turn is sent to a provider that supports tool calling
- **THEN** the available tools are sent as provider tool definitions with their real JSON Schemas
- **AND** the system prompt does not instruct the model to emit a JSON block

#### Scenario: Consume a native tool call
- **WHEN** the provider returns tool calls
- **THEN** JamCLI dispatches each call through the tool registry
- **AND** appends the results as tool result messages

#### Scenario: Stream with tools
- **WHEN** tools are offered for a turn
- **THEN** the model's text and reasoning stream to the surface as they arrive

#### Scenario: Reject prose that resembles a tool request
- **WHEN** model text contains a fenced JSON block naming a tool
- **THEN** JamCLI treats that block as ordinary text and does not execute it

#### Scenario: Report an unusable tool call
- **WHEN** a returned tool call names an unknown tool or carries arguments that fail schema validation
- **THEN** JamCLI returns a tool error to the model naming the failure
- **AND** the turn continues rather than aborting

### Requirement: Tool Registry
JamCLI SHALL resolve tools from a registry in which each tool declares its name,
description, JSON Schema, policy class, and runner, and every surface SHALL offer tools
from that registry.

#### Scenario: Register a tool
- **WHEN** a tool is added to the registry
- **THEN** it becomes available to the model on every surface, to permission configuration, and to the approval flow without changes to any surface module

#### Scenario: Declare a policy class
- **WHEN** a tool is registered
- **THEN** it declares whether it reads, writes, executes, uses the network, or delegates
- **AND** tools that do not only read are subject to approval by default

#### Scenario: Validate arguments before dispatch
- **WHEN** a tool call arrives
- **THEN** its arguments are validated against the tool's JSON Schema before the runner executes
- **AND** a validation failure produces a tool error rather than an exception

#### Scenario: Expose schemas to MCP discovery
- **WHEN** the available tool list is assembled for any surface or for MCP discovery
- **THEN** each tool contributes its real JSON Schema rather than a permissive placeholder

#### Scenario: Aliases
- **WHEN** a tool is registered as an alias of another
- **THEN** calls to it are dispatched to the target and it is not advertised separately

### Requirement: Filesystem Write Tools
JamCLI SHALL provide tools that write new files, edit existing files, and apply
multi-file patches under the project root, with replacement text applied literally.

#### Scenario: Write a new file
- **WHEN** the model calls `write_file` with a path and content
- **THEN** JamCLI requests approval unless the mode or a rule allows it
- **AND** writes the file only after it is allowed

#### Scenario: Refuse to overwrite silently
- **WHEN** `write_file` targets a path that already exists
- **THEN** JamCLI reports the conflict and requires an explicit overwrite decision

#### Scenario: Edit via find and replace
- **WHEN** the model calls `edit` with a path, a find string, and a replacement
- **THEN** JamCLI replaces the matched text literally, including any `$` sequences, and reports the changed range

#### Scenario: Replace every occurrence
- **WHEN** the model calls `edit` with `replace_all`
- **THEN** every occurrence is replaced and the count is reported

#### Scenario: Refuse an ambiguous edit
- **WHEN** the find string matches more than one location and neither an occurrence index nor `replace_all` is supplied
- **THEN** JamCLI rejects the edit and reports the number of matches

#### Scenario: Preserve line endings
- **WHEN** a file uses CRLF line endings
- **THEN** edits and patches keep CRLF line endings

#### Scenario: Apply a multi-file patch
- **WHEN** the model calls `apply_patch` with a unified diff touching several files
- **THEN** JamCLI validates every hunk before writing and applies all of them or none

#### Scenario: Refuse a path outside the project
- **WHEN** a write, edit, or patch target resolves outside the project root, including through a symbolic link
- **THEN** JamCLI rejects the call

### Requirement: Generic Provider Endpoints
JamCLI SHALL route every OpenAI-compatible provider through a single client, SHALL allow
new endpoints to be added by configuration alone, and SHALL retry transient failures and
report provider errors with their cause.

#### Scenario: Add a compatible endpoint
- **WHEN** the user configures an endpoint with a base URL
- **THEN** JamCLI sends chat completions to that endpoint without a new provider implementation

#### Scenario: Discover models from an endpoint
- **WHEN** a configured endpoint exposes a models route
- **THEN** JamCLI lists those models in the model selector

#### Scenario: Read a key from the environment
- **WHEN** an endpoint declares a key environment variable
- **THEN** JamCLI reads the key from that variable
- **AND** does not require the secret to be stored in the project configuration

#### Scenario: Send streaming and non-streaming requests
- **WHEN** a request is issued in either mode
- **THEN** both modes parse content, reasoning deltas, tool calls, and usage through the same client

#### Scenario: Retry transient failures
- **WHEN** a request fails with a network error or a rate limit, overload, or server error status
- **THEN** JamCLI retries with backoff, honoring any retry delay the provider sends, and reports each retry

#### Scenario: Report provider errors
- **WHEN** a request fails and is not retried
- **THEN** the error states the provider, the status, the provider's message, and a suggested fix

#### Scenario: Translate an Anthropic-shaped provider
- **WHEN** a provider speaks the Anthropic Messages format
- **THEN** JamCLI translates requests and streaming responses through one translation seam
- **AND** tool calls, signed reasoning blocks, and cache usage survive the translation

#### Scenario: Keep reasoning with its provider
- **WHEN** a conversation switches from one provider family to another
- **THEN** reasoning blocks produced by the first are not sent to the second

#### Scenario: Support a local endpoint with no account
- **WHEN** Ollama is the configured provider and no network is available
- **THEN** model listing and chat completion continue to work

### Requirement: Delegated Task Execution
JamCLI SHALL delegate work to child agent runs that use the same runtime and tool
registry as the parent, and SHALL resolve each child's model from its own category.

#### Scenario: Delegate a task
- **WHEN** the model calls `task` with a category and a prompt
- **THEN** JamCLI starts a child run in the project root with its own session
- **AND** returns the child's final result to the parent

#### Scenario: Children can do the work
- **WHEN** a child run needs to read, edit, or run a command
- **THEN** it has the same tools as the parent, governed by the delegated policy

#### Scenario: Never inherit the parent model
- **WHEN** a child run starts
- **THEN** its model is resolved from its category chain
- **AND** it does not inherit the parent session's model

#### Scenario: Run a task in the background
- **WHEN** a task is requested in the background
- **THEN** the parent turn continues without waiting
- **AND** the result is retrievable when the child finishes

#### Scenario: Retrieve a background result
- **WHEN** the model requests the output of a background task
- **THEN** JamCLI returns the result if complete, and the current status otherwise

#### Scenario: Cancel a background task
- **WHEN** a background task is cancelled
- **THEN** the child run terminates and its partial output is reported

#### Scenario: Bound child permissions
- **WHEN** a child run needs a state-changing tool
- **THEN** it is governed by the policy configured for delegated runs
- **AND** a child cannot grant itself broader permissions than the parent

#### Scenario: Prevent unbounded nesting
- **WHEN** a child run would delegate further
- **THEN** delegation depth is bounded by configuration
- **AND** exceeding it returns an error instead of spawning another level

### Requirement: Tool Output Trust Gate
JamCLI SHALL screen tool results for prompt injection before they enter model context on
every surface, and SHALL bound and delimit the output it sends to the classifier.

#### Scenario: Classify tool results
- **WHEN** tool results are about to be appended to context
- **THEN** JamCLI submits them in one batched classification request scoring each result for relevance and injection

#### Scenario: Delimit untrusted output
- **WHEN** tool output is placed in the classification request
- **THEN** it is escaped so it cannot close or forge the result delimiters
- **AND** it is truncated to the configured bound

#### Scenario: Drop an injection first
- **WHEN** a result is classified as an injection
- **THEN** it is removed before relevance filtering is applied
- **AND** the transcript records that a result was removed and why

#### Scenario: Fail open
- **WHEN** the classification request fails, times out, or returns an unusable response
- **THEN** the unmodified results are kept
- **AND** the failure is reported without blocking the turn

#### Scenario: Never fall back to an injection
- **WHEN** filtering leaves no results
- **THEN** JamCLI returns an empty result set
- **AND** does not reintroduce a result that was classified as an injection

#### Scenario: Deduplicate before classifying
- **WHEN** tool results are prepared for screening
- **THEN** locally duplicated content is removed before the classification request is made

#### Scenario: Disable the gate
- **WHEN** the trust gate is disabled by configuration
- **THEN** tool results pass through unmodified
- **AND** the disabled state is visible in configuration

#### Scenario: Report the gate accurately
- **WHEN** the user inspects configuration or runs `jamcli doctor`
- **THEN** the reported gate state is the state that applies to the session's turns

### Requirement: Lifecycle Hooks
JamCLI SHALL expose lifecycle events that internal behavior, user-configured commands,
and plugins can observe and modify.

#### Scenario: Emit a lifecycle event
- **WHEN** a session starts, a prompt is submitted, a tool is about to run, a tool returns, a turn stops, context is about to be or has been compacted, a notification is raised, or a session ends
- **THEN** the corresponding event is emitted with its payload on every surface

#### Scenario: Register a hook
- **WHEN** a hook is registered for an event in code, in configuration, or by a plugin
- **THEN** it runs at that event and can inspect or modify the payload according to the event's contract

#### Scenario: Disable a hook
- **WHEN** a hook is disabled by configuration
- **THEN** it does not run
- **AND** the remaining hooks run normally

#### Scenario: Isolate a failing hook
- **WHEN** a hook throws or fails
- **THEN** the failure is reported as a notice, not as model output, and the turn continues

#### Scenario: Keep behavior out of components
- **WHEN** cross-cutting behavior such as context injection, output truncation, or continuation is implemented
- **THEN** it is implemented as a hook rather than inside a UI component

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

#### Scenario: Machine-readable output
- **WHEN** the user runs `jamcli audit --format sarif`
- **THEN** findings are emitted as SARIF

#### Scenario: Report without modifying
- **WHEN** the audit runs
- **THEN** it only reads and reports
- **AND** writes no files

### Requirement: Command Line Invocation
JamCLI SHALL support non-interactive invocation with machine-readable output and the same
tools, modes, and rules as the interactive surface.

#### Scenario: Run a prompt headlessly
- **WHEN** the user runs `jamcli -p "<prompt>"`, or pipes a prompt on standard input with `-p`
- **THEN** the turn runs without the terminal UI and the response is printed
- **AND** the process exits when the turn completes

#### Scenario: Select the output format
- **WHEN** the user selects a text, json, or stream-json output format
- **THEN** the result is emitted in that format
- **AND** the json form carries the session identifier, status, response, error, duration, turn count, usage, cost, provider, model, and permission denials
- **AND** the stream-json form carries every event, including tool output and notices

#### Scenario: Report an exit code
- **WHEN** the run completes
- **THEN** the exit code is zero on success, one on refusal, limit, or provider error, two on a usage error, and 130 when interrupted

#### Scenario: Constrain tools non-interactively
- **WHEN** the user passes allow or deny tool flags, rule patterns, or a permission mode
- **THEN** those govern the run without prompting
- **AND** a denied tool cannot run under any flag combination

#### Scenario: Preview without changing
- **WHEN** the user passes `--dry-run`
- **THEN** the run executes in plan mode and reports the changes it would have made

#### Scenario: Bound the run
- **WHEN** the user supplies a maximum turn count or a working directory
- **THEN** the run honors both

#### Scenario: Continue a session
- **WHEN** the user passes `--continue`
- **THEN** the most recent session in the project root is resumed

#### Scenario: Resume a specific session
- **WHEN** the user passes `--resume` with a session identifier
- **THEN** that session is loaded and continued

#### Scenario: Fork a session
- **WHEN** the user runs `/fork`
- **THEN** a new session is created from the current transcript
- **AND** the original session is left unchanged

### Requirement: MCP Streamable HTTP Transport
JamCLI SHALL support connecting to MCP servers over streamable HTTP in addition to stdio,
SHALL negotiate the newest protocol version both sides support, and SHALL authorize to
servers that require OAuth.

#### Scenario: Configure an HTTP server
- **WHEN** a server declares an HTTP transport with a URL and optional headers
- **THEN** JamCLI connects over streamable HTTP

#### Scenario: Keep stdio as the default
- **WHEN** a server declares no transport
- **THEN** JamCLI treats it as stdio

#### Scenario: Negotiate the protocol version
- **WHEN** JamCLI connects to a server
- **THEN** it uses the 2026-07-28 protocol when the server supports it and the newest older version the server supports otherwise

#### Scenario: Authorize with OAuth
- **WHEN** a server requires OAuth authorization
- **THEN** JamCLI runs the authorization code flow with PKCE in the browser, validates the issuer, and stores the tokens in the credential store

#### Scenario: Answer an elicitation
- **WHEN** a server asks the user for input during a call
- **THEN** the interface prompts for it, or asks before opening the browser for a URL request

#### Scenario: Manage servers from the command line
- **WHEN** the user runs `jamcli mcp add`, `list`, `test`, or `remove`
- **THEN** JamCLI performs that operation against `.jamcli/mcp.json`
- **AND** preserves unrelated configuration in the file

#### Scenario: Report connection state
- **WHEN** a server fails to connect or its authorization is refused
- **THEN** JamCLI reports the server as configured but not connected, with the reason
- **AND** continues with the remaining tools

### Requirement: ACP Agent Surface
JamCLI SHALL serve the Agent Client Protocol over stdio through the protocol's reference
SDK so editors and orchestrators can drive it with the same runtime as every other
surface.

#### Scenario: Start the ACP server
- **WHEN** the user runs `jamcli acp`
- **THEN** JamCLI speaks ACP over stdio

#### Scenario: Announce capabilities
- **WHEN** a client initializes the session
- **THEN** JamCLI returns its capabilities, including session loading, and agent information

#### Scenario: Create a session
- **WHEN** the client creates a session with a working directory and MCP servers
- **THEN** JamCLI returns a session identifier, connects those servers, and advertises its model, profile, and permission mode options

#### Scenario: Keep the conversation
- **WHEN** the client sends a second prompt in a session
- **THEN** the model receives the earlier exchange with it
- **AND** the session is persisted to history

#### Scenario: Load a session
- **WHEN** the client loads an existing session
- **THEN** JamCLI replays its transcript as session updates and continues it

#### Scenario: Stream a prompt
- **WHEN** the client sends a prompt
- **THEN** JamCLI streams message chunks, thought chunks, tool calls with diffs for edits, tool call updates, and plans
- **AND** completes the request when the turn ends

#### Scenario: Map permission decisions
- **WHEN** a tool call needs approval
- **THEN** JamCLI asks the client for permission with options to allow once, allow always, reject once, or reject always
- **AND** applies the client's decision as a grant or a denial

#### Scenario: Change the mode
- **WHEN** the client sets the session mode
- **THEN** JamCLI switches to the corresponding permission mode

#### Scenario: Use the editor's files and terminals
- **WHEN** the client advertises file system or terminal capabilities
- **THEN** JamCLI reads and writes open files through the client and can run commands in its terminals

#### Scenario: Cancel a turn
- **WHEN** the client cancels
- **THEN** the in-flight turn stops and the session remains usable

### Requirement: ACP Client Surface
JamCLI SHALL act as an ACP client through the protocol's reference SDK so it can delegate
to other agents instead of reimplementing them.

#### Scenario: Configure an external agent
- **WHEN** an agent command is configured
- **THEN** JamCLI can start it and open a session

#### Scenario: Delegate to an external agent
- **WHEN** the model or the user requests delegation to a configured agent with a prompt
- **THEN** JamCLI initializes the agent, opens a session in the project root, sends the prompt, and returns the result

#### Scenario: Expose delegation as a tool
- **WHEN** delegation is enabled
- **THEN** the model can call a delegation tool and a status tool for running delegations

#### Scenario: Apply the local policy to delegation
- **WHEN** a delegated agent requests permission for a state-changing action
- **THEN** JamCLI answers from its own permission engine
- **AND** the default policy requires a human decision in the interactive surface

#### Scenario: Cancel a delegation
- **WHEN** the user cancels
- **THEN** the delegated session is cancelled and the external process ends
