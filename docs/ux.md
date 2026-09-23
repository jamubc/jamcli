# Interface design

The design brief for the OpenTUI interface built in stage 6 of `rehaul-jamcli`. The
frames below are prototypes: they fix the information and its order, not the exact
glyphs.

## Principles

1. **Say what is happening, and why.** Every action on screen shows the tool, what it
   touches, its status, and, when it was allowed or refused, the rule that decided.
2. **Consent is fast when it is safe.** The second identical prompt should not happen:
   every approval offers a pattern to remember.
3. **The keyboard is enough.** Every action has a key. The mouse is a convenience.
4. **No surprises.** Nothing is written, run, committed, or sent that was not shown first
   or allowed by a rule the user can see.
5. **Readable without color, sound, or sight.** Every state has a symbol and a word. A
   screen reader mode renders a linear, labeled transcript.
6. **The screen belongs to the work.** Chrome is one header line and one status line.

## Layout

```
 jamcli · ~/code/shop · main · "fix checkout rounding"                       ⌥ 3 sessions
 ─────────────────────────────────────────────────────────────────────────────────────────
 you  the checkout total is off by a cent for some carts, find out why and fix it

 ● I'll look at how totals are computed.

   ⏺ grep "total" in src/**/*.ts                                      ✓ 41 matches · 90ms
   ⏺ read_file src/cart/total.ts (1-120)                              ✓ 120 lines · 4ms

 ● Line 37 sums rounded line items instead of rounding the sum. That loses a cent when
   several items round down. I'll round once at the end.

   ⏺ edit src/cart/total.ts                                                  ✓ +3 −4
     │ 35   const subtotal = items.reduce(
     │ 36 −   (sum, item) => sum + round(item.price * item.qty), 0);
     │ 36 +   (sum, item) => sum + item.price * item.qty, 0);
     │ 37 +  return round(subtotal);
   ⏺ run_command npm test -- cart                     ✗ exit 1 · 3.2s · sandboxed (bwrap)
     │ FAIL src/cart/total.test.ts > rounds each line
     │ Expected 10.02, received 10.03                              ctrl+o full output

 ─────────────────────────────────────────────────────────────────────────────────────────
 > the old test encoded the bug, update it to expect 10.03|
 ─────────────────────────────────────────────────────────────────────────────────────────
 ⏵⏵ accept-edits · ollama:qwen3-coder · ctx 18% · $0.00 · sandbox bwrap · mcp 2/2 · lsp ts
```

**Transcript row types:**

| Row | Shows |
|---|---|
| user | the message |
| assistant | Markdown, with highlighted code |
| tool block | icon, tool, argument summary, status, metrics |
| detail | a diff for edits, the output tail for commands, match counts for searches |
| notice | retries, compaction, trust gate removals, hook failures |

Tool blocks collapse to one line when finished. Ctrl+O toggles full detail.

**Status line**, left to right:

1. the permission mode, colored and named;
2. `provider:model`;
3. context in use;
4. session cost ("unpriced" when unknown);
5. sandbox kind (or `unsandboxed`, in warning color);
6. MCP servers connected over configured;
7. language servers.

The owner's status indicator styles (shimmer, spinners, and custom styles) animate the
mode segment while a turn runs, unless reduced motion is on.

## Permission prompt

The prompt replaces the composer while a decision is pending. The transcript stays
visible above it.

```
 ─────────────────────────────────────────────────────────────────────────────────────────
 ? run_command  npm install left-pad                               asked by: default mode
   cwd ~/code/shop · sandboxed (bwrap) · network: needs access, currently blocked

   1  Allow once
   2  Allow "npm install*" for this session
   3  Allow "npm install*" for this project        (writes .jamcli/config.local.json)
   4  Deny and tell jamcli what to do instead
                                                            ↑↓ choose · enter · esc deny
```

- For edits, the preview is the diff. For MCP tools, it is the arguments as JSON.
- The "asked by" line names the mode or the rule and its scope.
- A command that needs network access in the sandbox says so before it fails.
- Choosing 4 opens a one-line feedback field. The model receives the feedback and the
  turn continues.
- Escape denies without feedback and returns control to the user.

## Command palette

Typing `/` opens a filtered list. Entries show their source.

```
 /com
   /commit        Commit staged changes with a drafted message                built-in
   /compact       Summarize older turns to free context                       built-in
   /component     Scaffold a React component                           project command
```

## Keys

Keys are rebindable in `~/.config/jamcli/keybindings.json`. The help overlay shows the
current bindings.

| Key | Action |
|---|---|
| Enter | send |
| Shift+Enter, Ctrl+J | newline |
| Escape | interrupt the turn, or close an overlay |
| Escape Escape | rewind menu |
| Shift+Tab | next permission mode |
| Ctrl+R | search prompt history |
| Ctrl+O | toggle tool detail |
| Ctrl+T | todo panel |
| Ctrl+L | redraw |
| Ctrl+C twice | exit |
| `?` on an empty composer | help overlay |
| `@` | file and resource completion |
| `/` | command palette |
| `!` at the start | run a shell command through the permission engine |

## Screen reader mode

`--screen-reader` or `ui.screen_reader` renders the same session as labeled lines, with
no box drawing, no animation, and no in-place updates:

```
You: the checkout total is off by a cent for some carts, find out why and fix it
JamCLI: I'll look at how totals are computed.
Tool grep started: pattern "total", files src/**/*.ts.
Tool grep finished: 41 matches.
Tool edit needs approval: edit src/cart/total.ts, 3 lines added, 4 removed. Asked by default mode.
Choices: 1 allow once, 2 allow for session, 3 allow for project, 4 deny with feedback.
```

## Without color

With `NO_COLOR`, the frames are unchanged apart from color. Every status is already
carried by a symbol and a word:

| State | Symbol and word |
|---|---|
| succeeded | ✓ |
| failed | ✗ with the exit code |
| waiting | ? |
| running | … |

The mode segment is spelled out. The high-contrast theme uses the same symbols.

## First run

```
 Welcome to JamCLI.

 Ollama is running at localhost:11434 with 4 models. These support tool calling:
   1  qwen3-coder:30b    32K context
   2  llama3.2:3b        128K context   (small; fine for quick questions)
 No cloud provider keys found in the environment (checked OPENROUTER_API_KEY,
 ANTHROPIC_API_KEY, OPENAI_API_KEY).

 Choose a model [1]:
 Permission mode [default]: default asks before edits and commands. accept-edits allows
 edits inside this project. auto also runs commands, sandboxed with no network (bwrap found).
 Saved to ~/.config/jamcli/config.json. Nothing was written to this project.
```

If Ollama is not reachable and no key is found, the screen says exactly that. It gives
the two ways forward, `ollama serve` or setting a key, and does not fail silently.

## Errors

Every error has the same three parts: what happened, why, and what to do.

```
 ✗ Model request failed: ollama returned 404 "model 'qwen3-coder' not found".
   Why: the model is not pulled on this machine.
   Fix: run `ollama pull qwen3-coder`, or choose another model with /model.
```

## Snapshot coverage

Stage 6 snapshots the frame text of each state above: empty session, streaming reply,
tool blocks, diff, failing command, permission prompt, command palette, screen reader
mode, and `NO_COLOR`. A snapshot compares text, not escape codes, so a theme change does
not churn it, but a lost status word does.
