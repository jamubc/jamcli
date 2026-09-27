# Commands and skills

## Built-in commands

Type `/` in the composer; the palette lists these and what they take.

- Session: `/help`, `/choose`, `/clear`, `/resume`, `/fork`, `/rewind`, `/undo`,
  `/export`, `/note`, `/copy`, `/exit`.
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
