# Design: Surface parity, and a driver for the interface

## Layers

```
src/tui/  src/acp/  src/cli.ts (headless)  src/cli/drive.ts
        \      |          |                   /
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
| `exit()` | leave the interface | end the session: headless finishes, ACP and the driver close it |

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

A choice can be marked as the person's. `drive` uses that mark; the host never answers a
choice itself.

## Opening sessions without a terminal

In the interface, `/resume`, `/clear`, `/fork`, `/profile`, and `/rewind` replace the
session on screen. Over ACP the editor owns which session is open (`session/load`,
`session/new`), and headless is one process per session (`--resume`). The host takes an
optional way to open sessions; without one it refuses with the surface's own spelling, and
the part of the command that needs no new session (listing, forking into a new file) still
runs. Parity is reachability, not spelling.

## The driver

`jamcli drive` offers the interface to a program. The design choice is to drive the real
interface rather than a model of it: the interface is what a person uses, it already holds
every command, overlay, prompt, and key, and it is what a person's bug reports are about.

- `drive start` spawns `jamcli drive serve` detached, with its log beside its socket under
  the state directory, and waits until it listens. The server creates the runtime as the
  interface does, renders `App` with OpenTUI's headless renderer (the renderer the
  interface tests use), and listens on a Unix socket in a directory only the user can
  write, as the ACP observer does.
- Requests are one JSON object per line: `type`, `keys`, `send` (type, then Enter),
  `screen`, `state`, `wait`, `stop`. Input requests wait until the interface settles (no
  turn running, no list loading, the frame unchanged for a moment) or needs an answer, then
  return the frame and the state.
- `state` comes from the interface itself: `App` takes an optional inspector and hands it,
  after each render, the view (rows, pending approvals, status), the open list with its
  items and selection, whether the bypass confirmation is open, and the session id.
- An approval whose tool always asks, the bypass confirmation, and a choice marked as the
  person's are reported as the person's. While one waits, input is refused unless the
  request says `asPerson`. This keeps an agent from answering for the person by accident;
  it is not a security boundary, since anyone who can reach the socket is the user.
- The CLI prints the frame and a one-line summary by default, and the whole response with
  `--json`.

Driving the offscreen interface uses `@opentui/react/test-utils` outside tests. It is the
same package the interface already depends on, and its headless renderer is exactly what is
needed; the alternative, a pseudo-terminal and a terminal emulator, adds a native
dependency and parses escape codes back into a screen the renderer already has as text.

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
- Driver tests start a real server on a fake provider, send a prompt, answer an approval,
  read the screen, and are refused on a person's approval without `asPerson`.
