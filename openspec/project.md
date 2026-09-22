# Project Context

## Purpose

JamCLI is a terminal-native AI coding agent. It runs in the user's shell, reads the
project it is launched inside, and changes files or runs commands only with explicit
approval. It is provider-agnostic: Ollama locally, any OpenAI-compatible endpoint, or
an MCP server's tools, chosen per route rather than fixed per session.

JamCLI is a personal project under `jamubc/jamcli`. It is not a Jam-Sw product, it
carries no license file, and it is not published to npm.

## Product Thesis

Every serious agent harness in 2026 is either closed, or open but owned by someone
else's roadmap. JamCLI exists to be the third thing: a harness the owner can read in
a sitting, extend without permission, and trust on a machine that holds real
credentials.

Three promises define it. A feature that weakens one is rejected on those grounds.

1. **The loop is honest.** One tool protocol, one execution path, and a truthful
   record of what ran. The model never acts by prose that the harness then guesses
   at. When the harness reports a tool result, that is the result that occurred.
2. **Local by default, cloud by choice.** Ollama is the default provider and works
   with no network and no account. A cloud model is a routing decision per kind of
   work, never a precondition for using the tool.
3. **Nothing changes state without consent.** Approval is the default posture, not a
   flag. Reading is free; writing, executing, and delegating are gated. A run that
   nobody watched must be explainable afterward from its transcript.

The target is **small enough to hold in your head**. Complexity is a cost paid for a
named capability, and the harness stays legible: no file so long that a change to it
cannot be reviewed, no protocol with two implementations, no feature whose only
evidence of working is its own status file.

Anti-goal: JamCLI is not a re-implementation of Hermes, OpenCode, Claude Code, or
Codex, and it is not a plugin that lives inside one of them. Where it needs what they
have, it delegates over a protocol (ACP) rather than rebuilding it. It also does not
grow memory, learning, or self-improvement features. That experiment ran as
`hermes-plasticity-plugin`: 26 cycles, roughly 138,000 tokens, zero committed
memories, because every candidate it surfaced was already obvious.

## Tech Stack

Current, as measured in `package.json` and `src/`:

- Bun 1.4.2 as the runtime (Ink requires it)
- TypeScript 5.4, bundled with tsup to `dist/index.js`
- Ink 6.5 and React 19 for the terminal UI
- Zustand 4.5 for state
- Zod 3.22 for schema validation
- `@modelcontextprotocol/sdk` 1.22 for MCP clients
- No test framework installed; no CI

Target, established by `changes/add-agentic-harness-core`:

- TypeScript 7, Ink 7, Zustand 5, Zod 4
- `bun test` as the test runner, `tsc --noEmit` as the type gate
- `@agentclientprotocol/sdk` 1.5 for ACP

## Project Conventions

### Code Style

Bun runs the source directly in development; `bun run build` produces the shipped
bundle. Every module is ESM and imports carry the `.js` extension even from `.ts`
or `.tsx` sources, because the bundle target resolves that way.

The core owns behavior. Ink components render state and forward events; they do not
decide anything. A service that needs the UI to be loaded is a service in the wrong
layer.

Naming follows the existing shape: `ToolService`, `McpManager`, `HistoryService`.
Files are one concept each. `src/components/Layout.tsx` is the counter-example this
project is built to remove.

### Architecture Patterns

The harness is a core with three consumers, not a TUI with a headless afterthought:

```
core (no Ink, no React)  ->  TUI (Ink)  |  headless (-p)  |  ACP server
```

The core emits events and accepts callbacks. It never imports a component. Approval
is the canonical example: the core emits `approval_request` and takes a decision
callback. The TUI wires that to `ActionModal`, headless mode answers from flags and
policy config, and the ACP server answers from `session/request_permission`.

Providers are adapters behind one interface. Anything OpenAI-shaped goes through a
single compatible-endpoint client; Anthropic-shaped traffic goes through one
translation seam. A new provider is a config entry, not a new class.

Tools are a registry, not a switch statement. A tool declares its JSON Schema, its
policy class, and its runner. Adding a tool must not require editing a component.

### Testing Strategy

`bun test` is the runner. There is no separate framework.

Two gates run on every change and neither may regress:

1. `npx tsc --noEmit` must not exceed the count recorded when the change opened.
2. `bun test` must pass.

The core is the coverage target: the agent loop, tool dispatch, provider request and
stream translation, routing resolution, and the trust gate. Those are pure or
near-pure functions and are cheap to cover. Ink components are verified by booting
the TUI and exercising the flow, not by snapshot tests.

A test that cannot fail is not evidence. `devloop`'s `test-results/.last-run.json`
reports `passed` with no spec files present, and `langsearch`'s handoff notes claim
work is uncommitted when `git log` shows otherwise. Status files and prose are not
evidence; a fresh run is.

### Git Workflow

Local branch `master`, remote `jamubc/jamcli`. Commit subjects are lowercase,
imperative, conventional, and scoped when useful (`fix(tools): reject stale edit
anchors`). Bodies are one to three plain sentences. No AI attribution, no
`Co-Authored-By` trailers, no em dashes in authored text.

One unit of work is in flight at a time and lives in the working tree until it is
complete, per `openspec/SEQUENCE.md`. It is not split into partial commits and not
set aside to start something else.

### Change Proposals

OpenSpec drives the work. Active proposals live in `openspec/changes/`; shipped
changes move to `openspec/changes/archive/`. `openspec/SEQUENCE.md` holds the order
units land in and the definition of done. The canonical current behavior lives in
`openspec/specs/jamcli/spec.md` and is updated only at archive time.

Workflow: read `openspec/project.md`, run `openspec list` and `openspec list
--specs`, scaffold the change, write deltas, then `openspec validate <id> --strict`
before implementation starts.

## Domain Context

**Project root.** JamCLI walks up from the current directory to find `.jamcli/`. That
directory is the unit of configuration and history. Running from any subdirectory
uses the same config, MCP servers, and sessions.

**Configuration.** `.jamcli/config.json` holds providers, the active profile,
telemetry, and context management settings. `.jamcli/mcp.json` holds the context
window limit, ignore patterns, per-tool permissions, and MCP server definitions.
`.jamcli/profiles/*.json` holds behavior profiles. Custom status styles live alongside
them. These files are per-project and are not committed.

**History.** Sessions are JSONL files under `.jamcli/history/`. `HistoryService`
already supports listing, searching, and exporting sessions to Markdown; those
capabilities are not all surfaced in the UI today.

**Tools.** Five are defined: `list_files`, `read_file`, and `search_code` are safe and
auto-run; `apply_patch` and `run_command` are elevated and route through an approval
modal. `run_command` is a raw `exec`.

**MCP.** Servers are stdio only. Discovered tools are namespaced
`<serverId>__<toolName>` and a built-in `search_tools` meta-tool discovers them by
keyword.

## Important Constraints

- Telemetry stays off by default. `config.json` carries `"telemetry": false` and any
  future telemetry must be opt-in and off on first run.
- Human-in-the-loop is the default. Reading is unrestricted; writing, executing, and
  delegating are gated by policy.
- No license file is added. All rights reserved is intentional for a personal repo.
- Secrets never live in the repository. `.jamcli/` is gitignored and provider keys
  are read from environment variables through `key_env_var` where possible.
- The local-first path must keep working with no network, no account, and no API key.
- Markdown is tracked only inside `openspec/` and `docs/`; the rest of the tree keeps
  scratch notes out of git.

## External Dependencies

- Ollama at `http://localhost:11434` for local models. Optional at runtime; the only
  provider that works with no account.
- OpenRouter for cloud models, and any OpenAI-compatible endpoint the user configures.
- MCP servers, stdio today, added by the user and optional.
- ACP agents on PATH (Copilot, Hermes, OpenCode, Junie, Qwen, Codex, Claude) for
  outgoing delegation. Optional, and never required for JamCLI to function.
