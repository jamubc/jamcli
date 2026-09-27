# Change: Surface parity, and a driver for the interface

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

The second gap is how anyone other than the person uses JamCLI. Testing a change, debugging
a report, or letting an agent work on JamCLI all end the same way today: "run jamcli and try
this". An agent that can run shell commands has no supported way to use the interface: no
way to type into it, answer its prompts, choose from its lists, or read what it shows. Each
attempt invents a harness (a pseudo-terminal, tmux, screen scraping) that is slow, costly,
and not repeatable. The test suite already renders the real interface offscreen and types
into it, which is the supported way; it is simply not offered to anyone outside the tests.

Both gaps are one invariant not held: **surface parity**. What a person can do in JamCLI, a
program can do too, under the same permissions, without each feature wiring itself to each
surface.

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
- **`jamcli drive`: the interface, driven by a program.** `jamcli drive start` opens the real
  interface offscreen in a local process, on a session in a project, and prints its id.
  `send`, `type`, `keys`, `screen`, `state`, `wait`, and `stop` type into it, press keys, and
  read the screen and a structured state (the pending prompt or list, whether a turn runs,
  the status line, the latest rows). It is the interface itself, so everything a person can
  do is there without per-feature wiring, and what it shows can be checked. It listens only
  on a socket private to the user.
- **The person's answers stay the person's.** A call to a tool that always asks (a lesson
  from `/reflect`, a push), the bypass confirmation, and the question whether to trust a
  project's hooks are marked as the person's. `drive` refuses to answer them unless told
  `--as-person`, which exists for relaying the person's own answer.
- **A parity test** fails when any built-in command is not reachable on headless and ACP.
- **Docs and process.** `docs/driving.md` explains driving JamCLI. `AGENTS.md` says how any
  agent tests JamCLI by driving it. The layout rules name `src/commands/`.

## Not in this change

- An MCP server surface (`jamcli mcp serve`). ACP and `drive` cover programs and editors;
  MCP is a later unit if agents need it without a shell.
- Generating CLI verbs from commands. The existing verbs stay; they and the commands share
  the same operation code.
- A result schema per command. Commands produce text and diffs, as they do in the
  interface.
- Tagging sessions by who drove them, and any automatic learning from driven sessions.

## Impact

- Code: `src/commands/` (new), `src/tui/app/` (commands move out; the interface supplies the
  context and publishes its state to `drive`), `src/acp/`, `src/cli/run.ts`, `src/cli.ts`,
  `src/cli/drive.ts` (new), `src/core/permissions/engine.ts` and `src/core/types.ts` (an
  approval says when its tool always asks).
- Docs: `docs/driving.md` (new), `docs/headless.md`, `docs/protocols.md`,
  `docs/commands-and-skills.md`, `docs/architecture.md`, `AGENTS.md`.
- Specs: Slash Command Surface, Command Line Invocation, and ACP Agent Surface are modified;
  Interface Driver is added.
