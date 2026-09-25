# Protocols

JamCLI speaks MCP, ACP (both sides), and LSP. The code lives in `src/core/mcp/`,
`src/acp/`, `src/services/AcpClient.ts`, `src/tui/observer.ts`, and `src/core/lsp/`.

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

## ACP

`jamcli acp` serves the Agent Client Protocol on the official SDK, for an editor or a
terminal manager.

- `initialize` offers session load and embedded context. `session/new` returns the
  session, its modes, and its config options; `available_commands_update` arrives after
  the reply. `session/load` replays the recorded conversation before it answers.
- `session/prompt` streams updates; every update is flushed before the prompt reply.
  A call that asks becomes `session/request_permission` with allow once, allow for the
  session, reject, and reject-with-a-reason. A rejection with no feedback stops the turn.
- `session/set_mode` takes `plan`, `default`, `accept-edits`, or `auto` (never `bypass`);
  `session/set_config_option` switches the model. `apply_patch` reports every file it
  touches as a tool location, and a tool result past 20,000 characters is cut with a note.
- The delegating client (`delegate` and `.jamcli/agents.json`) starts an external agent
  with the session's minimal environment, offers it no file system or terminal
  capabilities, and answers its permission requests from the surface's policy.

## The observer

`JAMCLI_ACP_ENDPOINT=unix:<path>` serves a read-only ACP session on a user-private Unix
socket beside the interface, so a terminal manager can watch what is on screen. It
refuses a path in a directory others can write, and its socket is 0600 from creation. It
lists and loads the interface's session, streams its updates and state (`running`,
`requires_action`, `idle`), and cannot open sessions, prompt, or approve. A client that
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
