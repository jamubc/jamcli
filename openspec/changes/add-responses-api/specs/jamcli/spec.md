# Spec Delta

## MODIFIED Requirements

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

#### Scenario: A model served only through the Responses API
- **WHEN** an OpenAI-compatible endpoint refuses a model on Chat Completions and serves it through the Responses API
- **THEN** JamCLI asks that model through the Responses API from then on
- **AND** every such request tells the endpoint to store nothing
- **AND** when an effort is set, the model's encrypted reasoning is sent back to the same family on the next call
