# JamCLI

![status](https://img.shields.io/badge/status-experimental%20beta-orange)

**an efficient multi-model CLI multi-tool**
---
✓ Works in your terminal

✓ Supports Ollama and Openrouter models /w easy filtering + selection

✓ styling system

---
--> Roadmap:

X Tools and their usage

X Plugins system

X Git integration

⚠️ **Experimental**: Please be careful when working with AI systems, use at your own risk. Feedback, issues, and pull requests are absolutely welcome.

<img width="837" height="291" alt="Screenshot1" src="https://github.com/user-attachments/assets/80ac7d8e-fe5a-4547-b4c7-94b283be83a0" />
<img width="837" height="350" alt="Screenshot2" src="https://github.com/user-attachments/assets/75713839-1992-4d6b-a959-125b71742708" />
<img width="837" height="242" alt="Screenshot3" src="https://github.com/user-attachments/assets/49779295-9338-4655-a4f1-2d8d8994f881" />
<img width="1013" height="391" alt="Screenshot5" src="https://github.com/user-attachments/assets/50280caf-86a8-45ab-bc68-22fa7e58ac81" />


## Features

- **Provider Agnostic**: Supports Ollama (default) and extensible for OpenAI/Anthropic.
- **Human-in-the-Loop**: All file edits and shell commands require explicit user approval.
- **Configuration Profiles**: Switch between different behavior profiles via `.jamcli/profiles`.

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

Any argument switches the entry point out of the interface and onto the command surface:

```bash
jamcli -p "summarize the changes in src/core" --output-format text
jamcli -p "list the tool registry" --output-format json | jq -r .response
jamcli -p "read package.json and report the version" --output-format stream-json | jq -c 'select(.type=="tool_call")'
```

- `--output-format text` prints the answer, `json` prints one object with `session_id`, `status`, `response`, `duration_ms`, `turns`, and `usage`, and `stream-json` prints one event per line while it runs.
- Exit codes: `0` on success, `1` on a refused or limited run, `2` on a usage error.
- `--allow-tool <name>` and `--deny-tool <name>` govern the run without prompting. A headless run never prompts: a state-changing tool that would ask is refused, and the message names the flag that would permit it. A deny always wins.
- `--cwd`, `--max-turns`, `--model`, `--continue`, and `--resume <id>` bound and shape the run.
- `jamcli sessions list`, `jamcli sessions search <query>`, and `jamcli sessions export <id>` read the existing history files without migrating them.
- `jamcli mcp add|list|test|remove` manages MCP servers, and `jamcli audit` reports tool access, isolation, and guardrail findings by severity without writing anything.
- `jamcli acp` serves the Agent Client Protocol over stdio for an ACP client such as Zed.

**Driving a vendor subscription through a third-party protocol client can violate that vendor's terms of service.** The ACP surface exists for agents and endpoints you are entitled to drive. Where the vendor offers an API-key path, use that instead: configure the key through `key_env_var` so it stays out of the project file.

## Configuration

The CLI uses a `.jamcli` directory in your project root.

### Project Root Detection

JamCLI automatically detects the project root by walking up the directory tree from your current working directory until it finds a `.jamcli` folder. This ensures that:

- You can run `jamcli` from any subdirectory.
- The same configuration and MCP servers are used across the project.
- Chat history is preserved and shared regardless of where you launch the CLI within the project.

### Configuration Files

- `config.json`: General settings.
- `mcp.json`: Tool permissions and context limits.
- `profiles/`: AI behavior profiles.
- `styles` may be created using `/config > Style > Create Custom Style`

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

