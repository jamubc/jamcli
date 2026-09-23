# Change: Agentic Harness Core

## Why

JamCLI looks like an agent and behaves like a chat app that reads JSON. The gap is
four specific defects, each measured in the source, and one of them explains the other
three.

**1. There are two tool protocols, and they contradict each other.** The system prompt
instructs the model to emit a fenced JSON block (`src/components/Layout.tsx:147`,
`TOOL_INSTRUCTION_PROMPT`). Separately, uncommitted work already advertises native
tools and consumes native tool calls (`src/components/Layout.tsx:2312`,
`src/components/Layout.tsx:2319`). A third path then scrapes the finished text for
those same fences afterward (`src/components/Layout.tsx:2921`,
`ActionParser.parse`). So the model is taught one protocol, offered a second, and
interpreted by two parsers that can disagree. Every downstream reliability symptom
traces here: wrong tool selection, malformed arguments, repeated calls, and the
`MAX_AGENT_STEPS = 8` ceiling that exists because steps get burned on unparseable
output.

**2. Nothing is reachable without the terminal UI.** `src/index.tsx` goes directly to
`render(<Layout/>)`. The agent loop, the system prompt builder
(`buildSystemPrompt`, `src/components/Layout.tsx:300`), and intent detection
(`detectIntent`, `src/components/Layout.tsx:345`) all live inside a 3,318-line React
component built from 55 `useCallback`, 20 `useState`, 18 `useRef`, and 18 `useEffect`
hooks. There is no way to run a turn, a tool, or a session without starting Ink. That
is why JamCLI has no scriptable mode, no subagents, no ACP surface, and no daemon.

**3. One model serves the whole session.** The active profile carries a single
`preferred_model` (`src/types/config.ts:87`). The owner has 77 models behind one
provider and 376 behind another. Today the same model greps for filenames that a
free local model could find, and answers architecture questions that need the
strongest model available. Separately, a wrapper project
(`deepseek-claude-wrapper`) already proved the failure mode of naive model routing:
Claude Code hardcoded the session model, subagents inherited it, and the wrong model
was billed. Any routing added here must resolve per delegated task, never by
inheritance.

**4. Tool output enters context unscreened.** `read_file`, `search_code`, and command
output are placed into the conversation as-is. The owner already built and shipped a
solution to exactly this problem in `langsearch`: a batched classifier that screens
untrusted results for relevance and prompt injection, drops injections first, fails
open on error, and never falls back to an injection. JamCLI reads untrusted repository
files while holding write and execute tools, which is the precise combination
`meta-agent` classifies as critical.

Underneath all four: the repository has no tests, no CI, one branch, four commits all
dated 2025-11-25, and `vm2` installed while being unused in `src/`. Nothing here can
be proven, which is why the work has stalled at the moment of highest momentum.

The cost of not doing this is that JamCLI stays an experiment. The cost of doing it is
one large change. This proposal takes the second option and stages it so each stage is
independently verifiable and reversible.

## What Changes

### One tool protocol

- `TOOL_INSTRUCTION_PROMPT` and the fenced JSON action format are removed from the
  system prompt. Native tool calling becomes the only protocol.
- `ActionParser` and its dual dispatch path are removed.
- Tool definitions gain real JSON Schemas, replacing the permissive
  `additionalProperties: true` stubs in `McpManager.buildBuiltinSchema`.

### A headless core

- A framework-free `src/core/` owns the agent loop, session state, tool dispatch,
  provider calls, context compaction, routing, and policy. It imports neither Ink nor
  React.
- The core emits typed events and accepts callbacks. Approval becomes an event with a
  decision callback rather than a modal import.
- `src/components/Layout.tsx` is reduced to rendering and input forwarding, split into
  files under `src/tui/`, none over 400 lines.
- The system prompt, intent detection, and workflow constants move out of components.

### A real tool layer

- A tool registry where each tool declares its schema, policy class, and runner.
  Adding a tool is a registry entry, not a switch statement.
- New tools: `write_file`, `edit` (find and replace with stale-anchor rejection),
  `glob`, `grep`, `todo_write`, `todo_read`, and `git_status` / `git_diff`.
- `read_file` returns stable line anchors so `edit` can prove it is editing the file
  it read. A stale edit is rejected, not applied.

### A provider layer

- One OpenAI-compatible client serves Ollama, OpenRouter, and any configured endpoint,
  so a new provider is a config entry rather than a class.
- One Anthropic-shaped translation seam so Anthropic Messages traffic works without a
  second full provider implementation. The design is informed by
  `x5iu/claude-code-adapter`, which is tested at roughly 6,400 lines on this exact
  translation.
- Model discovery reads `/v1/models` and never requires a hardcoded list.
- Provider keys are read from environment variables through `key_env_var`.

### Model routing by category

- A `categories` block maps a kind of work (`quick`, `explore`, `deep`, `ultrabrain`,
  `visual-engineering`, `writing`) to an ordered model chain, so the caller names the
  work rather than the model.
- Reasoning capability is normalized per model rather than passed blindly.
- A delegated task resolves its own model from its category. A child never inherits
  the parent's model.

### Delegation

- `jamcli -p` provides a headless, non-interactive invocation with text, json, and
  stream-json output, an exit code contract, and explicit tool allow and deny flags.
- A `task` tool spawns headless JamCLI runs as subagents, synchronous or in the
  background, returning their result to the parent.
- Background tasks can be listed, retrieved, and cancelled.

### A tool output trust gate

- Tool results are screened before they enter context: one batched classifier call per
  turn scoring each result for relevance and injection.
- Injections are dropped before relevance filtering. The gate fails open on error and
  never falls back to an injection.
- Local deduplication runs before any paid classification call.

### Rules, hooks, and policy

- Project rules are loaded by walking up for `AGENTS.md` and injected into the system
  prompt, with the file shown in configuration.
- A lifecycle hook bus replaces the inline logic that currently lives in components.
- Tool permissions extend to per-tool allow, ask, or deny, with `--deny-tool` and
  `--allow-tool` for non-interactive runs. Human-in-the-loop remains the default.
- `jamcli audit` reviews tool permissions and rules files against the five criteria
  from `meta-agent`: dangerous tool access, isolation of concerns, prompt injection
  surface, missing guardrails, and trigger breadth.

### Sessions and protocol surface

- `--continue` and `--resume <id>` on the command line, plus `/fork`.
- Session listing, searching, and export surfaced in the CLI. The service layer
  already implements all three.
- MCP gains streamable HTTP alongside stdio, and `jamcli mcp add|list|test|remove`
  subcommands.
- `jamcli acp` serves ACP over stdio as an agent, and an ACP client lets JamCLI
  delegate outward to Copilot, Hermes, OpenCode, Junie, Qwen, Codex, or Claude.

### Repository hygiene

- `vm2` is removed.
- `bun test` becomes the test runner and `tsc --noEmit` the type gate.
- A CI workflow runs install, typecheck, test, and build.
- `.gitignore` stops swallowing every `*.md`, so `openspec/` and `docs/` are tracked.

## Non-goals (this change)

- No memory, learning, or self-improvement system. `hermes-plasticity-plugin` ran 26
  consolidation cycles for roughly 138,000 tokens and committed zero memories, because
  every candidate it surfaced was already obvious. Nothing in this change revives that
  idea.
- No team mode, no tmux visualization, no eight parallel members.
- No hosted service, daemon, or remote session store. JamCLI stays local-first.
- No license file, no npm publish, no distribution work beyond a working build.
- No visual redesign. The existing look and the status style system are unchanged.
- No plugin marketplace or third-party extension API.
- No change to the ACP or MCP wire protocols beyond what the SDKs provide.

## Sequencing

One unit is in flight. This is that unit, and it is the only active change until it is
complete. The order is fixed by dependency:

1. **Hygiene and protocol.** Park the in-progress work, add the test runner, remove
   `vm2`, fix `.gitignore`, and collapse the two tool protocols into one. Nothing else
   can be measured until the loop is trustworthy.
2. **Core extraction.** Move the loop out of the component. This unblocks every later
   stage and is the point of no return in both directions: it is mechanical, and it is
   the largest single source of risk.
3. **Tool layer, providers, routing.** Capability work on top of a real core.
4. **Delegation and the trust gate.** The stage that makes JamCLI a harness rather
   than an agent.
5. **Rules, hooks, policy, sessions, ACP.** The surrounding surface.

Stages 1 and 2 are prerequisites for everything. Stages 3 onward are independent of
each other and may land in any order once the core exists, though `task` delegation
depends on both the headless mode and category routing.

## Impact

- **Affected specs:** `jamcli` (one capability). This change adds requirements for the
  tool protocol, core, tool registry, providers, routing, delegation, trust gate,
  rules, hooks, permissions, sessions, and protocol surface; modifies the tool
  execution, approval, provider, MCP, and interface requirements; and removes the
  fenced JSON action protocol requirement.
- **Affected code:** `src/index.tsx` becomes a dispatcher. `src/components/Layout.tsx`
  is dismantled into `src/tui/`. `src/services/*` moves under `src/core/` in the
  appropriate module. `src/types/tools.ts` becomes the basis of the tool registry.
  `src/services/ActionParser.ts` is deleted. New trees: `src/core/`, `src/cli/`,
  `src/acp/`, `src/tui/`, `tests/`.
- **Affected dependencies:** `vm2` removed. `@agentclientprotocol/sdk` added.
  TypeScript, Ink, Zustand, and Zod move one major version each, in separate commits.
- **Risk:** the core extraction touches every file and cannot land partially. The
  staged tasks and the TUI-as-regression-test discipline in `tasks.md` exist to keep
  that risk bounded and to keep each commit revertable.

Full technical decisions, alternatives, and rollback in `design.md`.
