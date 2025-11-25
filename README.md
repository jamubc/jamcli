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

## Features

- **Provider Agnostic**: Supports Ollama (default) and extensible for OpenAI/Anthropic.
- **Human-in-the-Loop**: All file edits and shell commands require explicit user approval.
- **Configuration Profiles**: Switch between different behavior profiles via `.jamcli/profiles`.

## Prerequisites

- [Bun](https://bun.sh) runtime (required for Ink)
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

- **Runtime**: Bun (required for OpenTUI's native integrations)
- **UI Framework**: OpenTUI + React
- **State Management**: Zustand
- **Type Safety**: TypeScript
- **MCP**

