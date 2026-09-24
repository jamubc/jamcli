# JamCLI

![status](https://img.shields.io/badge/status-experimental%20beta-orange)

**an efficient multi-model CLI multi-tool**
---
✓ Works in your terminal

✓ Supports Ollama and Openrouter models /w easy filtering + selection

✓ styling system

---
--> Roadmap:

X Plugins system

X Git integration

⚠️ **Experimental**: Please be careful when working with AI systems, use at your own risk. Feedback, issues, and pull requests are absolutely welcome.

<img width="837" height="291" alt="Screenshot1" src="https://github.com/user-attachments/assets/80ac7d8e-fe5a-4547-b4c7-94b283be83a0" />
<img width="837" height="350" alt="Screenshot2" src="https://github.com/user-attachments/assets/75713839-1992-4d6b-a959-125b71742708" />
<img width="837" height="242" alt="Screenshot3" src="https://github.com/user-attachments/assets/49779295-9338-4655-a4f1-2d8d8994f881" />
<img width="1013" height="391" alt="Screenshot5" src="https://github.com/user-attachments/assets/50280caf-86a8-45ab-bc68-22fa7e58ac81" />


## Features

- **Three surfaces, one core**: the terminal interface, a one-shot command line, and an Agent Client Protocol server all drive the same agent loop.
- **Provider agnostic**: Ollama with no account, any OpenAI-compatible endpoint, and a translated Anthropic-shaped endpoint. Keys come from `key_env_var` wherever the provider allows it.
- **Tool registry**: a tool declares its name, description, JSON Schema, policy class, and runner. Built-ins cover files, search, glob, edit, a todo list, read-only git, and delegation; MCP tools join the same list.
- **Human in the loop**: state-changing tools ask before running, a deny always wins, and a headless run never prompts, it refuses and names the flag that would allow it.
- **Trust gate**: tool output is screened for relevance and prompt injection before it enters context, and every removal is named with its reason.
- **Project rules**: instruction files are collected from the project root to the working directory and injected outermost first, with glob-conditional sections.
- **Hooks**: session start, turn start, pre-tool, post-tool, compaction, and session end, with a throwing hook reported rather than fatal.
- **Category routing**: a category names an ordered chain of models, so delegated work resolves its own model instead of inheriting the session's.
- **Configuration profiles**: switch between different behavior profiles via `.jamcli/profiles`.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Node.js (for npm package management)

## Installation

### For Development/Testing

```bash
# Install dependencies
bun install

# Link globally for testing (creates symlink)
npm link

# Now you can run from anywhere
jamcli
```

**Note:** No build step is required! The `npm link` command creates a symlink to your development directory. The global `jamcli` command runs the source code directly using Bun's runtime, so any changes you make to the source files are immediately reflected.

### For Production Use

```bash
# Install dependencies
bun install

# Install globally
npm install -g .

# Run from anywhere
jamcli
```

## Usage

Run the CLI from any directory:

```bash
jamcli
```

### Slash Commands

**Tip:** Type `/` in the input bar to see command suggestions.

### One-shot and piped use

Any argument that asks for a run or a subcommand switches the entry point out of the interface and onto the command surface:

```bash
jamcli -p "summarize the changes in src/core" --output-format text
jamcli -p "list the tool registry" --output-format json | jq -r .response
jamcli -p "read package.json and report the version" --output-format stream-json | jq -c 'select(.type=="tool_call")'
```

- `--output-format text` prints the answer on stdout and notices on stderr. `json` prints one object with `type` (`result`), `session_id`, `status`, `response`, `error` when there was one, `provider`, `model`, `permission_mode`, `sandbox`, `duration_ms`, `turns`, `usage`, `permission_denials`, `notices`, and in a dry run `dry_run`. `stream-json` prints one event per line while it runs, including tool output, approval decisions, retries, and notices, and ends with the same result object.
- The result reports what the session cost: `total_cost_usd`, `unpriced_requests`, `model_usage` with requests, tokens, and `cost_usd` for each model, and `delegated` when delegated tasks spent part of it. A cost is `null` when none of its requests had a known price, and a lower bound while `unpriced_requests` is above zero. Each `usage` event in `stream-json` carries its `model` and `cost_usd`, and `delegated_session` when a delegated task made the request. `jamcli sessions show` prints the same account.
- Exit codes: `0` on success, `1` on an error or a limited run, `2` on a usage error, and `130` when interrupted. The first Ctrl+C cancels the turn and still prints the result; a second one exits at once.
- `--allow-tool <name>` and `--deny-tool <name>` govern the run without prompting. `--allow-tool` lets the named tool run without asking and leaves every other tool as it was. `--allowed-tools` and `--disallowed-tools` take rules such as `edit(src/**)` or `run_command(npm test *)`. A headless run never prompts: a call that would ask is not made, the model is told why and which flag would allow it, the run carries on, and the call is listed in `permission_denials`. A deny always wins.
- `--permission-mode` picks `plan` (read and plan only), `default`, `accept-edits` (edits inside the project run without asking), `auto` (commands run without asking inside a sandbox, and only when one works here), or `bypass`, which only `--dangerously-bypass-permissions` can start. Rules and modes also live in the `permissions` block of `.jamcli/config.json`; the full syntax is in `openspec/changes/rehaul-jamcli/design.md` (D6) until the documentation lands.
- `--dry-run` makes no change: every tool is offered, reads run, and each call that would have changed something is answered as not made and listed with its diff or command, after the answer or under `dry_run` in JSON.
- Commands run in a sandbox where one works (bubblewrap on Linux, Seatbelt on macOS): the project is writable, the network is off, and credentials such as `~/.ssh` are hidden. No process JamCLI starts gets a variable whose name looks like a credential. The result's `sandbox` field says which sandbox ran.
- `--cwd`, `--max-turns`, `--model`, `--continue`, and `--resume <id>` bound and shape the run. `--model` takes `provider:model` or a model on the profile's provider, and a model id with its own colon, such as `qwen2.5-coder:7b`, stays whole.
- `@path` in a prompt includes that file or directory listing, as it does in the interface.
- `jamcli sessions list`, `search <query>`, `show <id>`, `export <id>`, and `fork <id>` work on this project's sessions. Sessions record every message, tool call, result, and approval decision, and older history files are read without being rewritten.
- `jamcli mcp add|list|test|remove` manages MCP servers, and `jamcli audit` reports tool access, isolation, and guardrail findings by severity without writing anything.
- `jamcli acp` serves the Agent Client Protocol over stdio for an ACP client such as Zed:

```bash
~/.local/bin/acp-delegate --agent "bun src/index.tsx acp" --cwd . --prompt "unused" --list-only
# agent: jamcli 1.0.0  protocol v1
# session: <id>
#   model: model = <configured model>
#   profile: profile = default
```

**Driving a vendor subscription through a third-party protocol client can violate that vendor's terms of service.** The ACP surface exists for agents and endpoints you are entitled to drive. Where the vendor offers an API-key path, use that instead: configure the key through `key_env_var` so it stays out of the project file.

## Configuration

The CLI uses a `.jamcli` directory in your project root.

### Project Root Detection

JamCLI automatically detects the project root by walking up the directory tree from your current working directory until it finds a `.jamcli` folder. This ensures that:

- You can run `jamcli` from any subdirectory.
- The same configuration and MCP servers are used across the project.
- Chat history is preserved and shared regardless of where you launch the CLI within the project.

### Configuration Files

- `config.json`: General settings, including `agent_loop` bounds, `categories` for routed work, `delegation` limits, and `trust`.
- `mcp.json`: Tool permissions, context limits, ignore patterns, and MCP servers over stdio or streamable HTTP.
- `profiles/`: AI behavior profiles.
- `AGENTS.md`, `CLAUDE.md`, and `.jamcli/rules/*.md`: project rules, collected from the project root toward the working directory. A section headed `# when: <glob>` applies only to matching work.
- `styles` may be created using `/config > Style > Create Custom Style`

### Models: limits and prices

JamCLI sizes each request from what it knows about the model: its context window, its
output limit, and its prices. Each fact comes from the first source that has it:

1. the `models` block in `config.json`;
2. the provider's own metadata: Ollama's `/api/show`, OpenRouter's model list, and
   Anthropic's Models API, cached for a day under the cache directory;
3. a table bundled with JamCLI for Claude models, checked against Anthropic's published
   documentation;
4. a context window of 8,192 tokens, and no price.

Ollama models cost nothing, and their window is the `num_ctx` JamCLI sends: the model's
entry, else `api_registry.ollama.num_ctx`, else the model's own limit capped at 16,384.
A model with no known price is reported as unpriced, never estimated. Each request is
priced when it is made, so changing a price later does not rewrite what a session cost.

OpenAI's models route reports no limits or prices, so describe OpenAI models yourself.
Prices are US dollars per million tokens:

```json
{
  "models": {
    "openai:example-model": {
      "context_window": 200000,
      "max_output": 32000,
      "price": { "input": 2, "output": 8, "cache_read": 0.5 }
    },
    "ollama:qwen3-coder:30b": { "context_window": 65536 }
  },
  "agent_loop": { "max_output_tokens": 32000 }
}
```

The OpenAI numbers are illustrations; take real ones from your provider. The other
settings are `tools`, `reasoning`, `images`, `thinking` (`adaptive` or `budget`),
`always_thinks`, `effort`, and the price `cache_write`. `agent_loop.max_output_tokens`
caps how much each reply may write, 32,000 by default and never more than the model
allows. A reply cut off at that limit says so.

### Context

When a conversation nears the model's context window, JamCLI summarizes its older part
and keeps the latest messages as they were. It never separates a tool call from its
results, and a request cut in the middle keeps its wording. The budget is the window,
less the output a reply may need, less a tenth; compaction starts at 85 percent of it.
The estimate learns from the token counts the provider reports. For a model whose window
JamCLI does not know, it compacts only when the provider refuses a request as too long,
then retries once. A summary that fails leaves the older messages out, and the notice
says so. Set `"context": { "auto_compact": false }` in `config.json` to turn it off; the
older `context_management` block applies only to the legacy interface.

## Development

### Run Locally (without installing)

```bash

# watch mode /w auto-reload
bun run dev
```

### Cleanup

To remove the global `jamcli` command:

```bash
npm unlink -g jamcli
```

## Architecture

- **Runtime**: Bun
- **UI Framework**: Ink 7.1.1 (interim; OpenTUI is the committed target and the port follows this unit)
- **State Management**: Zustand
- **Type Safety**: TypeScript
- **MCP**

