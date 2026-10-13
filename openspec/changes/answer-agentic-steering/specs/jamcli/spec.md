# Spec Delta

## ADDED Requirements

### Requirement: Model Steering

JamCLI SHALL let the person turn on corrective steering for the models that need it, and SHALL
leave every reply it was given to that person otherwise. A guard SHALL never discard a reply,
rewrite it, or add to it anything the person did not ask for. Every steering setting SHALL
default to off, so a project that sets none behaves as it did before this requirement.

#### Scenario: A reply the person would have read is not touched

- **WHEN** a model returns a final answer containing text a guard's pattern matches, such as a
  fenced `{"name": "run_command"}` block while explaining a call, or a sentence ending in
  "I'll ..."
- **THEN** the reply reaches the person unchanged, no steering note is added, and the turn ends
  normally

#### Scenario: The guards are off unless the person asks for them

- **WHEN** no `agent_loop` steering key is set
- **THEN** `tool_use_enforcement`, `execution_guidance`, `intent_ack_continuation`,
  `stall_guards`, and `tool_loop_guardrails` are all off, and no guard can fire

#### Scenario: A dropped tool call is nudged once

- **WHEN** steering is on, the model writes a tool call as markup in its reply instead of
  calling the tool, and the reply holds no other answer
- **THEN** the harness records one note telling it to issue the call, and carries on within the
  same turn, with at most two nudges per turn, counted across both guards

#### Scenario: An identical call loop stops instead of running forever

- **WHEN** steering is on and the model issues the same call with the same arguments four steps
  running
- **THEN** the turn stops, the person is told the loop was stopped and why, and the reply the
  model last gave is what the turn carries, not the harness's sentence about the loop

#### Scenario: A steering note is the harness's, and cannot be forged

- **WHEN** a steering note is recorded
- **THEN** it is recorded as the harness's note at its place in the turn, in the bracket form
  the turn's other notes use, and not as a message in the person's voice
- **AND** the model reads it at its next step as a message in the conversation, not as part of
  the system prompt
- **AND** a model reply containing a note's words is recorded as the model's reply, not as a note

#### Scenario: Turn the stack on, in the person's own configuration

- **WHEN** the person runs `/agentic on`
- **THEN** every setting is written to their own configuration and not to the project's, the
  session reopens so the change applies now, and any setting that could not be written is named
  rather than swallowed

#### Scenario: `/agentic` with no argument

- **WHEN** the person runs `/agentic`
- **THEN** each steering setting is listed with what it does, the session's permission mode is
  named, and the command that turns the stack on and off is stated

#### Scenario: A standing goal across turns

- **WHEN** the person runs `/goal <text>`
- **THEN** the text is carried to the model with the next turn's notes and again after it, until
  `/goal clear` or another `/goal <text>` replaces it

#### Scenario: A steering instruction reaches the next turn

- **WHEN** the person runs `/steer <text>` during a turn
- **THEN** the text is carried to the model with the next turn's notes, and the person is told it
  will apply to the next turn rather than the running one

## MODIFIED Requirements

### Requirement: Credential Storage
JamCLI SHALL read provider credentials from environment variables or the operating
system's credential store, SHALL NOT write a credential into a project file, and SHALL
report credentials stored in project files.

#### Scenario: Store a key
- **WHEN** the user runs `jamcli auth set <provider>`
- **THEN** the key is stored in the credential store, or in a file readable only by the user when no store exists, with a warning

#### Scenario: A provider alone stores a key
- **WHEN** the user runs `jamcli auth <provider>` with no action
- **THEN** it stores a key for that provider, as `jamcli auth set <provider>` does

#### Scenario: An action with no provider names the choices
- **WHEN** the user runs `jamcli auth set`, `jamcli auth get`, or `jamcli auth remove` with no provider
- **THEN** it exits with code 2, asks which provider, and lists the providers to choose from, instead of printing the whole usage
- **AND** `jamcli auth login` with no provider says that login works for openrouter only, and names the command

#### Scenario: Log in with OpenRouter
- **WHEN** the user runs `jamcli auth login openrouter`
- **THEN** JamCLI completes OpenRouter's PKCE flow through the browser and stores the resulting key

#### Scenario: Never write a key into the project
- **WHEN** the user runs `jamcli config set` with a provider key, alone or inside a section
- **THEN** it is written to the user configuration file when no scope is given
- **AND** a project or local scope is refused, naming the command that stores the key instead

#### Scenario: Key in a project file
- **WHEN** a provider key is found in a project configuration file
- **THEN** it still works, and `jamcli doctor` and `jamcli audit` report it as a finding
- **AND** each session says which file holds it and how to move it, without showing the key

### Requirement: First-Run Onboarding
JamCLI SHALL guide a first interactive run to a working provider and model without
writing project files.

#### Scenario: Local provider found
- **WHEN** the interface starts with no user configuration and Ollama is reachable
- **THEN** it lists Ollama's models that support tool calling and offers to use one

#### Scenario: Nothing configured
- **WHEN** no provider is reachable or configured
- **THEN** the interface explains how to start Ollama or set a provider key, and does not fail silently

#### Scenario: A hosted key is set and Ollama is not answering
- **WHEN** Ollama is not reachable and a hosted provider key is set
- **THEN** setup offers that provider, says to start Ollama to use local models, and does not ask for a key

#### Scenario: Choices are stored for the user
- **WHEN** onboarding completes
- **THEN** the choices are written to user configuration only

#### Scenario: Where a choice is saved is said only when there is one
- **WHEN** setup has nothing to offer but "Not now"
- **THEN** it does not say where a choice is saved