# Workflows

A workflow is a YAML or JSON file under `.jamcli/workflows/`. It runs steps with
dependencies, conditions, and approvals, on the command line or on a schedule.

## A full example

```yaml
name: fix
inputs:
  issue: { type: string, required: true }
  dry: { type: boolean, default: false }
concurrency: 2
steps:
  - id: plan
    agent: { mode: plan, prompt: "Plan a fix for {{ inputs.issue }}" }
  - id: check
    needs: [plan]
    run: bun test
  - id: read
    needs: [plan]
    tool: { name: read_file, arguments: { path: notes.txt } }
  - id: gate
    needs: [check, read]
    when: "steps.check.status == 'ok'"
    approval: { message: "Check said {{ steps.check.output }}. Commit?" }
  - id: save
    needs: [gate]
    commit: { message: agent, paths: [notes.txt] }
```

## The schema

- `name`, `inputs` (`type` string, number, or boolean; `required`; `default`),
  `concurrency` (1 to 4, default 1), and `steps`.
- A step has `id`, optional `needs`, optional `when`, optional `continue_on_error`, and
  exactly one kind:
  - `agent: { prompt, model?, category?, mode?, allowed_tools? }` runs a turn. A
    `category` resolves through the category chain like delegation; a `mode` may be
    lower than the session's, never higher.
  - `run: <command>` runs a command under the same permissions as a shell turn.
  - `tool: { name, arguments }` runs one tool call.
  - `approval: { message }` waits for a person.
  - `commit: { message, paths? }` commits; `message: agent` drafts one from the session.
  - `workflow: { name, inputs? }` runs another workflow, at most five deep.
- Loading checks ids, needs, cycles, that conditions parse, that templates name only an
  input or the status or output of a step the step needs, and that each step has one kind.

## Conditions and templates

Conditions read paths, literals, comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`), `and`,
`or`, `not`, and parentheses. They are parsed, never evaluated as code, and only own
properties resolve: `inputs.constructor` is null. Templates use
`{{ inputs.name }}` and `{{ steps.id.output }}` or `{{ steps.id.status }}`.

## Running

```
jamcli workflow list
jamcli workflow run <name> [--input name=value]... [--allow-tool <tool>]... [--headless]
jamcli workflow resume <run-id>
jamcli workflow approve <run-id> <step> [--reject]
```

A run's log is `.jamcli/workflows/runs/<run-id>.jsonl`; each step is written as running
before it starts, so a run stopped anywhere resumes at its first unfinished step. A step
cut off while running, or cancelled, runs again on resume. A step whose need failed is
failed in turn unless it sets `continue_on_error`. In the interface, `/workflows` lists
and runs them, and answers a waiting approval in a picker.

## Scheduling

```
jamcli workflow schedule <name> --cron "<m h dom mon dow>"
jamcli workflow unschedule <name> | schedules
jamcli workflow hook install <git-hook> <name> | hook remove <git-hook>
```

- On Linux a schedule is a crontab line, replaced in place; a foreign git hook is left
  alone, and a JamCLI one runs the workflow headless and fails the git command when the
  run fails.
- On macOS a schedule is a launchd agent; on Windows a scheduled task. macOS takes single
  numbers per field and Windows daily or weekly times: `triggers.ts` refuses what it
  cannot express, and ranges and steps stay crontab-only.
- An installed git hook runs whatever the workflow file says at the time; recording the
  file's digest at install and refusing a changed one is a known gap.
