## MODIFIED Requirements

### Requirement: Web Fetch Tool
JamCLI SHALL provide a tool that retrieves a URL as readable text, governed as network
access, preserving the page's links and preferring its main content.

#### Scenario: Fetch a page
- **WHEN** the model fetches a URL and the call is allowed
- **THEN** it receives the page as readable text with the final URL after redirects

#### Scenario: Ask by default
- **WHEN** no rule covers the URL's domain
- **THEN** the call asks for approval

#### Scenario: Links survive
- **WHEN** a fetched page contains a link
- **THEN** the text names both the link's words and its target, so the model can fetch it next

#### Scenario: Main content preferred
- **WHEN** a fetched page marks its main content
- **THEN** navigation, footers, and sidebars are left out of the text

#### Scenario: A repeated URL is served from memory
- **WHEN** the model fetches the same URL again within the cache lifetime
- **THEN** the text is returned without a second request to the site
- **AND** the cache is in-process, expires, and never touches disk

#### Scenario: A refinement stage stands between the page and the model
- **WHEN** a page has been reduced to text
- **THEN** it passes through a refinement stage before it is returned
- **AND** the stage is an identity pass, so the text is unchanged

## ADDED Requirements

### Requirement: Web Search Tool
JamCLI SHALL provide a tool that answers a query with ranked web results from a
configured search provider, governed as network access.

#### Scenario: Search the web
- **WHEN** the model searches with a query and the call is allowed
- **THEN** it receives ranked results, each with its URL, title, and text
- **AND** a result carrying a publication date says so in its text

#### Scenario: Recency is the model's to ask for
- **WHEN** the model needs results from a named period rather than any time
- **THEN** it can state that period in the call, and the provider is asked for it

#### Scenario: No provider configured
- **WHEN** no search provider's key resolves
- **THEN** the tool is not offered to the model at all, rather than offered and failing

#### Scenario: Ask by default
- **WHEN** no rule covers the configured provider's host
- **THEN** the call asks for approval

#### Scenario: Rules name the provider
- **WHEN** a rule names the configured provider's host, as in `web_search(domain:api.langsearch.com)`
- **THEN** that rule decides the call
- **AND** a rule that names a host no configured provider reaches never silently decides it

#### Scenario: Duplicate results are dropped
- **WHEN** two results are the same page or repeat the same text
- **THEN** one of them is returned

#### Scenario: A refinement stage stands between the results and the model
- **WHEN** results have been retrieved
- **THEN** they pass through a refinement stage before they are returned
- **AND** the stage is an identity pass, so the results are unchanged

#### Scenario: The provider fails
- **WHEN** the provider returns an error or cannot be reached
- **THEN** the tool reports why, and the session continues

### Requirement: Search Provider Configuration
JamCLI SHALL let a user configure a web search provider in configuration the way model
providers are configured, naming the environment variable that holds its key.

#### Scenario: Declare a provider's key
- **WHEN** a provider entry names the environment variable holding its key
- **THEN** the key is read from that variable

#### Scenario: Key precedence
- **WHEN** a key is available from more than one place
- **THEN** the declared variable is preferred, then a key in the file, then the provider's
  well-known variable, then the stored credential

#### Scenario: The key stays out of output
- **WHEN** the key's value would appear in output, or a subprocess environment is built
- **THEN** the value is scrubbed from the output and the variable is withheld from the subprocess

#### Scenario: Replace a built-in provider's settings
- **WHEN** a user's configuration names a provider the built-in registry already names
- **THEN** the user's entry governs
