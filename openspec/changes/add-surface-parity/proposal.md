# Change: Surface parity for commands

## Why

JamCLI puts its behavior in core so every surface gets the same harness. Tools follow that
rule, and they run the same in the interface, headless, and over ACP. Commands do not. All
of the roughly forty built-in slash commands live in `src/tui/app/`, written against a
context only the interface can supply. So `/reflect`, `/compact`, `/resume`, `/diff`,
`/commit`, `/mcp`, and the rest exist only for a person at a terminal. `jamcli -p "/compact"`
sends the text to the model, and an editor over ACP is offered custom commands and MCP
prompts but no built-in one. The interface also reaches into `src/cli/` for the work those
commands share with the CLI verbs, so the layer that should only render depends on the
dispatcher.

This is the first half of a larger gap: nothing but the person at a terminal can use
JamCLI fully. Another agent cannot delegate work to it beyond one headless prompt, and an
agent asked to try JamCLI and find what is wrong has no way in. `add-mcp-server`, the next
unit in `ROADMAP.md`, closes that with `jamcli mcp serve`; it needs every command reachable
without a screen first, which is this change.

The invariant is **surface parity**: what a person can do in JamCLI, any surface can do,
through the same code, under the same permissions.

## What Changes

- **Commands leave the interface.** A new layer, `src/commands/`, owns the command registry,
  command parsing, and every built-in command, against a context any surface can supply:
  show text and diffs, give notices, run a turn, open a session, switch the mode, offer a
  choice, and put a command line forward for the person to finish. There is one command set:
  every surface offers every command. What only a terminal can do (repaint in a new theme)
  is a context method the interface implements and other surfaces skip, while the rest of
  the command (saving the theme) runs everywhere. `src/commands/` imports neither OpenTUI
  nor React.
- **One host for surfaces without a terminal.** A `CommandHost` supplies that context where
  nobody is at a terminal. A choice is listed with its keys and answered with `/choose
  <key>`, or in advance with headless `--choose`. Opening another session is refused with
  the surface's own way to do it. Bypass is never entered this way.
- **Headless runs built-in commands.** `jamcli -p "/compact"`, `-p "/resume list"`, and
  `-p "/reflect"` run the command. A command's output is the response; a turn it sends runs
  as any headless turn does.
- **ACP offers and runs built-in commands.** An editor is offered every built-in command, and a prompt naming one runs it; choices come back as a
  list answered with `/choose`.
- **The observer says whose answer a call waits for.** The ACP observer endpoint
  (`JAMCLI_ACP_ENDPOINT`) already streams a waiting call and a `requires_action` state. It
  now says which tool the call is for and whether that tool always asks, so any watcher
  knows the answer is the person's. `add-mcp-server` builds on it.
- **A choice can be the person's.** The hooks trust question is marked so; the host lists
  it but never answers it from answers given in advance.
- **A parity test** fails when any built-in command is not reachable on headless and ACP.
- **Docs.** Headless, ACP, and the command reference say that every built-in command runs
  there, and how lists are answered. `AGENTS.md` and `openspec/config.yaml` name
  `src/commands/` in the layout.

## Not in this change

- `jamcli mcp serve`, with its `session_*` and `terminal_*` tools: `add-mcp-server`.
- Turning what agents find into proposals: `add-findings-loop`.
- Generating CLI verbs from commands. The existing verbs stay; they and the commands share
  the same operation code.
- A result schema per command. Commands produce text and diffs, as they do in the
  interface.

## Impact

- Code: `src/commands/` (new), `src/tui/app/` (commands move out; the interface supplies the
  context), `src/acp/`, `src/cli/run.ts`, `src/cli.ts`, `src/tui/observer.ts`,
  `src/core/types.ts` and `src/core/permissions/engine.ts` (an approval says when its tool
  always asks).
- Docs: `docs/headless.md`, `docs/protocols.md`, `docs/commands-and-skills.md`,
  `docs/architecture.md`, `AGENTS.md`, `openspec/config.yaml`.
- Specs: Slash Command Surface, Command Line Invocation, ACP Agent Surface, and ACP Observer
  Endpoint are modified.
