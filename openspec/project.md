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

Parity with those tools is pursued where it serves the three promises, and tracked in
`docs/feature-matrix.md`: every capability they ship is either matched, or recorded as a
gap with its reason. A standard is claimed only when a test exercises it, as recorded in
`docs/conformance.md`.

## Tech Stack

Current, as measured in `package.json` and `src/` when `rehaul-jamcli` opened:

- Bun 1.4.2 as the only runtime (CI pins it; use the same version locally)
- TypeScript 7, bundled with tsup to `dist/index.js` (replaced by `bun build`; see the update below)
- Ink 7.1.1 and React 19.2 for the terminal UI, Zustand 5 for its state
- Zod 4 for schema validation
- `@modelcontextprotocol/sdk` for MCP clients
- `bun test` as the test runner (147 tests), `tsc --noEmit` as the type gate, and a CI
  workflow that runs install, typecheck against the baseline, test, and build

Target, established by `changes/rehaul-jamcli`:

- OpenTUI (`@opentui/core` and `@opentui/react`, pinned to exact versions) replaces Ink
  in stage 6; React 19.2 and Zustand 5 stay for view state
- `bun build` replaces tsup; `bun build --compile` produces release binaries
- `@agentclientprotocol/sdk` for ACP and `@modelcontextprotocol/client` 2.x for MCP
- `ignore`, `yaml`, and `semver` as small single-purpose dependencies, each added in its
  own commit
- ripgrep, bubblewrap, `gh`, and language servers are used when present and never
  required

## Project Conventions

### Code Style

Bun runs the source directly in development; `bun run build` produces the shipped
bundle. Every module is ESM and imports carry the `.js` extension even from `.ts`
or `.tsx` sources, because the bundle target resolves that way.

The core owns behavior. Interface components render state and forward events; they do
not decide anything. A service that needs the UI to be loaded is a service in the wrong
layer.

Naming follows the existing shape: `ToolService`, `McpManager`, `HistoryService`.
Files are one concept each. `src/components/Layout.tsx` is the counter-example this
project is built to remove.

### Architecture Patterns

The harness is a core with several consumers, not a TUI with a headless afterthought:

```
core runtime (no UI imports)  ->  TUI  |  headless (-p)  |  ACP server  |  workflow steps
```

Every consumer obtains its session from one runtime factory, so the tools, schemas,
provider, rules, hooks, and policy are identical everywhere. The core emits events and
accepts callbacks. It never imports a component. Approval is the canonical example: the
core emits `approval_request` and takes a decision callback. The TUI presents a prompt,
headless mode answers from flags and policy config, and the ACP server answers from
`session/request_permission`. `docs/architecture.md` is the module map.

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
near-pure functions and are cheap to cover.

Module tests are not enough on their own. Every surface also needs tests that drive
the assembled product: headless runs, ACP sessions, and the interface, against a
scripted fake provider server that speaks the real wire formats. The previous unit
passed 147 module tests while its surfaces could not edit a file.

The interface is verified in two ways: by booting it and exercising the flow, and by
frame-text snapshot tests through OpenTUI's test renderer. Snapshots compare text, not
escape codes. The owner authorized them on 2026-09-23, replacing an earlier rule
against snapshot tests.

A test that cannot fail is not evidence. `devloop`'s `test-results/.last-run.json`
reports `passed` with no spec files present, and `langsearch`'s handoff notes claim
work is uncommitted when `git log` shows otherwise. Status files and prose are not
evidence; a fresh run is.

### Git Workflow

Remote `jamubc/jamcli`. Each unit lives on its own branch; `master` is where units
merge once archived. Commit subjects are lowercase, imperative, conventional, and scoped
when useful (`fix(tools): reject stale edit anchors`). Bodies are one to three plain
sentences. Commits carry the owner's identity. No AI attribution, no `Co-Authored-By`
trailers, no em dashes in authored text.

One unit of work is in flight at a time, per `openspec/SEQUENCE.md`. Its stages are
committed on its branch as checkpoints that each install, typecheck, test, and build.
It is not set aside to start something else, and a checkpoint is never merged on its
own.

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
telemetry, loop, routing, delegation, and context management settings.
`.jamcli/mcp.json` holds the context window limit, ignore patterns, legacy per-tool
permissions, and MCP server definitions. `.jamcli/profiles/*.json` holds behavior
profiles. Custom status styles live alongside them. These files are per-project and are
not committed. `rehaul-jamcli` adds user-level configuration under `~/.config/jamcli/`
and a project-local `config.local.json`, layered as described in `docs/architecture.md`.

**History.** Sessions are JSONL files under `.jamcli/history/`. `rehaul-jamcli` turns
each file into an append-only event log that records tool calls, results, and approval
decisions; older files stay readable without migration.

**Tools.** A registry of built-in tools covers reading, searching, writing, editing,
patching, commands, a todo list, read-only git, delegation to child runs, and ACP
delegation. Every tool declares a JSON Schema and a policy class. MCP tools join the same
registry.

**MCP.** Servers connect over stdio or streamable HTTP. Discovered tools are namespaced
`<serverId>__<toolName>` and a built-in `search_tools` meta-tool discovers them by
keyword.

## Important Constraints

- Telemetry stays off by default. `config.json` carries `"telemetry": false` and any
  future telemetry must be opt-in and off on first run.
- Human-in-the-loop is the default. Reading is unrestricted; writing, executing, and
  delegating are gated by policy.
- No license file is added. All rights reserved is intentional for a personal repo.
- Not published to npm. Release binaries are built for GitHub Releases, authorized by
  the owner on 2026-09-23.
- Secrets never live in the repository. `.jamcli/` is gitignored and provider keys
  are read from environment variables through `key_env_var` where possible.
- Third-party code never loads into the JamCLI process. Plugins, hooks, MCP servers,
  and language servers run as subprocesses, sandboxed when a sandbox is available.
- The local-first path must keep working with no network, no account, and no API key.
- Markdown is tracked only inside `openspec/` and `docs/`; the rest of the tree keeps
  scratch notes out of git.

## External Dependencies

- Ollama at `http://localhost:11434` for local models. Optional at runtime; the only
  provider that works with no account.
- OpenRouter for cloud models, and any OpenAI-compatible endpoint the user configures.
- MCP servers over stdio or streamable HTTP, added by the user and optional.
- ACP agents on PATH (Copilot, Hermes, OpenCode, Junie, Qwen, Codex, Claude) for
  outgoing delegation. Optional, and never required for JamCLI to function.
- ripgrep, bubblewrap (Linux) or `sandbox-exec` (macOS), git, `gh`, and language
  servers, each used when present and never required. `jamcli doctor` reports which
  are available.
