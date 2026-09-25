# Permissions and the sandbox

Every tool call, on every surface (the interface, headless runs, ACP, workflows,
plugins, and the `!` shell), goes through one permission engine. The engine returns a
decision (allow, ask, or deny) and the rule that produced it, which the interface shows
and the log records.

## Modes

Each tool has a class. The mode says what happens to each class when no rule decides.

| Mode | read | write | execute | network | delegate |
|---|---|---|---|---|---|
| `plan` | allow | deny | deny | ask | deny |
| `default` | allow | ask | ask | ask | ask |
| `accept-edits` | allow | inside the project | ask | ask | ask |
| `auto` | allow | inside the project | inside the sandbox | ask | allow |
| `bypass` | allow | allow | allow | allow | allow |

- `plan` lets the model investigate and propose, and tells it so.
- `auto` is refused where no sandbox works: commands run without asking only when they
  cannot leave it.
- `bypass` needs `--dangerously-bypass-permissions` or a confirmation in the interface.
  Deny rules still apply.
- A commit or pull request asks in every mode, unless `git.allow_commit_in_bypass` is set
  and the mode is `bypass`.

Choose the starting mode with `permissions.mode`, `--permission-mode`, or
`JAMCLI_PERMISSION_MODE`, and change it in the interface with `Shift+Tab` or `/mode`.

## Rules

A rule is a tool name, optionally with a pattern in parentheses:

```json
{
  "permissions": {
    "allow": ["read_file", "edit(src/**)", "run_command(npm test *)"],
    "ask": ["run_command(git push*)"],
    "deny": ["edit(.env*)", "run_command(rm -rf *)", "github__*"]
  }
}
```

- For file tools the pattern is a glob over the path, relative to the project.
- For `run_command` the pattern matches each simple command in the line. The line is
  split at `&&`, `||`, `;`, and pipes, and every part must be allowed. When the parser
  cannot tell what a line runs (substitutions, `eval`, dynamic redirects), it asks.
- For network tools the pattern is a domain.
- The tool name may be a glob, as `github__*` for every tool of one MCP server.

Precedence:

1. A deny from any layer wins over everything.
2. Your choices for this run (flags and grants given in the prompt) come next.
3. Configured rules from the local, project, and user layers.
4. The mode's default for the tool's class.

Headless, `--allow-tool`, `--deny-tool`, `--allowed-tools`, and `--disallowed-tools` add
rules at the `flag` scope. `/permissions` in the interface lists every rule with its
source.

## The prompt

When a call asks, the interface shows the tool, its arguments, a diff for edits, and the
rule or mode that asked. The choices are: allow once; allow a pattern for the session or
for the project (written to `.jamcli/config.local.json`); or deny, optionally with
feedback the model reads. Escape denies without feedback.

## The sandbox

On Linux, commands run under bubblewrap; on macOS, under Seatbelt. On Windows there is
no sandbox yet, and the status line says the session is unsandboxed.

Inside it:

- The project and the temporary directory are writable; the rest of the file system is
  read-only. `sandbox.writable` adds directories.
- The network is off unless `sandbox.network` is true.
- Credential locations are hidden: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`,
  `~/.config/gcloud`, `~/.config/gh`, `~/.docker/config.json`, `~/.kube`, `~/.netrc`,
  `~/.npmrc`, and the Docker and 1Password agent sockets. `sandbox.hidden` adds more.
- The environment is scrubbed of provider keys and other secrets (`sandbox.env:
  scrubbed`), or reduced to a minimal set (`minimal`). `sandbox.env_passthrough` names
  variables to keep.

The same sandbox wraps hooks, MCP servers started for plugins, plugin hooks, and
language servers. `jamcli doctor` reports whether the sandbox works here.

## Checkpoints

Before a change, JamCLI records the files it will touch in its own store, apart from
your git index and stash. `/undo` restores the last change, `/rewind` (or Escape twice)
restores the conversation and files to an earlier turn, and `/diff` shows what the
session changed.

## Screening tool output

Tool output is screened for prompt injection before the model reads it (`trust`
settings). Anything removed is named with the reason, so you can see what the model did
not.
