# Commands and skills

## Built-in commands

Type `/` in the composer; the palette lists these and what they take.

- Session: `/help`, `/clear`, `/resume`, `/fork`, `/export`, `/exit`, `/copy`.
- Model and context: `/model`, `/profile`, `/context`, `/compact`, `/cost`,
  `/categories`.
- Permissions and modes: `/mode`, `/permissions`.
- Extensions: `/tools`, `/mcp`, `/hooks`, `/plugins`, `/skills`, `/commands`,
  `/workflows`.
- Project: `/commit`, `/pr`, `/diff`, `/doctor`, `/config`, `/theme`.

`/help` also lists the keys in effect. A command's output is added to the transcript as
a report, and a command that asks uses the same picker as everything else.

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
