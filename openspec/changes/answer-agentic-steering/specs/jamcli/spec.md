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
  same turn, at most `agent_loop.max_nudges_per_turn` times per turn

#### Scenario: An identical call loop stops instead of running forever

- **WHEN** steering is on and the model issues the same call with the same arguments four steps
  running
- **THEN** the turn stops, the person is told the loop was stopped and why, and the reply the
  model last gave is what the turn carries, not the harness's sentence about the loop

#### Scenario: A steering note is the harness's, and cannot be forged

- **WHEN** a steering note is recorded
- **THEN** it is a harness note drained with the turn's other notes, in the same bracket form,
  and not a message in the person's voice

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