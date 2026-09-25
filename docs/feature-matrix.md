# Feature matrix

Where JamCLI stands against the coding CLIs it is benchmarked on, and why each gap is a
gap. The "Before" column is `openspec/changes/rehaul-jamcli/audit.md`. The "Now" column
is what the `rehaul-jamcli` change delivered, checked against the code when it closed on
2026-09-25. Work that did not land is listed in `openspec/DEFERRED.md`.

**Legend:**

| Mark | Meaning |
|---|---|
| ✓ | present |
| ◐ | partial |
| ✗ | absent |
| n.v. | not verified in this session; no claim is made either way |

A competitor cell is marked ✓ or ◐ only with a source listed at the bottom. First checked
2026-09-23.

**Decision column:**

| Decision | Meaning |
|---|---|
| parity | JamCLI matches what the others offer |
| exceeds | JamCLI does something the verified cells do not show |
| gap | not built, with the reason given |

## Core agent

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| Reads, edits, and runs commands with approval in the interactive UI | ✗ (F1, F2) | ✓ | ✓ [1] | ✓ [2] | ✓ [4] | ✓ [6] | parity |
| Same tools and behavior on every surface | ✗ (F1 to F3, F13) | ✓, enforced by a conformance test | n.v. | n.v. | n.v. | n.v. | exceeds |
| Streaming while tools are in use | ✗ (F7) | ✓ | ✓ [1] | n.v. | n.v. | n.v. | parity |
| Every tool call answered and recorded | ✗ (F8) | ✓ | n.v. | n.v. | n.v. | n.v. | parity |
| Local models, no account, offline | ◐ chat only | ✓ Ollama default, `num_ctx`, onboarding | ✗ Anthropic-family endpoints [1] | n.v. | n.v. | ◐ "open models" [6] | exceeds |
| Provider breadth | ✓ OpenAI-compatible, Anthropic, Ollama, custom | ✓ plus catalog, retries | ◐ Anthropic API, Bedrock, Vertex, Foundry [1] | ◐ OpenAI, ChatGPT sign-in [3] | n.v. | n.v. | parity |
| Model routing by kind of work | ✓ categories | ✓ | n.v. | n.v. | n.v. | n.v. | exceeds |
| Prompt caching and per-model thinking for Claude | ✗ (F14) | ✓ cache breakpoints, adaptive or budget thinking by model, replay only while valid | n.v. | n.v. | n.v. | n.v. | parity |
| OpenAI Responses API | ✗ | ✗ | n.v. | n.v. | n.v. | n.v. | gap: OpenAI's documentation is blocked from the build environment, so the adapter could not be built against it; Chat Completions stays fully supported |
| Headless use with machine-readable output | ◐ read-only, empty schemas | ✓ JSON, stream-json, `--dry-run` | ✓ `-p`, stream-json in and out, SDK [1] | n.v. | n.v. | n.v. | parity |
| `@` mentions of files and MCP resources, `!` shell in the composer | ✗ | ✓ through the same permission engine | n.v. | n.v. | n.v. | n.v. | parity |
| Delegated subagents | ◐ read-only children | ✓ full tools, narrowed policy, worktrees | ✓ background subagents, forks [1] | n.v. | n.v. | n.v. | parity |

## Safety and consent

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| Permission modes | ✗ | ✓ plan, default, accept-edits, auto, bypass | ✓ including classifier auto mode [1] | ✓ approval modes, permission profiles [2] | n.v. | n.v. | parity |
| Pattern rules with scopes | ✗ | ✓ | ✓ [1] | n.v. | n.v. | n.v. | parity |
| The rule behind every decision shown and logged | ✗ | ✓ | n.v. | n.v. | n.v. | n.v. | exceeds |
| OS sandbox for commands | ✗ | ✓ Linux (bubblewrap); ◐ macOS (Seatbelt, unit tested, the escape suite not yet run on a Mac); ✗ Windows | ✓ [1] | ✓ workspace write, network off [2] | n.v. | n.v. | parity, with a gap on Windows: no supported sandbox primitive yet, and it is shown as unsandboxed |
| Credentials withheld from subprocesses | ✗ (F11, F23) | ✓ | n.v. | n.v. | n.v. | n.v. | exceeds |
| Keys in the system keychain, browser sign-in | ✗ keys in the project file | ✓ keychain, Secret Service, or an owner-only file; OpenRouter PKCE sign-in, tested against a local fake only | n.v. | n.v. | n.v. | n.v. | parity |
| Tool output screened for prompt injection | ◐ headless only | ✓ every surface | ◐ classifier for permissions [1] | n.v. | n.v. | n.v. | exceeds |
| Checkpoints, undo, rewind | ✗ | ✓ without touching the user's git state | ✓ [1] | n.v. | n.v. | n.v. | parity (Gemini CLI also checkpoints [7]) |

## Sessions and transparency

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| Resume with tool context | ✗ text only (F17) | ✓ | ✓ [1] | n.v. | ◐ [5] | n.v. | parity |
| Fork, rewind | ◐ `/fork` | ✓ | ✓ [1] | n.v. | ◐ [5] | n.v. | parity |
| Context usage view, compaction | ◐ off by default | ✓ model-aware, `/context` | ✓ `/context` [1] | n.v. | n.v. | n.v. | parity |
| Model limits and prices, per model | ✗ fixed 4,096-token output, no prices (F14) | ✓ configuration, provider metadata, and a checked table, with each fact's source | n.v. | n.v. | n.v. | n.v. | parity |
| Bundled OpenAI model rows | ✗ | ✗ | n.v. | n.v. | n.v. | n.v. | gap: OpenAI's documentation is blocked from the build environment, so no number could be checked; OpenAI models take limits and prices from the `models` block, and the first turn names the setting |
| Cost tracking | ✗ tokens only | ✓ per request, session, model | ✓ `/cost`, `/usage` [1] | n.v. | n.v. | n.v. | parity |
| OpenTelemetry | ✗ | ✓ opt-in trace export over OTLP/HTTP JSON with GenAI attributes, content excluded by default; no metrics | ✓ [1] | n.v. | n.v. | n.v. | parity |
| Structured logs and a local trace | ✗ | ✓ JSON lines at four levels, `-v`/`-vv` on stderr, `--trace-file` | ✓ [1] | n.v. | n.v. | n.v. | parity |
| Environment diagnostics | ✗ | ✓ `jamcli doctor`: configuration, keys, every model in use, tools, the sandbox, MCP servers, and the collector, each problem with a fix | n.v. | n.v. | n.v. | n.v. | parity |
| Layered configuration, each value's origin shown | ◐ one project file, written at startup and never ignored (F18) | ✓ user, project, local, environment, and flags; `jamcli config list --show-origin`; a generated JSON schema | n.v. | n.v. | n.v. | n.v. | parity |

## Git

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| Read-only git inspection | ✓ | ✓ plus `git_log` | n.v. | n.v. | n.v. | n.v. | parity |
| Hunk-level diff review | ✗ | ✓ | n.v. | n.v. | n.v. | n.v. | parity |
| Commits and pull requests | ✗ | ✓ always explicitly approved, no attribution by default | ✓ with an attribution setting [1] | n.v. | n.v. | n.v. | parity |
| Worktree isolation | ✗ | ✓ | n.v. | n.v. | n.v. | n.v. | parity |

## Extensibility

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| Project instruction files (`AGENTS.md`) | ✓ | ✓ | n.v. | ✓ [3] | n.v. | n.v. | parity |
| Custom slash commands | ✗ | ✓ | n.v. | n.v. | n.v. | n.v. | parity |
| Agent Skills (`SKILL.md`) | ✗ | ✓ | ✓ [1] | ✓ [8] | n.v. | ◐ taste files as skills [6] | parity |
| User hooks | ◐ in-process only | ✓ command hooks with a JSON protocol | ✓ command, HTTP, agent hooks [1] | ✓ including managed hooks [9] | ✓ plugin hooks [5] | n.v. | parity |
| Plugins | ✗ | ✓ bundles of commands, skills, hooks, and MCP servers; lockfile with integrity; consent recorded outside the project; every part sandboxed | ✓ marketplaces, integrity checks [1] | ✓ discovery [2] | ✓ JavaScript and TypeScript plugins [5] | n.v. | parity; the hostile plugin tests pass, but network access is on or off, not per declared host |
| Declarative workflows with resume and schedules | ✗ | ✓ agent, command, tool, approval, commit, and nested steps; bounded parallelism; resume; git hooks and schedules, no daemon | ◐ workflows, scheduled cloud routines [1] | n.v. | n.v. | n.v. | parity |

## Protocols and integration

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| MCP client | ◐ 2025 protocol, no OAuth, interface only | ✓ 2026-07-28 with fallback, OAuth, elicitation, prompts, resources, tool search, every surface | ✓ 2026-07-28 by default [1] | ✓ [2] | n.v. | n.v. | parity |
| ACP agent (editor integration) | ◐ read-only, forgets turns | ✓ official SDK: load, modes, config options, diffs; ◐ the editor's file system and terminals are not used | n.v. | n.v. | ✓ [4] | n.v. | parity |
| ACP client (delegating to other agents) | ✓ | ✓ official SDK | n.v. | n.v. | n.v. | n.v. | exceeds |
| LSP diagnostics and navigation | ✗ | ✓ diagnostics after edits, an `lsp` tool for hover, definition, references, symbols; servers sandboxed | ◐ through a plugin [1] | n.v. | ✓ with formatters [4] | n.v. | parity |
| An editor watching an interactive session | ✗ | ✓ ACP observer on a local socket (`JAMCLI_ACP_ENDPOINT`) | n.v. | n.v. | n.v. | n.v. | exceeds |
| IDE extension beyond ACP editors | ✗ | ✗ | ✓ VS Code [1] | n.v. | ✓ [4] | n.v. | gap: ACP reaches Zed, JetBrains, Neovim, and Emacs; a VS Code extension is a separate product |

## Interface

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| Diffs and tool blocks in the transcript | ◐ approval modal only | ✓ | ✓ [1] | n.v. | n.v. | n.v. | parity |
| Permission prompt with pattern grants and feedback | ◐ allow or deny, once | ✓ once, a chosen pattern for the session or the project, or deny with feedback for the model | n.v. | n.v. | n.v. | n.v. | parity |
| Configurable keybindings | ✗ | ✓ | ✓ [1] | n.v. | n.v. | n.v. | parity |
| Vim editing mode | ✗ | ✗ | ✓ [1] | n.v. | n.v. | n.v. | gap: deferred until the composer is stable on OpenTUI; tracked for a later unit |
| Screen reader mode | ✗ | ✓ | ✓ [1] | n.v. | n.v. | n.v. | parity |
| `NO_COLOR`, high-contrast theme | ✗ | ✓ | ✓ `NO_COLOR` [1] | n.v. | n.v. | n.v. | parity |
| Mouse in lists and scrolling | ✗ | ◐ OpenTUI's mouse input is on and the transcript scrolls with the wheel; no test covers it | ✓ [1] | n.v. | n.v. | n.v. | parity |
| Glanceable status when tiled small | ✗ | ✓ micro mode: one static phrase | n.v. | n.v. | n.v. | n.v. | exceeds |
| First-run onboarding | ✗ | ✓ local-first | n.v. | n.v. | n.v. | n.v. | parity |
| Image input | ✗ | ✗ | n.v. | n.v. | n.v. | n.v. | gap: not in this unit; needs a vision-capable local path to keep the local-first promise |
| Web fetch | ✗ | ✓ `web_fetch`: asks by default, rules by domain, a redirect to another host not followed | n.v. | n.v. | n.v. | n.v. | parity |
| Web search | ✗ | ✗ | n.v. | n.v. | n.v. | n.v. | gap: every search API needs an account or network service; can be added as an MCP server |

## Distribution

| Capability | JamCLI before | JamCLI now | Claude Code | Codex CLI | OpenCode | Command Code | Decision |
|---|---|---|---|---|---|---|---|
| Single-file release binaries | ✗ | ✓ Linux, macOS, Windows, with checksums, built and smoke-tested here; SBOM and provenance in the staged release job, not yet run | n.v. | ✓ [3] | n.v. | n.v. | parity |
| npm package | ✗ | ✗ | n.v. | ✓ [3] | n.v. | n.v. | gap: the owner keeps the project unpublished on npm |

## Deliberate gaps

These are features at least one benchmarked tool ships that JamCLI will not build. Each
reason comes from `openspec/project.md`.

| Feature | Present in | Reason |
|---|---|---|
| Memory or learning from past sessions | Claude Code [1], Command Code's "taste" [6] | Rejected by `project.md`: `hermes-plasticity-plugin` ran 26 cycles for about 138,000 tokens and committed zero memories. |
| Hosted or remote sessions | Claude Code [1], Codex cloud tasks [2] | Contradicts local by default. |
| Agent teams, member visualization | Claude Code [1] | Rejected: the complexity cost is real and the benefit unproven for a single user. Workflows get bounded parallel steps instead. |
| Enterprise managed settings, SSO, gateways | Claude Code [1], Codex [9] | Personal project; no multi-user administration. |
| DAP | none verified | No evidence yet that a debugger protocol improves an agent loop over running tests. |

## Sources

1. [Claude Code changelog](https://code.claude.com/docs/en/changelog), read 2026-09-23.
2. [Codex agent approvals and security](https://developers.openai.com/codex/agent-approvals-security), [Codex sandboxing](https://developers.openai.com/codex/concepts/sandboxing), and [a 2026 Codex guide](https://blakecrosley.com/guides/codex), from search results; the OpenAI documentation domain is blocked from the audit environment.
3. [openai/codex README](https://github.com/openai/codex).
4. [OpenCode LSP documentation](https://opencode.ai/docs/lsp/) and [OpenCode on DeepWiki](https://deepwiki.com/anomalyco/opencode).
5. [OpenCode plugin system on DeepWiki](https://deepwiki.com/anomalyco/opencode/2.9-plugin-system).
6. [Command Code features](https://commandcode.ai/features) and [launch notes](https://commandcode.ai/launch).
7. [Gemini CLI checkpointing](https://geminicli.com/docs/cli/checkpointing/) and [headless mode](https://geminicli.com/docs/cli/headless/).
8. [Agent Skills specification](https://github.com/agentskills/agentskills), adoption as reported there.
9. [openai/codex configuration notes](https://github.com/openai/codex/blob/main/docs/config.md) (managed hooks).
