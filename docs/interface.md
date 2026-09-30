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
| Ctrl+O | The detailed transcript, every block open, and again to return |
| Ctrl+T | Shows or hides the plan board: the checklist, and the agents running beside the turn |
| Up, Down on an empty composer | Choose an agent on the board; Enter looks in on it, Escape lets go |
| Page Up, Page Down | Scrolls the transcript; at the top, Page Up shows earlier rows |
| Ctrl+L | Redraws the screen |
| Ctrl+C twice | Leaves |
| `?` on an empty composer | Lists the commands and keys |

Keys a prompt or a list uses (1 to 5, Up and Down, Tab, Escape, and `o` on a child's
prompt) are fixed. The rest can
be rebound in `~/.config/jamcli/keybindings.json`, which maps an action to a key or a
list: `{ "cycle_mode": "ctrl+y", "history": ["ctrl+r", "ctrl+s"] }`. The actions are
`send`, `newline`, `interrupt`, `cycle_mode`, `history`, `tool_detail`, `todos`,
`page_up`, `page_down`, `redraw`, `exit`, and `help`.

## The plan board

The board sits above the composer and appears on its own when the model writes a
checklist or starts a child agent; Ctrl+T hides and shows it. Its first line is the plan
in marks, each in the color of its state (green done, yellow running, dim waiting), and the
count. Under it, each child agent running beside the turn: its state, its agent and task,
how long it has run, its tokens and cost, and behind a rail what it is doing right now (the
call it is making, or the last line it said). Then the steps, indented, the running one with
how long it has run and its check.

Up and Down on an empty composer choose an agent; Enter, or a click on it, opens its run
in place of the conversation: what it has done so far and each further event as it happens.
While it runs, a line typed there is said to it, and it reads it with its next step, so you
can steer or question a child mid-task; `/stop` there stops it. Escape returns, and closes
this view before it answers any prompt that came up meanwhile. Once the child has ended,
`o` opens its session as the current one, to read it back or go on with it. An ended agent
stays on the board for a minute and a half, so its end is seen. A child is listed by the
title the model gave it, three to six words, or by the start of its task when it has none. A
child's permission prompt leads with that title and its agent, as in `Count the files · quick
› Allow run_command wc -l *?`, so two asking at once are told apart, and `o` on the prompt
opens that child's run with the prompt still below it to answer.

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
once, allow for the session, allow for the project, deny and let the turn go on, or deny
with feedback for the model, and shows the rule a grant would save; Escape denies and stops
the turn. It shows a command whole, wrapped, and a command or a diff longer than the rows
the transcript leaves scrolls with the wheel. A subagent's prompt is answered the same way,
and each prompt goes once it is answered. An MCP server's request for input is a form in the
same place.

## The mouse

- Drag across the transcript to select, across as many rows as you like. Releasing copies
  the selection, and the status line says how much. Dragging above or below the
  transcript keeps it scrolling, so a long reply can be selected whole. A double click
  selects a word, a triple click a line, and Ctrl+click extends the selection. The selection is drawn in the theme's selection colors and stays on its
  words when the transcript scrolls, as in a document; monochrome inverts it.
- The wheel scrolls the transcript, and in a list, the palette, or the `@` list it moves
  the highlight a row per turn; the list scrolls when the highlight reaches its edge.
- Click a row in a list, the palette, or the `@` list to choose it; pointing at one marks
  it. Click a choice in a permission prompt to answer it. The row a click would choose is
  drawn as a bar in the theme's color, in lists and in the prompt alike, so what a click
  does is plain before the click.
- Click a tool's line to show or hide that tool's output, and a thinking line to show or
  hide that thinking. These are one block at a time; Ctrl+O opens them all at once.
- Over anything a click acts on, the pointer is a hand, where the terminal draws one.
- While the terminal window is unfocused the working indicator holds still.

Copying goes to the system clipboard. Over SSH, or where there is none, it goes through
the terminal (OSC 52), which reaches the machine you sit at if the terminal supports it.
`/copy` copies whole messages the same way, and `/copy debug` copies every event of the
session's log as Markdown: each message, tool call and result, approval, notice, model and
mode change, and request with its cost, in order. It also shows what the requests carried
besides the conversation, the system prompt and every tool definition as they were sent,
recorded whenever they changed. A log written before the trust gate was removed on
2026-09-29 still shows each of its requests: the classifier, what it was sent and what it
answered, and every result's verdict. Every event carries its time in UTC, and each turn end
how long the turn took. `/export` and `jamcli sessions export` write the same Markdown
without what only debugging needs: the model's reasoning, the requests' system prompt and
tools, and those trust-gate requests. The header counts the reasoning left out.

## Thinking

A model that thinks before it answers shows that thinking as it arrives, behind a rail
under a line that says `thinking` and counts its lines, in a window of a fixed size:
`ui.thinking_lines` tall, 3 by default, and `ui.thinking_width` wide, 72 by default and
never wider than the terminal. The window keeps that size however fast the words arrive,
so the transcript above it stays where it is. Once the reply starts, or the turn ends,
the window folds to its line, which says how many lines of thinking there were as the
window draws them. Click that line to read them, and click it again to put it away. In
screen reader mode the window does not run: the line says only that thinking is under way.

A reply is drawn as Markdown while it streams. A word that will be bold or code is drawn
so from its first character, rather than showing its markers until the closing ones
arrive; nothing on the line moves as the rest of it lands.

## The detailed transcript

The transcript is compact: a tool call is its one line, and thinking is the line it left
behind. Ctrl+O shows the detailed transcript in place of the composer, for reading the
session back: the same rows with every block open, all the thinking, every tool's output,
and the diffs. A click on a tool or thinking line hides that block there, and the
conversation's own blocks stay as they were. Up and Down scroll a line, Page Up and Page
Down a page, as far back as the conversation draws, Home and End go to the top and the
bottom, and `?` lists these keys. What only debugging needs, such as what each request
carried, is not shown there: `v` writes the whole session log, as `/copy debug` renders it,
beside the log as `<session>.debug.md` and opens it in VS Code with `code`.

Ctrl+O again, Escape, or Ctrl+C returns to the conversation, with any draft where it
was; those keys close the viewer before they stop a turn, answer a prompt, or leave. It
opens behind a permission prompt too, so the session can be read before the call is
answered, and the prompt takes its keys again once the viewer closes.

## The status line

The status line names the mode, the model, the context share, the cost and tokens, the
sandbox, the MCP server count, the language server count, and the phase. While a turn works, the phase leads the line as the working indicator:
a spinner and the phase's word. With reduced motion, or in screen reader mode, nothing
moves.

### The working indicator

The indicator runs on one clock from the moment it appears, so its motion is continuous.
The spinner breathes through a ramp of colors over each cycle, and a soft band of light
sweeps across the phase's word, rests, and comes back. By default both take their colors
from the theme, so they fit dark, light, and high contrast alike; monochrome keeps the
motion and leaves the colors to the terminal.

`/style` lists the spinners and word styles, previews each, and saves a choice for every
project. `/style <name>` picks one directly.

| Spinner | Motion |
|---------|--------|
| `pulse` (default) | a dot that swells and settles, breathing from dim to accent |
| `bloom` | a dot that opens into a star and closes again |
| `orbit` | an arc circling a point |
| `quad` | a quarter block turning through the corners of the cell |
| `classic` | braille dots |

| Words | Light |
|-------|-------|
| `glow` (default) | dim at rest, the theme's accent at the center of the band |
| `mono` | dim at rest, the terminal's foreground at the center |
| `aurora` | dim rising through blue to violet |
| `rainbow` | dim rising through a spectrum |
| `minimal` | dim, and still |

A style of your own is a JSON file named in `ui.custom_status_styles` and chosen as
`custom:<name>`. It carries `spinnerFrames`, `spinnerColors` (the ramp the spinner
breathes through), `spinnerIntervalMs`, `shimmerColors` (the words' ramp from resting to
lit), and `shimmer`. A color is hex, or a theme role: `text`, `dim`, `accent`, `warn`, or
`error`. The Ink interface's names (`subtle`, `big_classic`, `big_orbit`, `big_pulse`) and
its 16 terminal color names are still accepted.

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
