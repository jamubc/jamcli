# Changelog

## 2.0.0

JamCLI 2.0.0 is the rehaul: a terminal-native agent rebuilt around one agent loop, with
every surface on top of it.

### The agent

- One agent loop drives headless runs, the interface, the ACP server, delegated children,
  workflows, and the observer. Tools, permissions, hooks, checkpoints, redaction, and the
  session log apply everywhere because they live below every surface.
- The provider layer speaks OpenAI-compatible endpoints, Anthropic's Messages API, and
  Ollama. Providers, models, prices, context windows, and reasoning are resolved from a
  catalog with per-model overrides.
- Context is managed with a budget: automatic compaction, a proactive threshold, and
  `/compact`.

### Tools and permissions

- Tools: `read_file`, `write_file`, `edit`, `apply_patch`, `glob`, `grep`, `run_command`,
  `command_output`, `command_kill`, `todo_write`, `todo_read`, `git_status`, `git_diff`,
  `git_log`, `git_commit`, `web_fetch`, `task` and its status, result, and cancel tools,
  `delegate` and its status, result, and cancel tools, `skill`, `lsp`, and `search_tools`.
- Permission modes (`plan`, `default`, `accept-edits`, `auto`, `bypass`) replace per-tool
  approval, with allow, ask, and deny rules by scope and subject: paths, commands,
  domains.
- Commands run in a sandbox: bubblewrap on Linux, Seatbelt on macOS, with the session's
  environment and no credentials unless a setting names them.
- Every change is checkpointed, so `/undo` and `/rewind` restore files without touching
  the person's own git state.

### Surfaces

- The interface is OpenTUI: a transcript, a composer, palettes, pickers, permissions, a
  status line with styles, micro mode for tiled-small terminals, screen reader mode, and
  reduced motion. The Ink interface is gone.
- Headless use: `jamcli -p`, with `text`, `json`, and `stream-json` output, `--dry-run`,
  and permission flags.
- ACP: `jamcli acp` serves the Agent Client Protocol on the official SDK, including
  permissions, session load, modes, model switching, commands, and embedded context.
- The observer serves a read-only ACP session on a user-private Unix socket so a terminal
  manager can watch the interface.
- Language servers run in the session's sandbox and report diagnostics after edits.

### Extensibility

- Commands and skills load from the user, project, and plugin layers.
- Hooks run on the agent's lifecycle events, with a trust gate for a project's own.
- Plugins are installed with consent, integrity-checked, sandboxed, and can contribute
  commands, skills, hooks, and MCP servers.
- Workflows run steps (agent, run, tool, approval, commit, workflow) with needs,
  conditions, templates, concurrency, resumes, approvals, and schedules (crontab, git
  hooks, launchd, Windows tasks).
- MCP: prompts as `/server:name`, resources as `@server:uri`, tools, elicitation, OAuth,
  and deferred loading past a threshold.

### Notes

- Configuration and history formats changed; see `migration.md`.
- The version is 2.0.0. Tagging is the owner's action.
