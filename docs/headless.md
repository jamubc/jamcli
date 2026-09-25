# Headless use

`jamcli -p "<text>"` runs one prompt without the interface, on a fake or real provider,
and exits. Everything the interface gets, it gets: the same agent loop, tools,
permissions, hooks, checkpoints, sandbox, and session log.

```
jamcli -p "update @src/a.ts" --allow-tool edit --output-format json
jamcli -p "run the tests" --allowed-tools "run_command(bun test *)" --output-format stream-json
jamcli -p "plan the fix" --dry-run --output-format json
```

## Output

- `text` (the default): the answer on stdout, notices and denials on stderr.
- `json`: one result object as the last line.
- `stream-json`: one JSON line per event, then the result object.

The result object carries `type: "result"`, `session_id`, `status`, `response`, `error`
when there is one, `provider`, `model`, `duration_ms`, `turns`, `usage`, the cost fields
(`total_cost_usd`, `unpriced_requests`, `model_usage`), `permission_mode`, `sandbox`,
`permission_denials`, `notices`, `dry_run` in a dry run, and delegated work when any.

## Permissions

A headless run cannot ask, so a call that would ask is not made: the model is told why,
with the flag that would allow it, and the run carries on. `--allow-tool` and
`--deny-tool` allow or deny one tool for the run; `--allowed-tools` and
`--disallowed-tools` take rule text; `--permission-mode` sets the mode and
`--dangerously-bypass-permissions` bypasses asking (explicit denies still stop). Each
denial is recorded with the mode as who decided, and appears in the result.

## Dry runs

`--dry-run` makes no change: every call that would have changed something is reported
with a preview (a diff for an edit, the command for a run), and reads still run. The
result carries `dry_run`, one entry per call that was not made.

## Exit codes

`0` when the run ended `ok`; `1` for an error, a refusal, or a limit; `130` when the run
was cancelled.

## Sessions

`-p --continue` continues the project's most recent session and `-p --resume <id>` a named
one; both keep the earlier cost and can carry tool results into the next request. See
`sessions.md`.
