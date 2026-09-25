# JamCLI

A terminal-native AI coding agent. Local-first, provider-agnostic, human-in-the-loop.

JamCLI reads, edits, and runs code in your project with your approval. It works with a
local model through Ollama and no account at all, and with OpenAI-compatible,
Anthropic, and OpenRouter endpoints when you want them. The same agent loop drives the
terminal interface, the headless command line, and editors over the Agent Client
Protocol.

## What it does

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

## Install

Once a release is published, download the binary for your system and check it against
`SHA256SUMS`:

```bash
sha256sum -c SHA256SUMS --ignore-missing
chmod +x jamcli-linux-x64 && mv jamcli-linux-x64 ~/.local/bin/jamcli
```

Binaries are built for Linux (x64, arm64), macOS (x64, arm64), and Windows (x64).

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
```

See [Getting started](docs/getting-started.md).

## Documentation

Pages marked "not yet written" are listed in `openspec/DEFERRED.md`.

| Topic | Page |
|---|---|
| First run, providers, a first task | [getting-started.md](docs/getting-started.md) |
| Configuration layers and every key | [configuration.md](docs/configuration.md) |
| Permission modes, rules, and the sandbox | [permissions.md](docs/permissions.md) |
| Built-in tools | [tools.md](docs/tools.md) |
| Providers, models, keys, cost | not yet written |
| Sessions, resume, fork, checkpoints | not yet written |
| Custom commands and skills | not yet written |
| Hooks | not yet written |
| Plugins | not yet written |
| Workflows | not yet written |
| MCP, ACP, the observer, LSP | not yet written |
| Headless use | not yet written |
| The interface, keys, micro mode | not yet written |
| Security model | not yet written |
| Upgrading from 1.x | not yet written |
| Changes | not yet written |
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
conventions, and `openspec/DEFERRED.md` lists what is not finished.

## Status

A personal project, not published to npm. Use it with care: an agent that edits files
and runs commands can do damage, which is why the default mode asks before every change.
Issues and pull requests are welcome.
