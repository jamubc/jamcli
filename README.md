# JamCLI

A terminal-native AI coding agent you can audit. Local-first, provider-agnostic,
human-in-the-loop.

Every action JamCLI takes is decided by a rule it can name, and every run can be
reconstructed from one log: `jamcli audit ledger` answers what an agent changed, under which
rule, from which source, across sessions. JamCLI reads, edits, and runs code in your project
with your approval. It works with a local model through Ollama and no account at all, and
with OpenAI-compatible, Anthropic, and OpenRouter endpoints when you want them. The same
agent loop drives the terminal interface, the headless command line, and editors over the
Agent Client Protocol.

## What it does

- **Answers for what it did**: `jamcli audit ledger` lists every change and refusal across
  the project's sessions, with who decided, the rule, the file that rule came from, and the
  files the change touched.
- **Reads, edits, and runs commands** through one permission engine on every surface:
  five modes, pattern rules with scopes, and the rule behind each decision shown.
- **Sandboxes commands** with bubblewrap on Linux and Seatbelt on macOS, with your
  credentials hidden and provider keys withheld from every subprocess.
- **Checkpoints every change** so `/undo` and `/rewind` work without touching your git
  state.
- **Works offline** with Ollama, and routes kinds of work to chains of models.
- **Commits and opens pull requests** only when you approve, under your own identity.
- **Extends** with custom commands, Agent Skills, hooks, MCP servers, plugins with
  consent and isolation, and declarative workflows with approvals, resume, and schedules.
- **Speaks the protocols**: MCP (the 2026-07-28 revision with fallback), ACP as an
  agent and as a client, and LSP for diagnostics and navigation.
- **Runs headless** with JSON or streamed JSON output and a dry-run mode.
- **Serves other agents** over MCP with `jamcli mcp serve`: an agent host delegates work to
  a JamCLI session, or uses JamCLI's own interface in a terminal, and whatever only you
  should answer is asked of you.

## Install

Download the binary for your system from the latest release and check it against
`SHA256SUMS`:

```bash
sha256sum -c SHA256SUMS --ignore-missing
chmod +x jamcli-linux-x64 && mv jamcli-linux-x64 ~/.local/bin/jamcli
```

Binaries are built for Linux (x64, arm64) and macOS (x64, arm64). Windows is not
supported yet; see `openspec/SEQUENCE.md`.

From source, with [Bun](https://bun.sh) 1.4.2:

```bash
bun install
bun run build
bun run compile linux-x64     # or any target; writes release/ and SHA256SUMS
```

## Start

```bash
ollama pull qwen2.5-coder:7b  # any local model with tool calling
jamcli                        # the interface; first run walks through setup
jamcli -p "explain src/cli.ts" --output-format json
jamcli doctor                 # checks providers, models, tools, sandbox, config
claude mcp add jamcli -- jamcli mcp serve   # let Claude Code delegate to JamCLI
```

See [Getting started](docs/getting-started.md).

## Documentation

The published site, built from `site/`, carries the same ground for a person running JamCLI.

| Topic | Page |
|---|---|
| First run, providers, a first task | [getting-started.md](docs/getting-started.md) |
| Configuration layers and every key | [configuration.md](docs/configuration.md) |
| Permission modes, rules, and the sandbox | [permissions.md](docs/permissions.md) |
| Built-in tools | [tools.md](docs/tools.md) |
| Providers, models, keys, cost | [providers.md](docs/providers.md) |
| Sessions, resume, fork, checkpoints | [sessions.md](docs/sessions.md) |
| Custom commands and skills | [commands-and-skills.md](docs/commands-and-skills.md) |
| Hooks | [hooks.md](docs/hooks.md) |
| Plugins | [plugins.md](docs/plugins.md) |
| Workflows | [workflows.md](docs/workflows.md) |
| MCP, ACP, the observer, LSP | [protocols.md](docs/protocols.md) |
| Headless use | [headless.md](docs/headless.md) |
| The interface, keys, micro mode | [interface.md](docs/interface.md) |
| Security model | [security.md](docs/security.md) |
| Upgrading from 1.x | [migration.md](docs/migration.md) |
| Changes | [CHANGELOG.md](docs/CHANGELOG.md) |
| How it stands against other agents | [feature-matrix.md](docs/feature-matrix.md) |
| Protocol conformance | [conformance.md](docs/conformance.md) |
| Architecture | [architecture.md](docs/architecture.md) |

## Development

Four gates, every change:

```bash
bun install
npx tsc --noEmit
bun test
bun run build
```

`bun run bench` measures startup, first frame, keystroke latency, and memory against
the budgets. Work is planned in `openspec/`: `openspec/project.md` has the thesis and
conventions, `openspec/SEQUENCE.md` names the open unit and what each closed one left open,
and `openspec/ROADMAP.md` names the units after it.

## Status

A personal project, not published to npm. Use it with care: an agent that edits files
and runs commands can do damage, which is why the default mode asks before every change.
Issues and pull requests are welcome.
