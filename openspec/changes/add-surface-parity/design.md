# Design: Surface parity for commands

## Layers

```
src/tui/        src/acp/        src/cli.ts (headless)
        \          |              /
         src/commands/   registry, parsing, built-in commands, CommandHost
                |
         src/cli/<verb>.ts  operation code the CLI verbs and the commands share
                |           (runConfigCommand, runMcpCommand, runChecks, ...)
           src/core/        the harness
```

`src/commands/` sits between the harness and the surfaces. It may import `src/core/` and
the operation modules under `src/cli/`, which already take plain `io` and print nothing
themselves. It imports neither OpenTUI nor React, and nothing in `src/core/` imports it.
The interface stops importing `src/cli/`; it reaches that code only through commands.

Moving the operation modules out of `src/cli/` is not part of this change. They are already
surface-neutral, and a rename would bury the behavior change in a move.

## The command context

A command gets:

| Member | What it does | Interface | Without a terminal |
|---|---|---|---|
| `runtime`, `projectRoot`, `running`, `profile` | the session | as now | as now |
| `show(text, diff?)` | add output to the transcript | an output row | output |
| `notice(level, text)` | a notice | a notice row | output, marked |
| `event(event)`, `working(phase)` | fold a runtime event in, as a compaction's | the view | mapped per surface |
| `refresh()` | read the status facts again | status line | nothing |
| `send(prompt, options)` | run a turn | the controller | the surface's turn |
| `openSession(choice)` | replace the session | as now | refused, naming the surface's way |
| `setMode(mode)`, `confirmBypass()` | the permission mode | as now | bypass refused |
| `choose(request)` | offer a list | the overlay | listed, answered by `/choose` |
| `prefill(line, back?)` | a command line for the person to finish | the composer | shown as the line to send |
| `commands()` | every command, for `/help` | as now | as now |
| `keyFor(action)` | the key bound to an action, for help text | the bindings | none |

`dispatch` goes: every use was an output row with a diff (now `show`), a compaction's
events and phase (now `event` and `working`), or notes (now `note` and `clearNotes`).

There is one command set, and every surface offers all of it. What a command does only
where there is a terminal is a context member each surface implements:

| Member | Interface | Without a terminal |
|---|---|---|
| `setTheme(theme)`, `setStatusStyle(style)` | repaint | nothing; the command still saves the setting |
| `theme`, `statusStyle` | the ones on screen | the configured ones |
| `copy(text)` | system clipboard, else the terminal's | system clipboard, else says it could not |
| `note(text)`, `clearNotes()` | the notes panel | the host's notes, reported in its state |
| `exit()` | leave the interface | end the session: headless finishes, ACP closes it |

So `/theme`, `/style`, `/copy`, `/note`, and `/exit` are ordinary commands, not an
exception list.

## Choices without a terminal

A choice request is what the overlay shows today: a title, items with keys, labels, and
details, a note, a hint, `choose`, `dismissed`, and optional free text. `CommandHost` keeps
the one pending choice, reports it as a list with each key, and resolves it when
`/choose <key>` arrives (a number chooses by position, `/choose none` dismisses it, and a
free-text choice takes the words). Anything else sent while a choice is pending dismisses it
first. Headless is one process, so it takes the answers in advance: each `--choose <key>`
answers the next choice offered, in order, and a choice with no answer left is reported
and dismissed.

A choice can be marked as the person's; the host never takes an answer given in advance for it.

## Opening sessions without a terminal

In the interface, `/resume`, `/clear`, `/fork`, `/profile`, and `/rewind` replace the
session on screen. Over ACP the editor owns which session is open (`session/load`,
`session/new`), and headless is one process per session (`--resume`). The host takes an
optional way to open sessions; without one it refuses with the surface's own spelling, and
the part of the command that needs no new session (listing, forking into a new file) still
runs. Parity is reachability, not spelling.

## Whose answer it is

The observer's `requires_action` update carries, in `_meta.jamcli`, the waiting call's tool
and whether that tool always asks (a lesson from `/reflect`, a push). The permission engine
already knows the second; the approval request now says it. A choice request can be marked
`personOnly`, and the hooks trust question is: the host lists it, says only the person may
answer it, and never takes an answer given in advance for it. The bypass confirmation is
never entered without a screen at all.

`add-mcp-server` uses both marks to put such questions to the person by elicitation. No
agent-facing tool is built here.

## Tests

- The existing interface tests keep passing unchanged in what they assert: the move is a
  refactor.
- `src/commands/__tests__/parity.test.ts` enumerates the registry: every built-in command
  runs through `CommandHost` without throwing, is offered over ACP, and runs through
  headless. There is no exception list for it to consult.
- Host tests: `/choose` by key and number, dismissal, free text, pre-answered choices,
  refused session opening, refused bypass.
- Headless and ACP tests drive the assembled surface with the fake provider: `/compact`,
  `/resume list`, `/commit` answered with `--choose`, an ACP prompt `/context`.
- The observer reports the tool a call waits on and whether it always asks.
- The host lists a choice marked as the person's and does not answer it from `--choose`.
