# Architecture

JamCLI is one runtime with several surfaces. This page is the map. The decisions behind
it, with alternatives and reasons, are in
`openspec/changes/rehaul-jamcli/design.md` while that change is open and in the archive
afterward.

## Layers

```
 surfaces     interface (OpenTUI)   headless (-p)   ACP server   workflow steps   child runs
                    │                    │              │              │               │
                    └──────────── createRuntime(): commands in, typed events out ────────┘
 core
   runtime/       the only place a session is assembled
   agent.ts       the turn engine: streaming steps, honest batches, cancellation
   transcript/    append-only event log; provider messages and exports are projections
   context/       budgets from the model catalog, pair-safe compaction, @ references
   tools/         registry and built-ins (read, write, edit, patch, glob, grep, command,
                  todo, git, task, delegate, web fetch, skill, lsp)
   permissions/   modes, pattern rules, scopes, grants, provenance
   sandbox/       bubblewrap, Seatbelt, or none; the minimal subprocess environment
   providers/     OpenAI-compatible, Anthropic, Ollama; retries and errors
   catalog/       context windows, output limits, features, prices; the cost ledger
   rules/         instruction files from the project root to the working directory
   hooks/         the in-process event bus and user command hooks
   trust/         the tool output screening gate
   routing/       categories that name a kind of work and resolve to a model chain
   delegation/    child runs
   ext/           custom commands and Agent Skills
   plugins/       manifests, installation, lockfile, lifecycle
   workflows/     definitions, the engine, run logs, triggers
   git/           checkpoints, diff review, the commit path
   lsp/           language server client
   protocols/     JSON-RPC framing, MCP client adapter, ACP adapters
   observe/       logs, traces, the OpenTelemetry exporter
   config/        layered configuration, schemas, credentials
```

`src/core/` imports no interface code. A test fails if it does.

## A turn, end to end

1. The surface calls `runtime.run(input)`.
2. `@` references expand, `user_prompt_submit` hooks run, and a `user` event is logged.
3. The engine projects the transcript into provider messages, with the system prompt
   first: profile, rules, skills list, and tool guidance.
4. The context manager compacts if the estimate crosses the model's threshold. Tool calls
   and their results are never separated.
5. The provider streams. Text and reasoning deltas become events. Completed tool calls
   become `tool_call` events. Transient failures retry below this layer.
6. The assistant message is logged with its text, reasoning, and every call.
7. For each call, in order:
   - the schema is validated;
   - the permission engine decides using the mode, rules from every scope, flags, and
     hooks, and the decision carries its rule;
   - on `ask`, the surface is asked;
   - a checkpoint is taken before the first state-changing call of the step;
   - the call runs, in the sandbox if it executes anything.

   Consecutive read-only calls run together.
8. Every call gets one result. Output is redacted, truncated head and tail, optionally
   screened by the trust gate, and logged.
9. The engine loops until the model stops calling tools, the user takes control, a limit
   is reached, or the run is cancelled.

## Processes

JamCLI runs in one process. Everything it starts is a separate process, launched with the
minimal environment and, when a sandbox is available, inside it:

- shell commands and background jobs;
- user hooks and plugin hooks;
- MCP servers over stdio, including plugin servers;
- language servers;
- delegated child runs, which are `jamcli -p` processes;
- ACP agents JamCLI delegates to.

No third-party code is loaded into the JamCLI process.

## Storage

| Location | Contents |
|---|---|
| `~/.config/jamcli/` | user configuration, keybindings, commands, skills, workflows, the user plugin lockfile |
| `~/.local/share/jamcli/plugins/` | installed plugins by name and version |
| `~/.local/state/jamcli/` | the session index and logs |
| `~/.cache/jamcli/` | provider model metadata |
| `<project>/.jamcli/` | project configuration, `config.local.json`, history, checkpoints outside git, workflow run logs, project commands, skills, workflows, and rules. It carries its own `.gitignore`. |
| `refs/jamcli/checkpoints/<session>` | git checkpoints, private to JamCLI |
| OS keychain | provider keys and MCP OAuth tokens |

Paths follow the XDG base directory conventions on Linux and the platform equivalents on
macOS and Windows.

## Configuration layers

From lowest to highest:

1. built-in defaults;
2. user;
3. project (including the legacy `mcp.json` and `profiles/`);
4. project-local;
5. environment;
6. flags.

`jamcli config list --show-origin` prints where each value came from.
