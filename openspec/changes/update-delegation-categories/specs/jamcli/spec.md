## MODIFIED Requirements

### Requirement: Category-Based Model Routing
JamCLI SHALL resolve the model for a unit of work from a category that describes the
kind of work, not from a hardcoded model identifier, and SHALL let each category carry a
description of the work it suits.

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
- **AND** the resulting level is the one the run serving the work uses

#### Scenario: Describe a category
- **WHEN** a category is configured with a description and its models
- **THEN** the description is kept with the category
- **AND** it is shown wherever the categories are listed

#### Scenario: Existing category lists keep working
- **WHEN** a category is configured as a plain ordered list of models
- **THEN** it loads unchanged as a category with no description
- **AND** it routes exactly as it did before

### Requirement: Delegated Task Execution
JamCLI SHALL delegate work to child agent runs that use the same runtime and tool
registry as the parent, and SHALL resolve each child's model from its own category.

#### Scenario: Delegate a task
- **WHEN** the model calls `task` with a prompt, naming a category or relying on the configured default
- **THEN** JamCLI starts a child run in the project root with its own session
- **AND** returns the child's final result to the parent

#### Scenario: Delegate without naming a category
- **WHEN** the model calls `task` without a category and a default category is configured
- **THEN** the child runs on the default category
- **AND** when no default is configured, the call is refused with the categories named and no child starts

#### Scenario: Choose the reasoning for one task
- **WHEN** the model calls `task` with a reasoning level of off, on, or auto
- **THEN** that level replaces the category entry's level for that child only
- **AND** it is normalized against the child's model like any other level

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

## ADDED Requirements

### Requirement: Delegation Choice Presentation
JamCLI SHALL present the delegation categories to the model with each category's
description, the models it runs on, and the default, together with guidance on when and
how to delegate, and SHALL offer only categories it could route.

#### Scenario: List the categories with their descriptions
- **WHEN** the `task` tool is offered to the model
- **THEN** its description lists one line per category giving the name, the description, and the model chain it runs on
- **AND** states which category is used when none is named, or that a category must always be named

#### Scenario: The chain is shown as it is
- **WHEN** a category is listed
- **THEN** the models it runs on are generated from its configured chain, not written by hand
- **AND** a category with no description is listed with its name and chain alone

#### Scenario: Offer only routable categories
- **WHEN** no entry in a category's chain belongs to a configured provider
- **THEN** that category is not listed
- **AND** the check makes no network request

#### Scenario: Guide the choice
- **WHEN** the `task` tool is offered to the model
- **THEN** its description says when to delegate, when to do the work directly, and how to brief a child that starts without the conversation

#### Scenario: Stable within a session
- **WHEN** configuration changes while a session runs
- **THEN** the list the model sees and the routing the session uses stay consistent with each other until the next session

### Requirement: Delegation Settings
JamCLI SHALL let the person set the default delegation category and each category's
description through the settings command and through configuration files, as one store.

#### Scenario: Set the default from the categories command
- **WHEN** the person chooses a category in `/categories`
- **THEN** it is written as the default category to configuration through the same writer `/config set` uses
- **AND** the notice names the file written and says the change applies from the next session

#### Scenario: Set it from the command line or the file
- **WHEN** the person runs `jamcli config set delegation.default_category <name>` or edits the key by hand
- **THEN** `/categories` shows that category as the default
- **AND** the next session uses it

#### Scenario: Show where the default comes from
- **WHEN** the person runs `jamcli config list --show-origin`
- **THEN** the default category and each category's description are shown with the layer and file that set them

#### Scenario: Default names no category
- **WHEN** the configured default category is not one of the categories in effect
- **THEN** JamCLI names the file, the key, and the categories that exist
