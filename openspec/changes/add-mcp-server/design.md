# Design: JamCLI as a tool for other agents

## One session model

`session_*` does not implement sessions. It holds an ACP session controller
(`createAcpSession`) per session, the same object the ACP server holds, with its command
host. What differs is only the transport: ACP pushes updates and asks the editor for
permission; MCP has no push to the caller's model, so the adapter keeps, per session:

- the output since the caller last read it: reply text, tool calls with their results and
  diffs, notices, and command output, each an entry;
- the one thing the session waits on: an approval request (its call, preview, reason, and
  the choices allow once, allow for the session, deny) or a list a command offered;
- whether a turn runs.

`session_send` starts the prompt or command and waits until the turn ends, the session
waits on something, or `wait_ms` passes (default 120 s), then returns the new output and
what it waits on. Progress notifications carry the output as it arrives, where the host
asked for them. `session_answer` answers the approval or list and waits the same way.
`session_state` reports without waiting. A turn is never left behind: `session_stop`
cancels one that runs.

## Whose answer it is

A pending approval whose request says `alwaysAsks`, or a list marked `personOnly`, is the
person's. `session_answer` refuses it. The server puts it to the person by elicitation,
from within the tool call that is waiting when it arrives (every waiting call is a request
the server can elicit under): the preview and reason as the message, and the choices as a
single enumerated field. A host without the elicitation capability, a declined or cancelled
elicitation, or an elicitation that fails is a denial with that reason. The calling agent
sees that it was asked and what the person answered, never a way to answer it.

## The terminal

`src/terminal/` holds the harness the end-to-end tests used: Bun's pseudo-terminal,
`@xterm/headless` reading everything JamCLI writes, and the emulator's answers to
JamCLI's queries sent back as a terminal's are. It launches JamCLI as the shipped build's
shebang does, `bun --no-env-file --config=/dev/null` and the entry, from the same
executable and entry that runs the server; a compiled binary launches itself. It keeps an
asciinema v2 recording, can resize, and names keys as a terminal encodes them.

`terminal_start` sets `JAMCLI_ACP_ENDPOINT` for the JamCLI it starts, as any person may,
and watches the observer. While the observer's `requires_action` says the waiting call's
tool always asks, `terminal_type` and `terminal_keys` are refused and the person is asked by
elicitation; their answer is typed as the key the prompt takes (1 to allow once, Escape to
deny). The bypass confirmation and the hooks trust question show only on screen; they are
the person's by the rule in `AGENTS.md`, not by a check.

Settling: `terminal_wait` returns when the screen shows given text, or when the observer
says the session is idle or waits and the screen has not changed for a moment, or at its
limit.

## Where a terminal differs from a person's

The emulator is an xterm-compatible terminal: it does not speak kitty's keyboard protocol
and answers color queries only with the colors given. A person's terminal may differ the
same way. A difference found later is fixed in the terminal, never in JamCLI.

## Tests

- An MCP client from the SDK drives `jamcli mcp serve` in a child process, on the fake
  provider: a session edits a file with an approval answered by `session_answer`; `/context`
  and `/effort` with its list answered; a commit waits on the person, and an elicitation
  handler that accepts, one that declines, and a client without the capability each have
  their outcome; the calling agent's `session_answer` on it is refused.
- A terminal runs JamCLI on the fake provider: the screen shows a reply, keys answer an
  approval, a commit's approval refuses keys and elicits, the recording plays back, and
  the terminal stops with the process.
- The end-to-end tests use the moved harness and still pass.
