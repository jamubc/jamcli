# Proposal

## Why

The interface's words are written as explanations to a reader rather than as labels on an
interface, and the owner named it on 2026-09-27: the copy is prose-shaped, not
interface-shaped.

Three examples, all on screen today. A finished tool reads `✓ done: read_file notes.txt,
4 ms`, which leads with the state rather than the call, so a column of tool lines reads as
a list of adverbs instead of a list of what ran. The composer's placeholder is
`Message JamCLI. Enter sends, Shift+Enter or Ctrl+J adds a line, / lists commands.`: a
keybinding manual, three facts, two of them learned once and never needed again, and the
widest single string in the empty frame, so the first thing a new person sees is help text
rather than an invitation. `/model` confirms itself with `This session was reopened, so the
change applies.`, a causal clause explaining a mechanism nobody asked about at the moment
the person only wants to know their setting took.

This is one voice applied to the wrong surface. The explanatory register that makes this
repository's comments and specs good is the register that makes its interface read as
annotated scaffolding. `docs/ux.md`, the brief this interface was built from, is already
terse and noun-led (`⏺ read_file src/cart/total.ts` with `✓ 120 lines · 4ms` at the right
margin), so this is drift from a decided design rather than an open question.

It comes first because the transcript's spacing cannot be fixed underneath it: a rhythm
cannot be set against lines that are each a full sentence of variable length. The layout,
the rail, the indentation and the tone layers are the unit after this one.

## What Changes

- **Tool lines lead with the call.** `toolLine` puts the call first, then what it cost:
  `✓ edit a.txt · +2 −1 · 1.5 s`. The state is the leading mark, not a word in front of
  the call. Screen reader mode has no marks, so there the state stays a word and moves to
  the end, after the facts it belongs to: `edit a.txt, 3 ms, denied, denied by you`.
- **Phase words are one word each.** `running tools` becomes `running`, `waiting for you`
  becomes `waiting`. The status line is a row of labels, and every other phase was already
  one word.
- **The compaction line is a fact, not a sentence.** `compacted to fit the window ·
  9,000 → 2,000 tokens` in place of `The earlier conversation was summarized to fit the
  context window: 9,000 to 2,000 tokens.`
- **The composer invites rather than instructs.** `Message JamCLI · / commands · ? help`:
  the two ways in, with `?` reaching the rest. The keys stay in the help overlay and in
  `docs/interface.md`, which already list them.
- **A saved setting says it applied.** `Applied to this session.`, `Saved. It applies to
  new sessions.`, and `Saved, but this session could not reopen with it: <error>`.

Deliberately unchanged:

- **`describeCall` in `src/core/approval.ts`.** Already noun-led (`run_command npm test`),
  and shared by the interface, ACP, MCP and headless, which is why every surface agrees on
  what a call is called.
- **Core diagnostics and errors.** `docs/ux.md` prescribes what happened, why, and what to
  do for an error, and that shape is right for a multi-line failure. The register fix is
  for one-line labels. The `so it is ignored` notices in `src/core/` stay as they are.
- **Right-aligned status, indentation, grouping, tone.** The next unit. This one moves no
  layout byte, so its snapshot diff is purely wording and can be read as wording.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jamcli`: the Terminal User Interface requirement gains what a tool line leads with and
  what the composer says when empty. No requirement is removed.

## Risks

- **Discoverability.** The composer no longer teaches `Enter` and `Shift+Enter`. `?` on an
  empty composer opens the help overlay, and the placeholder names it, so the path is one
  key rather than zero. The first-run flow and `docs/interface.md` are unchanged.
- **Test churn.** 8 frame snapshots and 14 assertions across 9 test files pin the old
  strings. That is the intended cost: the snapshots exist so a change to the words is
  visible in review.
- **Surfaces diverge in wording, not in fact.** `src/core/agent.ts` still emits the prose
  compaction notice that headless, ACP and MCP show; the interface turns that notice into a
  row and draws it with the new terse line. No single surface contradicts itself. Folding
  the two into one formatter would move interface wording into the core and is left out of
  this unit on purpose.
