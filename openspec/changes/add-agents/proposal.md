# Change: Agents the model can choose between well

## Why

When the model delegates, it chooses blind. The `task` tool tells it the category names
and nothing else: its description is the base text plus
`Categories: quick, explore, deep, writing.` (`src/core/runtime/index.ts:514`). A category
has a model chain and, per entry, a reasoning level (`src/types/config.ts:46-51`), but no
words saying what kind of work it is for, and no rules of its own. The model is asked to
route work without being told what the routes are, and the child arrives with no
instructions particular to the work.

Session `2026-09-26-de8c4d4a` (run in `monaco-code-editor`) shows the cost. Asked to
research three things in parallel, the model fanned out to category `quick` three times.
It had no way to know that `quick` meant a local `ollama:llama3` that was not running, or
that nothing better was on offer. The raw failures are fixed separately (commit `9272739`
wires the reachability check `resolveRoute` always had), but a clean refusal is still a
wasted turn. The model should see what it can delegate to before it calls.

Claude Code's answer is a file per agent and language around the list. An agent is one
markdown file whose frontmatter names it, describes when to use it, and picks its model
and effort, and whose body is its system prompt
(`claude-code-main/src/tools/AgentTool/loadAgentsDir.ts:76-92`). The model sees one line
per agent, `- type: whenToUse (Tools: ...)` (`tools/AgentTool/prompt.ts:43`), inside
guidance on when to delegate, when not to, and how to brief the child
(`prompt.ts:101-112`, `:235`). The model override is a three-value enum, never a raw
model id (`AgentTool.tsx:86`). The owner decisions recorded in `openspec/ROADMAP.md`
follow that shape: one concept called an agent, chosen by name from a short, described,
owner-curated list.

jamcli already loads a directory of markdown files with frontmatter for skills, from the
project, the user, and plugins, with a person's own file winning over a plugin's
(`src/core/ext/skills.ts:39-47`, `src/core/ext/frontmatter.ts:15`). Agents load the same
way from `agents/` beside `skills/`.

Three defects sit under the same surface and are fixed here because the new behavior
depends on them:

- **A category's reasoning level is computed and then dropped.** `resolveRoute` normalizes
  it through `downgradeReasoning` (`src/core/routing/resolve.ts:53-56`,
  `src/core/routing/capabilities.ts:8-20`), but the child is created with the model alone
  (`src/core/runtime/children.ts:104-108`), and `RuntimeOptions` has no reasoning field to
  carry it. The agent loop accepts one (`src/core/agent.ts:40`) and silently defaults to
  `auto` (`src/core/agent.ts:524`). The spec scenario "Normalize reasoning capability" is
  met on paper and has no effect.
- **The default has nowhere to live.** `category` is required
  (`src/core/tools/task.ts:27-42`), so there is no default to set, in settings or anywhere
  else.
- **Two readers assume the list shape.** `src/core/runtime/model.ts:35` and
  `src/cli/doctor.ts:113-116` read `config.categories?.quick?.[0]?.model` directly. Any
  change to what a category is has to go through one loader, or these break without an
  error.

## What Changes

- **An agent is a file.** `agents/<name>.md` in the project `.jamcli` directory, the user
  configuration directory, or a plugin, resolved in that order like skills. Frontmatter:
  `description` (the words the model reads when choosing), `models` (the ordered chain,
  each entry `provider:model` or `{ model, reasoning }`). The body, when present, is the
  agent's rules: appended to the child's system prompt and read by nothing else. Parsing
  reuses `parseFrontMatter`.
- **The four built-ins are agents.** `quick`, `intelligent`, `explore`, and `writing`
  (owner decision: `deep` is renamed), each with a description and the `ollama:llama3`
  chain, no body. A file of the same name replaces one entirely, the way a user skill
  replaces a plugin skill.
- **`categories` keeps loading.** A configured category is an agent with that name, that
  chain, and no description or body. One loader, `loadAgents`, merges files over
  `categories` over built-ins and returns one shape; every reader goes through it. Files
  written by an earlier version load unchanged, as "Layered Configuration" requires.
- **The `task` description is built the way Claude Code builds its agent list.** One line
  per agent: name, description, and the chain it runs on (reusing `describeChain`,
  `src/core/routing/categories.ts:26-29`). The line names the default. Around the list is
  fixed guidance on when to delegate, when not to, and how to brief a child that starts
  with nothing. The exact text is in `design.md` and is the main work of this change.
- **Only routable agents are offered.** An agent with no chain entry whose provider is
  configured is not listed. The check is `providerConfigured`
  (`src/core/routing/capabilities.ts:32`): local, no network. Reachability stays at call
  time, where commit `9272739` put it.
- **`task` takes `agent`, optional, and `reasoning`, optional.** `delegation.default_agent`
  names the agent used when none is given; with no default, an omitted agent is refused
  with the agents named, the way an unknown one is refused today
  (`src/core/runtime/children.ts:90`). `reasoning` is `off`, `on`, or `auto`, the
  vocabulary every provider already accepts (`src/core/providers/ollama.ts:154`,
  `openai-compat.ts:112`, `anthropic.ts:447`); it overrides the chain entry's level for
  that one child. `RuntimeOptions` gains `reasoning` and the child is created with the
  route's level, which fixes the dropped value. Workflow specs keep `category` as an
  alias of `agent` (`src/core/workflows/schema.ts:26`).
- **Settings and configuration are one store.** `/agents` replaces `/categories`
  (`src/tui/app/commands.ts:543-555`): it lists each agent with its source file or
  "built-in", description, chain, whether it has rules, and the default. Choosing one
  writes `delegation.default_agent` through the writer `/config set` uses, and the notice
  names the file and says the change applies from the next session, because a runtime
  reads configuration once (`src/core/runtime/index.ts:275`). `jamcli config set
  delegation.default_agent <name>` works through the existing JSON-aware path writer
  (`src/cli/config.ts:77-79,179`).

## Impact

- **Affected specs:** `jamcli`. "Category-Based Model Routing" and "Delegated Task
  Execution" are modified. "Agent Definitions", "Delegation Choice Presentation", and
  "Delegation Settings" are added.
- **Affected code, new:** `src/core/ext/agents.ts` (`agentDirs`, `readAgent`,
  `loadAgents`, the built-ins with their descriptions), with tests beside it.
- **Affected code, modified:** `src/types/config.ts` (`default_agent` on
  `DelegationConfig`), `src/core/config/schema.ts` (the new key), `src/core/routing/
  categories.ts` (the built-in table moves to `ext/agents.ts`; `describeChain` stays),
  `src/core/routing/resolve.ts` (takes the loaded agents), `src/core/runtime/children.ts`
  (loaded agents, the default, passing reasoning, the rules body into the child's system
  prompt), `src/core/runtime/index.ts` (`RuntimeOptions.reasoning` into the agent, the
  new `task` description at `:514`), `src/core/tools/task.ts` (`agent` and `reasoning`
  parameters), `src/core/runtime/model.ts:35` and `src/cli/doctor.ts:113-116` (through
  the loader), `src/core/workflows/runners.ts:63` and `schema.ts:26` (through the
  loader, `agent` with `category` as alias), `src/tui/app/commands.ts:543-555` (`/agents`),
  `docs/config.schema.json` (regenerated, never hand-edited), and the configuration and
  tools docs.
- **Reused unchanged:** `parseFrontMatter`, the skills directory order, `resolveRoute` and
  its skip-and-report path, `downgradeReasoning`, `providerConfigured`, `describeChain`,
  the layered loader, the `/config` writer, and the refusal path in `task.ts:98-99`.
- **Not affected:** the local-first path. The built-ins still route to `ollama:llama3`
  with no key and no network, `ollama` always counts as configured, so they are always
  offered.
- **Deliberately not done:** letting the model name a raw `provider:model` (owner
  decision). Graded effort. Reloading configuration in a running session. Per-agent tool
  allowlists. Input and output stages on an agent file: that is `add-stages`, the fourth
  unit in `openspec/ROADMAP.md`, and the file format here leaves room for its keys.
  Applying an agent's rules to the main conversation (owner decision: delegated agents
  only).
