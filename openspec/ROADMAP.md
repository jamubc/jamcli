# Roadmap

What comes after `v2.0.0`, as units, in order. `SEQUENCE.md` carries the working rule: one
unit in flight, on its branch, finished only when archived. This file says which unit is
next and why, and records the owner decisions that shape all of them, so no unit has to
re-ask.

Written 2026-09-26 from session `2026-09-26-de8c4d4a`, the Claude Code source at
`claude-code-main/src` (2026-03-31 snapshot), the models.dev registry, LiteLLM's router
documentation, and Guardrails AI's validator model. Paths into this repository are cited
so each claim can be checked.

## The thesis in one paragraph

jamcli's harness is sound: layered configuration with origins, a credential store, a model
chain per category, hooks that can rewrite a call or block it, rules, skills, sessions,
and a trust gate. What it lacks is the language and the seams that let a person shape it
without reading source. The model delegates blind (`src/core/runtime/index.ts:514` offers
category names and nothing else). A person can hold one key per provider and cannot name
a second account. A rate limit ends the conversation. Nothing stands between an agent's
answer and its reader. Each unit below adds one of those seams, on top of a part that
already exists, and none of them invents a mechanism another tool has not already proved.

## Owner decisions (2026-09-26)

Recorded once here. A unit that needs to revisit one says so in its proposal.

1. **The model chooses among configured agents, never a raw `provider:model`.** A list of
   thousands of ids is a guess, not a choice. Claude Code's own override is a three-value
   enum (`tools/AgentTool/AgentTool.tsx:86`).
2. **Built-in agents are `quick`, `intelligent`, `explore`, `writing`.** `deep` is gone.
3. **One concept, agents, folded in before any code is written.** Categories become the
   compatibility form of an agent with no rules body.
4. **Rules and stages apply to delegated agents only**, not the main conversation, in the
   first cut. The main conversation keeps today's behavior.
5. **A connection's name is a ref prefix.** `work:anthropic/claude-sonnet-4.5`. No new
   grammar: `resolveModel` (`src/core/runtime/model.ts:18-30`) already treats a custom
   endpoint id as a prefix through `knownProvider`. Built-in providers are connections
   with fixed names.
6. **Credentials: several accounts across several providers, many endpoints, rotation and
   fallback, team-shared config without secrets.** Nothing invented: the provider table
   is models.dev's, the failover semantics are LiteLLM's, the failure actions are
   Guardrails AI's.
7. **Settings and configuration are one store.** No parallel settings file. A command
   that changes a setting writes the configuration file and names it.
8. **Everything a person configures is observable**: listed by a command, recorded in the
   transcript when it acts, testable on sample input. No invisible force.

## Units, in order

Each unit is one openspec change. Its number is its order. A unit may start only when the
one before it is archived.

### 1. `add-agents` (archived 2026-09-27)

Done as below, with one change: the built-ins have no chain and run on the session's
model, not a local one. See `openspec/SEQUENCE.md`.


The open proposal, reframed. An agent is one markdown file, `agents/<name>.md` under the
user or project `.jamcli` directory, the way skills already load
(`src/core/ext/skills.ts:39-47`). Frontmatter carries `description`, `models` (the chain,
each entry with optional `reasoning`), and later fields other units add. The body is the
agent's rules: text the child reads as part of its system prompt and nothing else reads.
The four built-ins are agents with descriptions and no body, overridable by a file of the
same name. The `categories` configuration key keeps loading as an agent with no body.

The `task` tool lists agents to the model one line each, `- name: description (runs on
chain)`, inside guidance on when to delegate, when not to, and how to brief a child.
`agent` is optional and `delegation.default_agent` names the default. `reasoning` on the
call overrides the entry's level. The level actually reaches the child, which it does not
today (`src/core/runtime/children.ts:104-108` passes the model alone). `/agents` lists
them and sets the default through the configuration writer.

Why first: it is the smallest unit, it fixes the session that started this, and every
later unit hangs fields off the agent file.

### 2. `add-surface-parity` (open)

Opened by the owner on 2026-09-27, ahead of the units below. Built-in commands move out of
the interface into `src/commands/`, one set every surface runs: the interface, headless
`-p`, and ACP. Where no screen offers a list, `/choose` answers it. The ACP observer says
when a waiting call's tool always asks. See the change for the whole of it.

### 3. `add-mcp-server`

`jamcli mcp serve`: JamCLI as a tool for other agents, the way `claude mcp serve` is, so an
agent host (OpenCode, Claude Code, or JamCLI itself) can delegate work to JamCLI, and an
agent can use JamCLI's interface to find what is wrong with it, with nothing hand-rolled
around it. Two groups of tools on one stdio server:

- `session_*` (`start`, `send`, `answer`, `state`, `stop`): delegated work, built directly
  on the ACP session controller and the command host, so MCP means what ACP means. A turn
  that needs an answer returns the question; long turns report progress.
- `terminal_*` (`start`, `type`, `keys`, `screen`, `wait`, `resize`, `stop`): the ordinary
  `jamcli` program in a pseudo-terminal, read through a terminal emulator, from the harness
  the end-to-end tests use. There is no driven mode: the program is the one a person runs,
  launched as the shipped build launches. Each session is kept as an asciinema recording.

The person's answers stay the person's: a call to a tool that always asks is put to the
person through MCP elicitation in their own agent host, never answered by the calling agent,
and denied where the host cannot ask. Whether Claude Code and OpenCode support elicitation
is to be verified before the spec claims it. The bypass confirmation and the hooks trust
question show only on screen and are the person's by rule. A driven JamCLI never runs in
JamCLI's own checkout: it runs in a throwaway worktree of a fixture project, so its sessions
do not land in this repository's history and `/reflect` never learns from its experiments.

Acceptance: task 6.2 of `add-session-reflection` runs through `jamcli mcp serve`, an agent
driving `/reflect` over the owner's sessions and the owner approving each lesson by
elicitation. `jamcli-trials`, which imports JamCLI's source rather than using the product,
moves onto it.

### 4. `add-findings-loop`

What an agent finds while using JamCLI becomes an openspec proposal through the same gates
as any change, citing the recording and the session that show it, and the agent goes on to
the next thing to try. Findings about JamCLI's behavior are defects to fix in code, not
lessons for `AGENTS.md`; lessons stay with `/reflect`. The person reviews every proposal.
It needs `add-mcp-server`.

### 5. `add-connections`

A connection is a named way to reach a provider: a provider kind, a base URL, a dialect,
and a credential filed under the connection's name in the store
(`src/core/config/credentials.ts:20`, `SERVICE = 'jamcli'`, account = connection name).
`api_registry.endpoints` (`src/types/config.ts:23-30`) is already this shape minus the
provider kind; the unit adds `provider` so an entry can say "this is Groq" and inherit
the base URL and environment variable from a bundled provider table.

The table is models.dev's provider list, checked in as a small JSON (223 providers on
2026-09-26: id, name, API URL, environment variable, dialect), regenerated by a script,
never hand-edited. 182 of the 223 are served by an OpenAI-compatible client, which
jamcli already has (`src/core/providers/openai-compat.ts`), so the unit adds no provider
code for them. Models are not bundled: `listModels` asks the endpoint, as it does now.

`jamcli auth set <connection>` stores under the connection name. `jamcli auth list`
shows each connection, its provider, and where its key comes from. Project configuration
may declare a connection with no key, which each teammate fills with `jamcli auth set`.
The wizard is a later unit; this one is flags and files.

Why second: agents name refs, and this unit widens what a ref can name without changing
how one is written.

### 6. `add-fallback`

A conversation should survive a rate limit or an exhausted key. Semantics are LiteLLM's,
reduced to one process: a connection that answers 429 or 402 is cooled down for a
configured time; while cooled, a chain skips it the way `resolveRoute` already skips an
unconfigured or unreachable entry (`src/core/routing/resolve.ts:33-51`), and the session
model falls through `session.fallbacks`, an ordered list of refs, with a notice naming
what happened and what is serving the turn now. Two keys for one account are two
connections in one chain. `ProviderError` already carries `status` and `retryable`
(`src/core/providers/http.ts:25-44`), so the classification exists.

Why third: it needs connections to have identity, and it is the second half of the
credentials decision.

### 7. `add-stages`

The observable pipeline. An agent file gains `input` and `output` lists. A stage is a
script (JSON on stdin, JSON on stdout, the hook contract at
`src/core/hooks/commands.ts:11-49`) or a prompt (a small model call on a named agent).
Each has `on_fail`: `fix` (default, replace the text), `block`, or `reask`, Guardrails'
vocabulary with `reask` opt-in because it is the loop that burns tokens. Output stages
run on the child's final text before the parent reads it, so the parent never sees a
broken rule. `jamcli agents test <name> "text"` runs sample text through the stages and
shows what each changed. The transcript records each stage that acted. `refine.ts` from
the web unit is the seam this occupies.

Why fourth: it needs agents to attach to, and the settle order (final text only, or hold
the stream) is decided here with the stream in hand.

### 8. `add-setup-wizard`

`jamcli setup` and `/setup`: an interactive path that writes the same files the flags
write, then shows what it wrote and where. Connections, keys, agents, fallbacks, stages.
It is an addition: headless, ACP, and the flags keep working with no TTY, as the auth
CLI does today (`src/cli/auth.ts:7-8`).

Why last: it has nothing to write until the shapes above exist.

## Deliberately not planned

- Graded effort beyond `off | on | auto`. Only Anthropic exposes it; a provider unit if
  ever.
- Reloading configuration in a running session. A session holds one snapshot so the model
  is never told one set of routes and served another.
- Bundling the models.dev model table (4.9 MB). Endpoints list their own models.
- A visual canvas for stages. The configuration file, the list command, the test command,
  and the transcript are the observability. A canvas can render them later if wanted.
- Per-agent tool allowlists. Claude Code has them; nothing here needs them yet.

## Sources

- Claude Code source, 2026-03-31 snapshot: `tools/AgentTool/prompt.ts:43,66,101,112,235`;
  `tools/AgentTool/AgentTool.tsx:82-86`; `tools/AgentTool/loadAgentsDir.ts:76-92`;
  `utils/model/agent.ts:37-78`; `types/hooks.ts:64-125`.
- models.dev, `https://models.dev/api.json`, fetched 2026-09-26: 223 providers, 8,174
  models, 182 providers served by `@ai-sdk/openai-compatible`.
- LiteLLM router: `https://docs.litellm.ai/docs/routing` and
  `https://docs.litellm.ai/docs/proxy/reliability` (cooldown on 429, `allowed_fails`,
  ordered fallbacks).
- Guardrails AI validator actions:
  `https://guardrailsai.com/guardrails/docs/concepts/validator_on_fail_actions`
  (`fix`, `reask`, `filter`, `refrain`, `noop`, `exception`).
- OpenAI Agents SDK guardrails: `https://openai.github.io/openai-agents-python/guardrails/`
  (tripwires block; they never repair).
