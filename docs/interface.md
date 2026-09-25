# The interface

`jamcli` starts the terminal interface. It is built on OpenTUI and renders one session:
the transcript, the composer, the palettes, and the status line.

## Keys

| Key | Action |
|---|---|
| Enter | Sends the message |
| Shift+Enter, Ctrl+J | Adds a line |
| Escape | Stops a running turn; closes a list or a picker |
| Shift+Tab | Changes the permission mode |
| Ctrl+R | Searches earlier messages |
| Ctrl+O | Opens or closes the last tool block |
| Ctrl+T | Shows or hides the todo list |
| Page Up, Page Down | Scrolls the transcript; at the top, Page Up shows earlier rows |
| Ctrl+L | Redraws the screen |
| Ctrl+C twice | Leaves |
| `?` on an empty composer | Lists the commands and keys |

Keys a prompt or a list uses (1 to 4, Up and Down, Tab, Escape) are fixed. The rest can
be rebound in `~/.config/jamcli/keybindings.json`, which maps an action to a key or a
list: `{ "cycle_mode": "ctrl+y", "history": ["ctrl+r", "ctrl+s"] }`. The actions are
`send`, `newline`, `interrupt`, `cycle_mode`, `history`, `tool_detail`, `todos`,
`page_up`, `page_down`, `redraw`, `exit`, and `help`.

## The composer

- `/` names a command: the built-ins, a project's or the user's custom commands, a
  skill, and an MCP server's prompt as `/server:name`. Enter runs the chosen one; the
  palette shows what each takes.
- `@` names a file, a directory, or an MCP resource (`@server:uri`). Completion is
  case-insensitive, lists what starts with the word before what contains it, leaves the
  cursor inside a completed directory, and appends a space after a file. An email address
  (`a@b`) is text, not a reference.
- `!command` runs a command under the same permissions as the model's, shows its output,
  and keeps it in the conversation for the next turn. A lone `!` is sent as text.
- `#note` appends `note` to the project's `AGENTS.md`. A confirmation shows `+ note`
  first; the append goes through the tool path (`edit`, or `write_file` for a new or
  ambiguous file), so permissions and checkpoints apply. Escape leaves the file alone.
- `@path` content and MCP resource text are redacted like tool output.

## Lists, pickers, and prompts

The command palette, the reference list, and every picker read the same way: Up and Down
move, Enter chooses, Escape closes, and typing filters. A permission prompt offers allow
once, allow for the session, reject, or reject with a reason, and shows the rule that
would be saved. An MCP server's request for input is a form in the same place.

## The status line

The status line names the mode, the model, the context share, the cost and tokens, the
sandbox, the MCP server count, the language server count, and the phase. `/style` chooses
a style; styles are described in `configuration.md`. With reduced motion, or in screen
reader mode, nothing moves.

## Micro mode

When the terminal is tiled too small to read (at most 10 rows or 40 columns), the
interface shows one static phrase instead: `need input`, `error`, `done`, `thinking`,
`editing <file>`, `reading <file>`, `running <tool>`, or `ready`. The phrase changes only
when the state does: no spinner, no timer, no wrapping. Resizing restores the full view
with its state intact.

`JAMCLI_MICRO` overrides the decision: `auto` (the default, by size), `always`, or
`never`. An unknown value means `auto`.

## Headless

`jamcli -p "..."` runs one prompt without the interface; see `headless.md` for the output
formats and flags.
