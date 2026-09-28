# Protocols

JamCLI speaks MCP (both sides), ACP (both sides), and LSP. The code lives in
`src/core/mcp/`, `src/mcp/`, `src/acp/`, `src/services/AcpClient.ts`,
`src/tui/observer.ts`, and `src/core/lsp/`.

## MCP

- Transports: stdio for a command, streamable HTTP for a URL. Both the 2025 handshake and
  the 2026-07-28 revision are spoken; the client picks what the server answers.
- A server's tools are offered as `server__tool`; its prompts become `/server:name`; its
  resources become `@server:uri`. A server that fails to start is reported and skipped,
  and does not hide another server's tools, prompts, or resources.
- A tool the server marks read-only runs without asking; any other asks. A server's
  request for input is shown as a form in the interface and declined elsewhere.
- `jamcli mcp add|list|test|remove` manages entries; `jamcli mcp login <id>` signs in to
  an HTTP server that needs OAuth, storing tokens in the credential store.
- Past `tool_search.threshold` MCP tools, their schemas are held back and the model loads
  them with `search_tools`; built-in tools stay listed, and a tool denied by a rule is
  never loadable. Resource text is redacted like file content.

## JamCLI as an MCP server

`jamcli mcp serve` speaks MCP on stdio, so any agent host can use JamCLI the way a person
does. Add it once, for example `claude mcp add jamcli -- jamcli mcp serve`.

- **Sessions, for delegating work.** `session_start` opens a session in a directory (its
  project root is found from it, as `jamcli` does when started there); `session_send`
  sends a prompt or any `/command`, and is refused while a list waits for its answer;
  `session_answer` answers a call waiting for approval (`allow_once`, `allow_session`,
  `deny`) or a list a command offered. A waiting call lists the patterns a session grant
  may take, narrowest first, as the interface's prompt offers them, and `allow_session`
  takes one as `pattern`, the first when absent. `session_state` reports; `session_stop`
  ends one, which stays in history, and a later call on it says how to resume it with
  `session_start`. Each is the same session an
  editor opens over ACP, with the same runtime, commands, and permissions. A call returns
  when the turn ends, when the session needs an answer, or after `wait_ms`, with what
  happened since the caller last read it, in words and as structured content; progress
  notifications carry it meanwhile.
- **Terminals, for using the interface itself.** `terminal_start` runs the ordinary
  `jamcli`, launched as the shipped build launches it, in a pseudo-terminal read through a
  terminal emulator; `terminal_type`, `terminal_keys`, `terminal_screen`, `terminal_wait`,
  `terminal_resize`, and `terminal_stop` use it. JamCLI has no mode for being driven: the
  only thing set is `JAMCLI_ACP_ENDPOINT`, so the interface's observer says whether it is
  working or waiting. Each terminal keeps an asciinema recording under the state
  directory's `mcp-terminals/`. The emulator is an xterm-compatible terminal: it does not
  speak kitty's keyboard protocol.
- **What is the person's stays theirs.** A call to a tool that always asks (a commit, a
  lesson from `/reflect`) and a choice marked as the person's (trusting a project's hooks)
  are never the calling agent's to answer in a session: `session_answer` refuses them, and
  the person is asked by elicitation in their own host, pushed on a 2025 connection or
  returned as `input_required` on a 2026-07-28 one. A host that cannot ask (OpenCode today)
  gets a denial. In a terminal, only a call to a tool that always asks is caught: the
  observer marks it, keys sent while it waits are not sent, and the person is asked. Every
  choice there, from `/commit`'s confirmation and `/pr`'s push to hooks trust and the
  bypass confirmation, shows only as screen text and is the person's by rule.

## ACP

`jamcli acp` serves the Agent Client Protocol on the official SDK, for an editor or a
terminal manager.

- `initialize` offers session load and embedded context. `session/new` returns the
  session, its modes, and its config options; `available_commands_update` arrives after
  the reply. `session/load` replays the recorded conversation before it answers.
- `session/prompt` streams updates; every update is flushed before the prompt reply.
  A call that asks becomes `session/request_permission` with allow once, allow for the
  session, reject, and reject-with-a-reason. A rejection with no feedback stops the turn.
- `available_commands_update` offers every built-in command, beside custom commands and
  MCP prompts. A prompt naming one runs it, as the interface would: what it shows arrives
  as message chunks, and a turn it sends is the prompt's turn. A list it offers is printed
  with a key per choice and answered with `/choose <key or number>` in the next prompt.
  `/mode` sends `current_mode_update`, `/model` sends `config_option_update`, and `/exit`
  closes the session.
- `session/set_mode` takes `plan`, `default`, `accept-edits`, or `auto` (never `bypass`);
  `session/set_config_option` switches the model. `apply_patch` reports every file it
  touches as a tool location, and a tool result past 20,000 characters is cut with a note.
- An editor that offers its file system (`fs.readTextFile`, `fs.writeTextFile`) gets the
  session's reads and writes: `read_file`, `edit`, `write_file`, and `apply_patch` see
  unsaved changes and write into open buffers. Permissions, checkpoints, and the path
  rules apply as before; a read the editor cannot answer falls back to the disk.
- An editor that offers terminals (`terminal`) runs `run_command` in one, shown under the
  call while it runs and left there after. The program is the one JamCLI would start: the
  sandbox's wrapper or the shell, under `env -i` with the command environment, so the
  editor's own environment and its credentials never reach it. A time limit or a cancel
  kills it and keeps what it printed. When the editor cannot start the terminal, the
  command runs here. Background commands and delegated tasks keep their own processes.
- The delegating client (`delegate` and `.jamcli/agents.json`) starts an external agent
  with the session's minimal environment, offers it no file system or terminal
  capabilities, and answers its permission requests from the surface's policy.

## The observer

`JAMCLI_ACP_ENDPOINT=unix:<path>` serves a read-only ACP session on a user-private Unix
socket beside the interface, so a terminal manager can watch what is on screen. It
refuses a path in a directory others can write, and its socket is 0600 from creation. It
lists and loads the interface's session, streams its updates and state (`running`,
`requires_action`, `idle`), and cannot open sessions, prompt, or approve. A
`requires_action` update names the waiting call's tool in `_meta.jamcli.tool`, and
`_meta.jamcli.alwaysAsks` is true when that tool always asks, such as a commit or a
lesson from `/reflect`: an answer only the person gives. A client that
stops reading is dropped rather than slowing the interface, and a client that dies leaves
the turn running to its end.

## LSP

Language servers are detected from the defaults (typescript, python, go, rust) and from
`lsp.servers`. The `lsp` tool asks for a file's diagnostics, hover, definition,
references, or symbols; lines and columns are 1-based. After an edit, write, or patch,
the changed file's errors are reported to the model (warnings are not), capped at 20
lines and redacted. A server that fails to start is tried again on the next request; one
that ignores shutdown is killed. Servers run in the session's sandbox with the session's
environment. Workspace symbols, rename, and code actions are not wired (a known gap).
