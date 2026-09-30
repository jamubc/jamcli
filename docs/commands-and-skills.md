# Commands and skills

## Built-in commands

Type `/` in the composer; the palette lists these and what they take.

- Session: `/help`, `/choose`, `/clear`, `/resume`, `/fork`, `/rewind`, `/undo`,
  `/export`, `/note`, `/report`, `/rename`, `/color`, `/flag`, `/wake`, `/copy`, `/exit`.
- Model and context: `/setup`, `/model`, `/effort`, `/profile`, `/context`, `/compact`,
  `/cost`, `/agents`, `/reflect`.
- Permissions and modes: `/mode`, `/permissions`.
- Extensions: `/tools`, `/mcp`, `/hooks`, `/plugins`, `/skills`, `/commands`,
  `/workflows`.
- Project: `/commit`, `/pr`, `/diff`, `/doctor`, `/config`, `/theme`, `/style`.

`/help` also lists the keys in effect. A command's output is added to the transcript as
a report, and a command that asks uses the same picker as everything else.

Every one of these runs on every surface, from the one definition in `src/commands/`:
the interface, `jamcli -p "/<command>"` (see `headless.md`), and a prompt over ACP (see
`protocols.md`). Where there is no screen, a command's list is printed with a key per
choice and answered with `/choose <key or number>`, or `/choose none` to close it; headless
takes the answers in advance with `--choose`. What only a screen does, such as repainting
in a new theme, happens where there is one, and the rest of the command, such as saving
the theme, happens everywhere. Opening another session is the surface's own: `/resume`
in the interface, `--resume` headlessly, and the editor's session list over ACP. Bypass
mode is entered only in the interface or from its flag.

`/note <text>` plants a tester's flag at this point of the session: it shows above the
conversation with a yellow flag and the time, the session log keeps it as a `note` event,
and `/export` and `/copy debug` mark it **HUMAN TESTER**. Past three, the flags fold into
one row: the mouse wheel over it moves through them, newest first, and hovering shows the
one in view whole. `/notes` lists them all, and `/notes clear` hides the flags on screen;
the log keeps them. The model sees a note only through `/reflect`, which first asks how to
read the notes (feature ideas, concerns about the model, bugs in JamCLI, your own words, or
leave them out) and then lists them to the reflection under that framing, each citable.

`/report [message]` writes `.jamcli/reports/<session>-<time>.md`: every note with its
time, the model, the effort, the context usage at that moment, the cost, the message, and,
when you choose it, the session as Markdown with its log file's path.

`/rename <name>` names the session, one word unique in the project; the header shows it,
and `/resume <name>` and `jamcli --resume <name>` take it where they take the id. `/color
<name>` draws the composer's border in red, orange, yellow, green, cyan, blue, purple, or
pink and tints the status line with it, to tell sessions apart; `/color default` returns
to the theme's. Both are recorded in the log, so a resumed session keeps them.

`/wake` (also `/timer`) runs a prompt in this session later: `/wake in 10m <prompt>` once
the time has passed, or `/wake when <session...> raise <flag>: <prompt>` once every named
session, by id or name, has raised that flag. A message you send meanwhile does not cancel
it; `/wake cancel <id|all>` does, and `/wake list` shows what is pending. The model has the
same through the `wake` tool, so asked to do something later it sets a wake rather than
waiting. `/flag <name>` raises a flag on this session, `/flag lower <name>` lowers it, and
`/flag list <session...>` shows sessions' flags; the model has the `flag` tool. Flags live
in the state directory, one file per session, and stay raised after the session closes. A
wake goes off in the interface behind any running turn; headless waits for its pending wakes
before it exits; over ACP and from the MCP server it runs as a turn of the session. A
resumed session sets again the wakes still ahead and reports the timers it missed.

A session id, or a name, in a prompt is highlighted in the transcript, and the model is told
where that session's log is, how many notes it holds, and which flags it has raised. On
macOS, `caffeinate` keeps the machine from idle sleep while a turn runs or a wake is pending.

## Custom commands

A command is a markdown file under `.jamcli/commands/` (the project) or the user
configuration directory's `commands/`. The file's front matter names what the palette
shows; the body is the prompt it sends.

```markdown
---
description: Review a file for bugs
argument-hint: <file>
allowed-tools: read_file
model: ollama:qwen2.5-coder:14b
---
Review $1 for bugs. Focus on the diff since main.
```

- `$1` to `$9` are the words typed after the name; `$ARGUMENTS` is all of them. If the
  body names none and arguments were typed, they are appended as a new paragraph.
- `allowed-tools` narrows the turn to those rules; `model` runs that turn on another
  model. `argument-hint` is what the palette shows.
- A project command shadows a user command of the same name; both shadow nothing
  built-in.

## Skills

A skill is a directory holding `SKILL.md`, under `.jamcli/skills/` (the project) or the
user configuration directory's `skills/`. Its front matter gives `name` and
`description`; any files beside it are bundled with it.

```markdown
---
name: changelog
description: Write a changelog entry from the staged diff.
allowed-tools: read_file, git_diff
---
Read the staged diff and write the entry in the project's style.
```

The system prompt lists skill names and descriptions only. When the model loads one, the
`skill` tool returns its instructions and the bundled files; while it is active,
`allowed-tools` narrows what may run. `/skills` lists what was found, with what could not
be read.

## MCP prompts

A connected MCP server's prompts appear as `/server:name`, with their arguments in the
hint (`<required> [optional]`). Typing them fills the arguments and sends the prompt's
rendered text as the turn.
