# Change: JamCLI as a tool for other agents

## Why

Another agent can reach JamCLI today only through one headless prompt at a time, or ACP,
which agent hosts such as Claude Code and OpenCode do not speak as clients. So an agent
cannot delegate a conversation of work to JamCLI, and an agent asked to try JamCLI and find
what is wrong with it has no way in: every such request ends with "run jamcli and try this"
handed back to the person, or with a harness invented for the occasion. A harness made for
the occasion is a special mode, and a special mode hides the bugs it exists to find.

Agent hosts speak MCP. `add-surface-parity` made every command run the same on every
surface; this change offers that to any MCP host, and offers the interface itself, as the
same program a person runs.

## What Changes

- **`jamcli mcp serve`**: an MCP server on stdio, the way `claude mcp serve` is. A host adds
  it once, for example `claude mcp add jamcli -- jamcli mcp serve`.
- **`session_*` tools, for delegating work.** `session_start` opens a JamCLI session in a
  directory; `session_send` sends a prompt or any `/command`; `session_answer` answers what
  the session waits on; `session_state` reports it; `session_stop` ends it. They are a thin
  adapter over the ACP session controller and the command host, so MCP means what ACP and
  headless mean. `session_send` returns when the turn ends, when the session needs an
  answer, or after a wait the caller chooses, reporting progress meanwhile.
- **`terminal_*` tools, for using the interface itself.** `terminal_start` runs the ordinary
  `jamcli` program, launched as the shipped build launches it, in a pseudo-terminal read
  through a terminal emulator; `terminal_type`, `terminal_keys`, `terminal_screen`,
  `terminal_wait`, `terminal_resize`, and `terminal_stop` use it. JamCLI has no driven mode:
  the program on the other end is the one a person runs and does not know it is driven.
  Each terminal keeps an asciinema recording of everything JamCLI wrote. The harness the
  end-to-end tests use moves from `src/testing/` into the product for this, and launches
  JamCLI exactly as the shipped build does.
- **The person's answers stay the person's.** A call to a tool that always asks (a commit,
  a lesson from `/reflect`) and a choice marked as the person's (trusting a project's hooks)
  cannot be answered by the calling agent. The server asks the person through MCP
  elicitation in their own host, and denies where the host cannot ask. Claude Code's CLI
  elicits; OpenCode does not yet, so there such calls are denied. For a terminal, the
  observer says when the interface waits on such a call; keys the caller sends then are
  refused, and the person is asked instead.

## Not in this change

- Turning what an agent finds into proposals: `add-findings-loop`.
- Moving `jamcli-trials` onto this server; recorded for after it.
- MCP over HTTP. Stdio is what agent hosts launch, and it keeps the server private to the
  user.

## Impact

- Code: `src/mcp/` (new), `src/terminal/` (moved from `src/testing/terminal.ts`, grown),
  `src/cli.ts`, `src/acp/session.ts` (what the adapter needs from a session).
- Docs: `docs/protocols.md`, `docs/headless.md`, `README.md`, `AGENTS.md`.
- Specs: MCP Server Surface is added.
