# Getting started

## Install

Take the binary for your system from the release, check it, and put it on your `PATH`:

```bash
sha256sum -c SHA256SUMS --ignore-missing
chmod +x jamcli-linux-x64
mv jamcli-linux-x64 ~/.local/bin/jamcli
jamcli --version
```

On Linux, install `bubblewrap` so commands run sandboxed (`apt install bubblewrap`,
`dnf install bubblewrap`). macOS uses its built-in Seatbelt. Windows has no sandbox yet,
and the interface says so. Installing `ripgrep` makes search faster; JamCLI falls back
to its own search without it.

## The local path: Ollama, no account

```bash
ollama serve                    # if it is not already running
ollama pull qwen2.5-coder:7b    # or a larger coder model if memory allows
jamcli
```

On first run JamCLI finds Ollama, lists the models you have, and suggests one sized to
your memory if you have none. Nothing leaves the machine: traces are off unless you turn
them on, and no account is needed.

## A hosted provider

Keys go in the system keychain, or come from the environment:

```bash
jamcli auth set anthropic       # prompts for the key; stored in the keychain
export OPENAI_API_KEY=...       # or read from the environment
jamcli auth login openrouter    # browser sign-in for OpenRouter
```

Then choose a model with `/model` in the interface, or `--model anthropic:<model>` on
the command line. Models are addressed as `provider:model`. See
[providers.md](providers.md).

## A first task

In the interface, ask for something small:

```
> add a --verbose flag to scripts/probe.ts and print each probe's name
```

JamCLI reads the file, proposes an edit, and asks. The prompt offers: allow once, allow
a pattern for the session or the project, or deny with feedback that goes back to the
model. `Shift+Tab` moves through the permission modes. `/undo` takes the last change
back; `/diff` shows everything changed this session.

Headless, the same run:

```bash
jamcli -p "add a --verbose flag to scripts/probe.ts" --allow-tool edit
```

A headless run never prompts. A call that would ask is refused, and the output names the
flag that would allow it.

## Check the setup

```bash
jamcli doctor
```

It checks your configuration, keys, every model in use, the tools, the sandbox, MCP
servers, and the trace collector, and gives a fix for each problem.

## Next

- [configuration.md](configuration.md): where settings live and what each does.
- [permissions.md](permissions.md): modes, rules, and the sandbox.
- [interface.md](interface.md): keys, commands, and the composer.
