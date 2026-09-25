# Tools

These are the tools the model is offered. Each has a class, and the permission mode
decides what each class does unless a rule says otherwise (see
[permissions.md](permissions.md)). `/tools` in the interface lists what this session
offers, after rules and the mode have removed any tool that is denied outright.

## Files and search

| Tool | Class | What it does |
|---|---|---|
| `read_file` | read | Numbered lines with a stable anchor per line. `offset` and `limit` in lines, 2,000 by default; long lines are cut at 2,000 characters; binary files are refused with their size. |
| `glob` | read | Paths matching a pattern, newest first, honoring `.gitignore`. |
| `grep` | read | Regular expression search: matching lines with context, files only, or counts. Uses `rg` when it is installed. |
| `write_file` | write | Creates a file. Overwriting an existing file needs `overwrite: true`. |
| `edit` | write | Literal find and replace. An ambiguous match is refused; `replace_all` replaces every match. Line endings are kept. |
| `apply_patch` | write | A unified diff across several files, checked in full before any file is written, applied all or nothing. |

Paths are resolved through symbolic links before they are checked against the project,
so a link cannot carry a write outside it. Search never stops silently: when a time or
match limit is reached, the result says how far it got.

## Commands

| Tool | Class | What it does |
|---|---|---|
| `run_command` | execute | Runs a shell command in the project, inside the sandbox when there is one. Reports the exit code, standard output, and standard error. Long output keeps its head and tail. Streams output while it runs. `background: true` returns a job id. |
| `command_output` | read | New output from a background command, and whether it is still running. |
| `command_kill` | execute | Stops a background command. |

## Git

| Tool | Class | What it does |
|---|---|---|
| `git_status`, `git_diff`, `git_log` | read | Read-only inspection. |
| `git_commit` | execute | Stages the given paths and commits. It asks every time, in every mode, showing the message and the files. Commits carry only your identity unless `git.attribution` is set. |

`/commit` drafts a message from the diff, and `/pr` pushes the branch and opens a pull
request with `gh`, both after you approve.

## Network

| Tool | Class | What it does |
|---|---|---|
| `web_fetch` | network | A URL as readable text: HTML reduced to its text, other text types as they are, binary refused. Up to 5 MB, 30 seconds. A redirect to another host is not followed; the model is told where it points and must fetch it in a new call, which rules judge for that host. |

Allow a site with a rule such as `web_fetch(domain:docs.python.org)` or
`web_fetch(domain:*.python.org)`.

## Planning and delegation

| Tool | Class | What it does |
|---|---|---|
| `todo_write`, `todo_read` | state | The session's todo list, shown with `Ctrl+T`. |
| `task` | delegate | Runs a child agent on a model chosen by category, with a narrowed policy, in the foreground or background. |
| `task_status`, `task_result`, `task_cancel` | read, delegate | For background tasks. |
| `delegate` | delegate | Hands a task to another ACP agent. |
| `delegate_status`, `delegate_result`, `delegate_cancel` | read, delegate | For delegated work. |

A child never has more permission than its parent, and delegation is bounded by
`delegation.max_depth`, `max_concurrent`, and `max_turns_per_child`.

## Extensions and protocols

| Tool | Class | What it does |
|---|---|---|
| `skill` | read | Loads an Agent Skill's instructions by name. See [commands-and-skills.md](commands-and-skills.md). |
| `lsp` | read | Diagnostics, hover, definition, references, and symbols from a language server. See [protocols.md](protocols.md). |
| `search_tools` | read | Present when MCP servers bring more tools than `tool_search.threshold`. The model searches them by name and description, and the tools it finds are offered from the next step. |
| MCP tools | from the server | Named `<server>__<tool>`, judged by the same rules. |

`list_files` and `search_code` still work as hidden aliases of `glob` and `grep`, so
rules written for 1.x keep applying.

## Calling a tool yourself

In the composer, `!git status` runs a command through `run_command` and the permission
engine, and records it in the conversation so the model can see it. Workflows use the
same path for their `run` and `tool` steps.
