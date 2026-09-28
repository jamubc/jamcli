# Changelog

## Unreleased

- Plan mode has its artifacts. `plan_write` keeps the plan at `.jamcli/plan.md`, where
  you can edit it and the model reads it back; `exit_plan_mode` hands it to you for approval,
  and approval returns the session to the mode it held before plan mode. The plan-mode
  note now describes what the harness enforces and names only the tools the session
  offers.
- `ask_user` puts one question, with choices or for typed text, to you in the interface.
  Elsewhere the model is told no one can answer and states its assumption.
- A todo item may carry a `check`, what proves it done, shown under the item; the model is
  told an item is completed only after its check passed. The interface shows the list as
  a checklist above the composer as soon as the model writes one, with the plan's path;
  `Ctrl+T` hides and shows it.
- A compaction summary ends with the todo list and the plan's location, so neither is
  lost in a long session.
- Any of these is turned off with a deny rule, as any tool is; the prompt then stops
  mentioning it.
- The plan board draws each step's mark in the color of its state and indents the steps,
  and lists each child agent running beside the turn: its agent and task, how long it has
  run, its tokens and cost, and behind a rail what it is doing right now. Up and Down on
  an empty composer choose a child, Enter or a click looks in on its run as it happens,
  a line typed there is said to it and read with its next step, `/stop` there stops it, and once
  it has ended `o` opens its session to go on with it.
- `/note` plants a tester's flag: shown with a yellow flag and the time, kept in the
  session log as a `note` event, marked **HUMAN TESTER** by `/export` and `/copy debug`,
  and never sent to the model. Before, notes lived only on the screen.
- `/research <question>` runs a research pipeline: the model plans lines of inquiry, fans
  them out to the new `research` agent in the background, cross-checks, and writes a
  report in which every claim cites its source. Pipelines are Markdown files under
  `.jamcli/research/pipelines/` with `angles`, `depth`, `freshness`, `include`,
  `exclude`, `agent`, and `output`; `/research pipelines` lists them.
- A session may run five children at once, up from three, and the `task` tool's guidance
  prefers the background for a fan-out, so each child shows on the board.
- A background child asks through the parent's surface like a foreground one, and its
  prompt stays up after the parent's turn ends. Before, every call a background child
  made that needed approval was refused, so in default mode it could do no real work.
- The harness steers and verifies. A command that only reads inside the project no
  longer asks in default mode, and a read repeated on the same tree is refused with the
  earlier result's first line. The project's own gates (typecheck, lint, tests) are
  detected and run after a changing step and before a turn ends with changes; a failure
  sends the model back to it, and a completed todo is stamped with the gate that vouched
  for it. `/handoff` writes `.jamcli/handoff.md` from the log, as session end and a
  dropped compaction do, and the next session reads it with its first prompt.
- Older tool results are stubbed in stages before any summary, at a planned point short
  of the compaction trigger, so a summary has less to read and less to lose.
- Each built-in tool offers a shorter wire schema and belongs to a tier: core tools are
  offered on any window, the rest when there is room and otherwise through
  `search_tools`; the task family is offered once a task has started. An edit whose
  `find_string` is not found names the nearest lines, and a failed command leads with its
  first error line. `/cost` says how much of the prompt the provider cached.
- `jamcli sessions score <id>` scores a session from its log, with the same signals
  `/reflect` reads; `scripts/harness-search` searches prompt parts, middleware constants,
  and wire schemas against task specs and accepts a change only when a held-out split
  confirms it. `docs/harness-spec.md` specifies the harness surface.

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
