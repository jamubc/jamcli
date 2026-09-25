# Sessions

A session is one conversation with its tools, permissions, checkpoints, and cost. JamCLI
records every session as JSONL under the project's `.jamcli/history/`, which it
git-ignores on first write. A session id looks like `2026-09-25-3291439b`.

## What a session records

Each event is one line: the prompts and responses, each tool call and result, approval
decisions (who allowed or denied, by which rule), checkpoints taken before changes,
usage and cost per model, compactions, and the session's start and end. Tool output in
the log is redacted like everything else.

## Resuming and branching

- `jamcli -p --continue` continues the most recent session in the project; `--resume <id>`
  continues a named one.
- In the interface, `/resume` lists sessions to open, `/fork` branches the current one,
  and `/clear` starts a new one. A resumed session keeps what it cost before.
- `jamcli sessions list` lists this project's sessions; `search <query>` finds text in
  them; `show <id>` prints one; `export <id>` writes it out; `fork <id>` branches it.

Version 1 history still loads and resumes; see `migration.md`.

## Delegated sessions

A `task` child, an ACP delegation, and a workflow step each open a session of their own,
recorded with `delegatedBy` naming the parent. A background child that outlives the turn
is still counted and recorded; `task_status`, `task_result`, and `task_cancel` collect it.

## Cost and usage

`/cost` and `--output-format json` report requests, tokens, and cost per model. A model
whose price is unknown makes the total a lower bound and is counted in
`unpriced_requests`. A session continued from a log keeps its earlier usage, priced as it
was then.

## Checkpoints

Before a change, the runtime takes a checkpoint of the working copy; `/undo` shows what a
restore would change and restores only when asked, and `/rewind` moves the session to an
earlier point. Checkpoints never touch the person's own git state: the index, HEAD,
branches, and stash are left as they were. A session outside a repository keeps
file-copy checkpoints instead.
