# Change: Rehaul JamCLI into a modern coding CLI

## Why

`add-agentic-harness-core` built the right skeleton: a core with no interface imports, a
tool registry with real schemas, one compatible provider client, policy, rules, hooks,
routing, delegation, and three surfaces. The skeleton is sound. The assembled product is
not, and `audit.md` records why with probes and line references.

The short version, from that audit:

- **The default path has no agent.** The interface offers tools only on OpenRouter and
  only when a regular expression decides the message needs them. With Ollama, the default
  provider, JamCLI is a chat window (`audit.md` F1).
- **No surface can change anything.** Headless and ACP offer three read tools with empty
  schemas, `write_file` cannot write a file, and `edit` corrupts `$` sequences in its
  replacement (F2 to F5).
- **The loop is not honest.** Tool steps do not stream, the model's text beside a tool
  call is dropped, calls after an approval request vanish, ACP forgets every earlier
  prompt, and history keeps only final text, so a run cannot be explained afterward
  (F6 to F8, F17).
- **The interface reports state that is not in effect.** `/config` lists rules and a trust
  gate that interface turns never use (F16).

These are the three promises in `project.md`, broken on the paths people use. They got
through the previous definition of done because every test exercises a module and none
exercises a surface.

Separately, the owner directed on 2026-09-23 that JamCLI be brought to the standard of
current coding CLIs, benchmarked against Claude Code, Codex CLI, OpenCode, and Command
Code, with parity where it is justified and a recorded reason where it is not. In the same
decision the owner authorized four items this repository had deferred or rejected: a
plugin system, a git write path, a workflow engine, and release binaries. The owner chose
to land all of it as one unit, to merge the pre-authorized OpenTUI port with an interface
redesign, and to treat that decision as approval of this plan.

## What Changes

### Stage 1: Foundations
- A scripted fake provider server that speaks the OpenAI, Anthropic, and Ollama wire
  formats, so every surface can be tested end to end without a network.
- The type baseline is recorded as 22 and CI's ceiling drops from 35 to 22.

### Stage 2: One honest runtime
- **One assembly path.** A single `createRuntime` builds the provider, the full tool
  registry with real schemas, policy, rules, hooks, context management, the trust gate,
  and the transcript for every surface. Surfaces differ only in rendering and in who
  answers an approval.
- **A streaming turn engine.** Every step streams. One assistant message carries the text,
  the reasoning, and every tool call. Every tool call gets exactly one recorded result:
  ran, failed, denied, timed out, or cancelled. Read-only calls in a batch run
  concurrently.
- **Tool fixes.** `write_file` writes. Replacements are literal. `run_command` reports the
  exit code, keeps both streams, times out, cancels, and truncates head and tail. `grep`
  and `glob` use ripgrep when present and honor `.gitignore` either way, with no silent
  file cap. Paths are checked after resolving symbolic links.
- **Providers.** Retries with backoff that honor `Retry-After`, error bodies in messages,
  Ollama `num_ctx`, streamed usage for OpenAI-compatible endpoints, and reasoning replayed
  only to the provider family that produced it.
- **A transcript event log** (JSONL v2) that records every model request, tool call,
  result, approval decision, and notice. Version 1 history stays readable and is never
  rewritten.
- Loop defaults sized for real work: 50 steps, no separate per-turn tool cap, 30,000
  characters per tool result.
- Headless and ACP move onto the runtime; ACP keeps its history.

### Stage 3: Permission modes and sandbox
- Modes: `plan`, `default`, `accept-edits`, `auto`, and `bypass`.
- Pattern rules such as `run_command(npm test*)` and `edit(src/**)`, layered across user,
  project, local, and session scopes, with deny taking precedence and every decision
  recording the rule that produced it.
- Command sandboxing with bubblewrap on Linux and Seatbelt on macOS: the project writable,
  the rest of the file system read-only, known credential directories hidden, and network
  off by default. Commands, hooks, and MCP servers get a minimal environment instead of the
  caller's secrets.
- `--dry-run` for headless runs.

### Stage 4: Models, cost, and context
- A model catalog (context window, output limit, tool and reasoning support, price) from
  provider metadata, a bundled table, and configuration.
- A cost ledger per session and per model.
- Context management on by default, budgeted from the model's window, and compaction that
  never separates a tool call from its result.
- Anthropic prompt caching and signed thinking.

### Stage 5: Configuration, observability, and the command line
- Layered configuration: defaults, user, project, local, environment, flags, with
  `jamcli config list --show-origin` and a published JSON Schema.
- Credentials from environment variables or the OS keychain, never from project files;
  `jamcli auth`, including OpenRouter's PKCE login.
- Structured logs with verbose levels, a local JSONL trace, and an opt-in OpenTelemetry
  exporter. Telemetry stays off by default.
- `jamcli doctor`. JSON results that carry the error, the model, the cost, and permission
  denials. `.jamcli/` is created only when something must be written, and it ignores
  itself.

### Stage 6: The interface on OpenTUI
- The pre-authorized port and a redesign land together. The new layout has a header,
  transcript, and composer, plus a status line showing mode, model, context, cost,
  sandbox, and servers.
- Tool calls render as blocks with status and duration; edits show diffs.
- The permission prompt can grant "always allow" for a pattern at session or project scope.
- Keybindings are configurable. Themes include light, dark, high contrast, and `NO_COLOR`.
- A screen reader mode, first-run onboarding, and `/help`.
- Frame-text snapshot tests through OpenTUI's test renderer. The input latency benchmark
  is recorded before and after the port.
- Ink and the legacy service paths are removed.

### Stage 7: Git workflows
- Checkpoints before state changes, with `/undo` and `/rewind`.
- Hunk-level diff review.
- A commit path that runs only through an approval showing the message and the diff.
- Pull requests through the `gh` CLI, and worktree isolation for tasks.

### Stage 8: Commands, skills, and hooks
- Custom slash commands from Markdown files.
- Agent Skills (`SKILL.md`, the open standard) with progressive disclosure.
- User hooks configured as commands that exchange JSON, able to allow, deny, or add
  context.

### Stage 9: Protocol adapters
- MCP on the 2026-07-28 protocol, negotiating down for older servers, with OAuth,
  elicitation, and prompts as commands.
- ACP on the official SDK: session loading, modes, and the editor's file system and
  terminals.
- An LSP client that feeds diagnostics back after edits and offers navigation.
- A conformance suite for each protocol.

### Stage 10: Plugins
- Plugins are versioned bundles of the parts above: commands, skills, hooks, and MCP
  servers. They carry a manifest, a lockfile with integrity hashes, and consent to declared
  permissions.
- Lifecycle commands: install, enable, disable, update, remove, and verify.
- Plugin code runs only as a sandboxed subprocess. There is no in-process loading and no
  new plugin protocol.

### Stage 11: Workflows
- Declarative workflows: steps for agent turns, commands, tools, approval gates, and
  nested workflows, with conditions and bounded parallelism.
- Runs are event-sourced, so any run resumes at its last completed step.
- Triggers: manual, git hooks, and the operating system's scheduler. No daemon.

### Stage 12: Hardening and release
- Performance budgets enforced in CI.
- A security review with sandbox escape tests.
- CI on Linux, macOS, and Windows.
- Documentation, a migration guide, and a changelog.
- Single-file binaries built with `bun build --compile`, published with checksums, an
  SBOM, and provenance. Archive.

## Non-goals

- Memory, learning, or any preference model built from past sessions. Command Code's
  "taste" is its headline feature and is recorded as a justified gap, for the reasons in
  `project.md`.
- A hosted service, remote sessions, or a daemon.
- An npm release or a license file.
- Team mode, member visualization, or unbounded parallel agents. Workflows get a small,
  configurable parallel step limit and nothing more.
- DAP and A2A. The conformance matrix lists both as not implemented, with the reason.
- Loading plugin code into the JamCLI process.

## Sequencing

One unit, twelve stages, ordered by dependency. Stage 1 precedes everything and stage 2
precedes everything after it, because every later stage builds on the runtime and its
event shapes. After stage 2, the order in `tasks.md` is the intended order, and these
dependencies are fixed:

- Stage 6 needs stages 3 and 4, because the interface displays modes, cost, and context.
- Stage 10 needs stages 8 and 9, because a plugin bundles their parts.
- Stage 11 needs stage 8, and needs stage 7 for its commit step.
- Stage 12 is last.

Every checkpoint installs, typechecks at or under 22 errors, tests, and builds. The
interface keeps booting on its old paths through stage 5 and is replaced in stage 6. If
the unit stalls, the stopped point is the last checked task in `tasks.md`. Stopping after
stage 2 still leaves a working agent on all three surfaces, which is a real outcome.

## Impact

- **Affected specs:** `jamcli`. The delta adds requirements for the runtime, turn engine,
  transcript, permission modes, sandbox, model catalog and cost, layered configuration,
  credentials, observability, doctor, onboarding, accessibility, keybindings and themes,
  checkpoints, diff review, commits and pull requests, worktrees, commands, skills, user
  hooks, plugins, workflows, LSP, release artifacts, and performance budgets. It modifies
  most existing requirements. It removes none.
- **Affected code:** new `src/core/runtime/`, `src/core/transcript/`,
  `src/core/sandbox/`, `src/core/permissions/`, `src/core/catalog/`,
  `src/core/observe/`, `src/core/ext/`, `src/core/git/`, `src/core/lsp/`,
  `src/core/workflows/`, and `src/core/plugins/`. The interface is rewritten under
  `src/tui/` on OpenTUI. `src/services/LLMProvider.ts`, `src/core/sensor.ts`'s tool gate,
  the hardcoded tool name lists, and Ink are removed.
- **Affected dependencies:** `@opentui/core` and `@opentui/react` at exact versions,
  `@agentclientprotocol/sdk`, and `@modelcontextprotocol/client` 2.x are added. `ink`,
  `ink-text-input`, and `tsup` are removed. Each lands in its own commit.
- **Breaking changes:**
  - The bundle targets Bun only.
  - Loop defaults grow.
  - `.jamcli/` is no longer populated with default files on first run.
  - `--allow-tool` now allows the tool it names.
  - Each is covered in `docs/migration.md`.
- **Risk:** the scope. The previous unit shows this repository can land a large staged
  change. The stages here are ordered so that each checkpoint is usable, and the risks
  are itemized in `design.md`.
