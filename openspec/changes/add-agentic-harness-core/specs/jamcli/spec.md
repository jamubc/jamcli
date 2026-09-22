# JamCLI Specification Delta: Agentic Harness Core

Capability: `jamcli`

## ADDED Requirements

### Requirement: Transport-Agnostic Agent Core
JamCLI SHALL implement the agent loop in a core module that imports neither Ink nor
React, and SHALL expose it to every consumer through a typed interface.

#### Scenario: Run a turn without the terminal UI
- **WHEN** a caller constructs the core agent and runs a prompt
- **THEN** the turn executes, tools dispatch, and results stream back
- **AND** no terminal UI module is loaded

#### Scenario: Emit events instead of importing UI
- **WHEN** the core produces output during a turn
- **THEN** it emits typed events for text, reasoning, tool call, tool result, usage, and approval request
- **AND** it never imports a component from the UI tree

#### Scenario: Resolve approval through a callback
- **WHEN** the core needs a decision on a state-changing action
- **THEN** it emits an approval request carrying a decision callback
- **AND** the consuming surface answers the callback

#### Scenario: Share one core across consumers
- **WHEN** the terminal UI, the headless invocation, and the ACP server each start a session
- **THEN** all three drive the same core implementation
- **AND** behavior differences come only from their policy configuration

#### Scenario: Cancel a running turn
- **WHEN** a consumer cancels a session
- **THEN** the in-flight provider stream and pending tool calls abort
- **AND** the session remains usable for the next turn

### Requirement: Single Tool Protocol
JamCLI SHALL invoke tools exclusively through native tool calls and SHALL NOT interpret prose as tool requests.

#### Scenario: Advertise tools natively
- **WHEN** a turn is sent to a provider that supports tool calling
- **THEN** the available tools are sent as provider tool definitions with JSON Schemas
- **AND** the system prompt does not instruct the model to emit a JSON block

#### Scenario: Consume a native tool call
- **WHEN** the provider returns tool calls
- **THEN** JamCLI dispatches each call through the tool registry
- **AND** appends the results as tool result messages

#### Scenario: Reject prose that resembles a tool request
- **WHEN** model text contains a fenced JSON block naming a tool
- **THEN** JamCLI treats that block as ordinary text and does not execute it

#### Scenario: Report an unusable tool call
- **WHEN** a returned tool call names an unknown tool or carries arguments that fail schema validation
- **THEN** JamCLI returns a tool error to the model naming the failure
- **AND** the turn continues rather than aborting

### Requirement: Tool Registry
JamCLI SHALL resolve tools from a registry in which each tool declares its name,
description, JSON Schema, policy class, and runner.

#### Scenario: Register a tool
- **WHEN** a tool is added to the registry
- **THEN** it becomes available to the model, to permission configuration, and to the approval flow without changes to any component

#### Scenario: Declare a policy class
- **WHEN** a tool is registered
- **THEN** it declares whether it is a read tool or a state-changing tool
- **AND** state-changing tools are subject to approval policy by default

#### Scenario: Validate arguments before dispatch
- **WHEN** a tool call arrives
- **THEN** its arguments are validated against the tool's JSON Schema before the runner executes
- **AND** a validation failure produces a tool error rather than an exception

#### Scenario: Expose schemas to MCP discovery
- **WHEN** the available tool list is assembled
- **THEN** each built-in tool contributes its real JSON Schema rather than a permissive placeholder

### Requirement: Filesystem Write Tools
JamCLI SHALL provide tools that write new files and edit existing files under the
project root.

#### Scenario: Write a new file
- **WHEN** the model calls `write_file` with a path and content
- **THEN** JamCLI requests approval
- **AND** writes the file only after approval

#### Scenario: Refuse to overwrite silently
- **WHEN** `write_file` targets a path that already exists
- **THEN** JamCLI reports the conflict and requires an explicit overwrite decision

#### Scenario: Edit via find and replace
- **WHEN** the model calls `edit` with a path, a find string, and a replacement
- **THEN** JamCLI replaces the matched text and reports the changed range

#### Scenario: Refuse an ambiguous edit
- **WHEN** the find string matches more than one location and no occurrence index is supplied
- **THEN** JamCLI rejects the edit and reports the number of matches

#### Scenario: Refuse a path outside the project
- **WHEN** a write or edit target resolves outside the project root
- **THEN** JamCLI rejects the call

### Requirement: Edit Reliability
JamCLI SHALL anchor edits to the file state the model actually read, and SHALL reject
an edit whose anchor no longer matches.

#### Scenario: Return stable anchors on read
- **WHEN** `read_file` returns content
- **THEN** each returned line carries an anchor identifying its content
- **AND** the anchors are stable for unchanged content

#### Scenario: Apply an anchored edit
- **WHEN** the model edits by referencing returned anchors
- **THEN** JamCLI applies the change and reports the lines affected

#### Scenario: Reject a stale edit
- **WHEN** the referenced anchors no longer match the file on disk because it changed since the read
- **THEN** JamCLI rejects the edit, states that the file changed, and returns fresh anchors
- **AND** the file on disk is left unmodified

#### Scenario: Detect an external change between turns
- **WHEN** a file read in an earlier turn is edited externally
- **THEN** a subsequent anchored edit against the old anchors is rejected rather than applied to the wrong lines

### Requirement: Generic Provider Endpoints
JamCLI SHALL route every OpenAI-compatible provider through a single client and SHALL
allow new endpoints to be added by configuration alone.

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

#### Scenario: Translate an Anthropic-shaped provider
- **WHEN** a provider speaks the Anthropic Messages format
- **THEN** JamCLI translates requests and streaming responses through one translation seam
- **AND** tool calls and reasoning blocks survive the translation

#### Scenario: Support a local endpoint with no account
- **WHEN** Ollama is the configured provider and no network is available
- **THEN** model listing and chat completion continue to work

### Requirement: Category-Based Model Routing
JamCLI SHALL resolve the model for a unit of work from a category that describes the
kind of work, not from a hardcoded model identifier.

#### Scenario: Route by category
- **WHEN** work is dispatched with a category
- **THEN** JamCLI resolves that category to its configured model chain
- **AND** uses the first model in the chain that the active providers can serve

#### Scenario: Resolve a configured chain
- **WHEN** a category defines an ordered list of models
- **THEN** JamCLI walks the list in order and skips models whose provider is not configured

#### Scenario: Fall back when a model is unavailable
- **WHEN** the first model in a chain cannot be reached
- **THEN** JamCLI advances to the next entry rather than failing the turn
- **AND** records which model actually served the work

#### Scenario: Keep the session model independent of routing
- **WHEN** a session runs on a user-selected model
- **THEN** category routing applies only to delegated work
- **AND** the session model is unchanged

#### Scenario: Report the resolved model
- **WHEN** a request is routed
- **THEN** the resolved model and category are visible in the transcript

#### Scenario: Normalize reasoning capability
- **WHEN** a routing entry requests a reasoning level
- **THEN** JamCLI normalizes that level against the target model's known capability
- **AND** drops or downgrades the level rather than sending an unsupported value

### Requirement: Delegated Task Execution
JamCLI SHALL delegate work to child agent runs and SHALL resolve each child's model from
its own category.

#### Scenario: Delegate a task
- **WHEN** the model calls `task` with a category and a prompt
- **THEN** JamCLI starts a child run in the project root with its own session
- **AND** returns the child's final result to the parent

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
JamCLI SHALL screen tool results for prompt injection before they enter model context.

#### Scenario: Classify tool results
- **WHEN** tool results are about to be appended to context
- **THEN** JamCLI submits them in one batched classification request scoring each result for relevance and injection

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

### Requirement: Project Rules Hierarchy
JamCLI SHALL load project instruction files from the project root down to the working
directory and inject them into the system prompt.

#### Scenario: Load rules from ancestors
- **WHEN** a session starts in a subdirectory
- **THEN** JamCLI collects each instruction file found between the project root and the working directory
- **AND** injects them in order from outermost to innermost

#### Scenario: Apply conditional rules
- **WHEN** an instruction file declares a condition for a path or a file pattern
- **THEN** that section applies only when the condition matches the current work

#### Scenario: Report loaded rules
- **WHEN** the user inspects configuration
- **THEN** JamCLI lists every instruction file loaded and its resolved path

#### Scenario: Respect a missing rules file
- **WHEN** no instruction file exists
- **THEN** the session starts with the profile system prompt alone

### Requirement: Lifecycle Hooks
JamCLI SHALL expose lifecycle events that internal behavior and user configuration can
observe and modify.

#### Scenario: Emit a lifecycle event
- **WHEN** a session starts, a turn begins, a tool is about to run, a tool returns, context is compacted, or a session ends
- **THEN** the corresponding event is emitted with its payload

#### Scenario: Register a hook
- **WHEN** a hook is registered for an event
- **THEN** it runs at that event and can inspect or modify the payload according to the event's contract

#### Scenario: Disable a hook
- **WHEN** a hook is disabled by configuration
- **THEN** it does not run
- **AND** the remaining hooks run normally

#### Scenario: Isolate a failing hook
- **WHEN** a hook throws
- **THEN** the failure is reported and the turn continues

#### Scenario: Keep behavior out of components
- **WHEN** cross-cutting behavior such as context injection, output truncation, or continuation is implemented
- **THEN** it is implemented as a hook rather than inside a UI component

### Requirement: Delegation Audit
JamCLI SHALL provide an audit command that reviews agent definitions, rules files, and
tool permissions for unsafe combinations.

#### Scenario: Run the audit
- **WHEN** the user runs `jamcli audit`
- **THEN** JamCLI scans instruction files, agent definitions, and skill definitions in the project
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

#### Scenario: Report without modifying
- **WHEN** the audit runs
- **THEN** it only reads and reports
- **AND** writes no files

### Requirement: Command Line Invocation
JamCLI SHALL support non-interactive invocation with machine-readable output.

#### Scenario: Run a prompt headlessly
- **WHEN** the user runs `jamcli -p "<prompt>"`
- **THEN** the turn runs without the terminal UI and the response is printed
- **AND** the process exits when the turn completes

#### Scenario: Select the output format
- **WHEN** the user selects a text, json, or stream-json output format
- **THEN** the result is emitted in that format
- **AND** the json form carries the session identifier, status, response, duration, turn count, and usage

#### Scenario: Report an exit code
- **WHEN** the run completes
- **THEN** the exit code is zero on success, one on refusal or limit, and two on a usage error

#### Scenario: Constrain tools non-interactively
- **WHEN** the user passes allow or deny tool flags
- **THEN** those flags govern the run without prompting
- **AND** a denied tool cannot run under any flag combination

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
JamCLI SHALL support connecting to MCP servers over streamable HTTP in addition to
stdio.

#### Scenario: Configure an HTTP server
- **WHEN** a server declares an HTTP transport with a URL and optional headers
- **THEN** JamCLI connects over streamable HTTP

#### Scenario: Keep stdio as the default
- **WHEN** a server declares no transport
- **THEN** JamCLI treats it as stdio

#### Scenario: Manage servers from the command line
- **WHEN** the user runs `jamcli mcp add`, `list`, `test`, or `remove`
- **THEN** JamCLI performs that operation against `.jamcli/mcp.json`
- **AND** preserves unrelated configuration in the file

#### Scenario: Report connection state
- **WHEN** a server requires authentication or fails to connect
- **THEN** JamCLI reports the server as configured but not connected
- **AND** continues with the remaining tools

### Requirement: ACP Agent Surface
JamCLI SHALL serve the Agent Client Protocol over stdio so editors and orchestrators can
drive it.

#### Scenario: Start the ACP server
- **WHEN** the user runs `jamcli acp`
- **THEN** JamCLI speaks ACP over stdio

#### Scenario: Announce capabilities
- **WHEN** a client initializes the session
- **THEN** JamCLI returns its capabilities and agent information

#### Scenario: Create a session
- **WHEN** the client creates a session with a working directory and MCP servers
- **THEN** JamCLI returns a session identifier and advertises its model and profile options

#### Scenario: Stream a prompt
- **WHEN** the client sends a prompt
- **THEN** JamCLI streams message chunks, thought chunks, tool calls, and tool call updates
- **AND** completes the request when the turn ends

#### Scenario: Map permission decisions
- **WHEN** a state-changing tool needs approval
- **THEN** JamCLI asks the client for permission
- **AND** applies the client's decision

#### Scenario: Cancel a turn
- **WHEN** the client cancels
- **THEN** the in-flight turn stops and the session remains usable

### Requirement: ACP Client Surface
JamCLI SHALL act as an ACP client so it can delegate to other agents instead of
reimplementing them.

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
- **THEN** JamCLI answers from its own policy configuration
- **AND** the default policy requires a human decision in the interactive surface

#### Scenario: Cancel a delegation
- **WHEN** the user cancels
- **THEN** the delegated session is cancelled and the external process ends

## MODIFIED Requirements

### Requirement: Read-Only Tool Execution
JamCLI SHALL execute read tools without approval, constrained to the project root, and
SHALL resolve them through the tool registry with real JSON Schemas.

#### Scenario: List files
- **WHEN** the model requests `list_files` with an optional glob pattern
- **THEN** JamCLI returns matching paths under the project root
- **AND** respects the configured ignore patterns
- **AND** caps results at 200

#### Scenario: Read a file range
- **WHEN** the model requests `read_file` with a path and optional line range
- **THEN** JamCLI returns the requested lines with their line numbers and anchors
- **AND** truncates output beyond 64 KB
- **AND** reports when output was truncated

#### Scenario: Search code
- **WHEN** the model requests `search_code` with a query or a regular expression
- **THEN** JamCLI returns matching file, line, and trimmed line text
- **AND** caps matches at 40 and scanned files at 400
- **AND** skips files larger than 512 KB

#### Scenario: List files by pattern
- **WHEN** the model requests `glob` with a pattern
- **THEN** JamCLI returns matching paths ordered by most recently modified

#### Scenario: Search by regular expression
- **WHEN** the model requests `grep` with a pattern
- **THEN** JamCLI returns matches with file, line, and surrounding context
- **AND** applies the configured ignore patterns

#### Scenario: Refuse a path outside the project
- **WHEN** a read or list target resolves outside the project root
- **THEN** JamCLI rejects the call with a message stating the path escapes the project root

#### Scenario: Validate arguments
- **WHEN** a read tool call arrives with arguments that fail its schema
- **THEN** JamCLI returns a tool error naming the invalid argument
- **AND** does not execute the tool

### Requirement: Approval-Gated State Changes
JamCLI SHALL require an explicit decision before any state-changing action, and the
decision SHALL come from the active surface's policy.

#### Scenario: Request approval for a patch
- **WHEN** the model proposes a state-changing action in the interactive interface
- **THEN** the interface presents the action for approval
- **AND** the action runs only after the user approves

#### Scenario: Request approval for a command
- **WHEN** the model proposes `run_command`
- **THEN** the interface presents the command with its working directory for approval
- **AND** the command runs only after the user approves

#### Scenario: Reject a proposed action
- **WHEN** an action is rejected
- **THEN** it is recorded as rejected
- **AND** nothing is written to disk and no command runs

#### Scenario: Resolve approval in a non-interactive run
- **WHEN** a state-changing action is proposed in a headless run
- **THEN** the decision is resolved from the run's allow and deny policy
- **AND** an action that policy does not allow is refused rather than prompted

#### Scenario: Record every decision
- **WHEN** any approval request is resolved
- **THEN** the transcript records the action, the decision, and which surface decided

### Requirement: Tool Permission Policy
JamCLI SHALL govern each tool with an allow, ask, or deny setting, and SHALL let
non-interactive runs constrain tools without changing project configuration.

#### Scenario: Disable a tool
- **WHEN** the user sets a tool to deny
- **THEN** JamCLI does not offer that tool to the model on subsequent turns

#### Scenario: Require approval for a read tool
- **WHEN** the user sets a read tool to ask
- **THEN** that tool routes through the approval flow

#### Scenario: Allow a state-changing tool
- **WHEN** the user sets a state-changing tool to allow
- **THEN** it runs without prompting in the interactive surface
- **AND** the setting is visible in configuration rather than implicit

#### Scenario: Constrain a non-interactive run
- **WHEN** `--deny-tool` is passed for a tool
- **THEN** that tool cannot run in the run regardless of project configuration

#### Scenario: Default to gating
- **WHEN** no explicit permission is configured for a state-changing tool
- **THEN** it requires approval

#### Scenario: Persist a permission change
- **WHEN** a permission changes
- **THEN** JamCLI writes it to `.jamcli/mcp.json` under `tools`

### Requirement: Provider Configuration
JamCLI SHALL support a local provider, any OpenAI-compatible endpoint, and a
translated Anthropic-shaped endpoint, and SHALL NOT present providers it cannot serve.

#### Scenario: Configure Ollama
- **WHEN** the user sets the Ollama endpoint
- **THEN** JamCLI persists it in `.jamcli/config.json` under `api_registry.ollama.endpoint`

#### Scenario: Configure OpenRouter
- **WHEN** the user supplies an OpenRouter API key or names an environment variable holding it
- **THEN** JamCLI uses that credential for subsequent OpenRouter requests

#### Scenario: Configure a custom compatible endpoint
- **WHEN** the user registers an endpoint with an identifier and a base URL
- **THEN** JamCLI persists it and offers it as a provider in the model selector

#### Scenario: Configure an Anthropic-shaped endpoint
- **WHEN** the user registers an endpoint that speaks the Anthropic Messages format
- **THEN** JamCLI translates requests and responses through the Anthropic seam

#### Scenario: Reject an unconfigured provider
- **WHEN** a provider is requested that has no endpoint or credential configured
- **THEN** JamCLI reports the provider as unconfigured
- **AND** names the configuration key that would enable it

#### Scenario: Keep credentials out of the project file
- **WHEN** a provider supports reading its key from the environment
- **THEN** JamCLI prefers the environment variable over a value stored in configuration

### Requirement: Model Discovery
JamCLI SHALL discover models from the active provider rather than requiring a
hand-maintained list.

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
- **THEN** the interface shows the model identifier, provider, description, and whether it supports tool calling

### Requirement: Project Rules and Tool Guidance
JamCLI SHALL compose the system prompt from the active profile, the project rules
hierarchy, and tool guidance, and SHALL keep that composition outside the UI layer.

#### Scenario: Load project instructions
- **WHEN** a session starts
- **THEN** JamCLI loads the instruction files between the project root and the working directory

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
- **THEN** JamCLI shows the effective system prompt and which parts came from the profile, the rules hierarchy, and tool guidance

### Requirement: Session Listing and Export
JamCLI SHALL list, search, and export stored sessions from the command line as well as
the interface.

#### Scenario: List sessions
- **WHEN** the user runs `jamcli sessions list`
- **THEN** JamCLI returns the most recent sessions with their metadata

#### Scenario: Search sessions
- **WHEN** the user runs `jamcli sessions search` with a query
- **THEN** JamCLI returns sessions whose content matches, up to a limit

#### Scenario: Export a session
- **WHEN** the user runs `jamcli sessions export`
- **THEN** JamCLI renders the session as Markdown and writes the export to disk

#### Scenario: Keep session storage compatible
- **WHEN** sessions are listed, searched, or exported
- **THEN** the existing JSONL session files under `.jamcli/history/` are read without migration

### Requirement: Bounded Agent Loop
JamCLI SHALL bound each turn by configurable limits and SHALL enforce them in the core
rather than in the interface.

#### Scenario: Reach the step limit
- **WHEN** the loop reaches the configured maximum step count
- **THEN** JamCLI stops the loop and reports that the limit was reached
- **AND** the limit is readable and configurable rather than a constant in a component

#### Scenario: Bound tool calls per step
- **WHEN** a step returns more tool calls than the per-step maximum
- **THEN** JamCLI executes up to that maximum
- **AND** reports that calls were deferred

#### Scenario: Truncate tool output
- **WHEN** a tool returns more than the configured character limit
- **THEN** JamCLI truncates the output before placing it in context
- **AND** the truncation limit is configurable per tool class

#### Scenario: Enforce limits in the core
- **WHEN** a turn runs from any surface
- **THEN** the same limits apply
- **AND** no surface can raise them implicitly

## REMOVED Requirements

### Requirement: Fenced JSON Action Protocol
**Reason**: Two tool protocols cannot both be authoritative. Prose that the harness
parses as commands is unverifiable: the model can describe an action without taking it,
and the harness can act on text the model meant as an example. Native tool calling
already exists in the codebase and is the only protocol the provider APIs define.

**Migration**: Native tool calls fully replace the fenced format. Any prompt, profile
system prompt, or project rules file that describes the JSON action format must be
updated, because those instructions are now actively misleading. Existing sessions are
unaffected, since session history stores messages rather than actions. The `edit`,
`write_file`, `glob`, and `grep` tools replace what `apply_patch` and `search_code`
covered in the fenced form.
