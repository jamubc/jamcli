# Proposal

## Why

The owner asked how JamCLI could have spinner verbs, as Claude Code does: a word picked
from a list while the model works, in place of the same word every time. The report of
2026-09-29 decided the design. Plain phase words stay the default. Verbs are opt-in
through a word style, the only design that meets the rule against new configuration keys.
And verbs come in a pool per phase, never one global list, so the indicator still says
whether JamCLI is thinking, writing, or running a tool.

## What Changes

- **A word style may carry words per phase.** A text style gains `words`, an optional
  list per phase for `thinking`, `streaming` (shown as writing), and `tool` (shown as
  running). A custom style's JSON file carries it beside `shimmerColors`; no configuration
  key is added. A phase with no list keeps its own word.
- **One builtin style bundles words.** `whimsy` is the default glow with a pool for each
  of the three phases, so the verbs can be chosen with `/style whimsy` and no file.
- **One pick per phase change.** When the indicator enters a phase, one word is picked
  from that phase's pool and kept until the phase changes. The pick is seeded by a count of
  phase changes, so the word does not change between frames, and a new phase moves to the
  next word in the pool.
- **What stays as it is.** `retrying` and `compacting` always show their own words.
  Screen reader mode and reduced motion draw no indicator and keep the plain phase word on
  the status line. Micro mode keeps its own phrases.
- **The width is measured on the word shown.** The status line's room is what is left
  beside the word the indicator shows, not the phase word, so a long verb shortens the rest
  of the line instead of pushing it over.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jamcli`: **UI Style Configuration** gains a word style's words per phase, when they are
  picked, which phases stay literal, and the builtin style that carries them.

## Impact

- `src/types/config.ts`: the phases a pool may name, and `words` on a custom definition.
- `src/styles/statusStyles.ts`: `words` carried from a text style into the built style,
  read from a custom file, and the builtin `whimsy`.
- `src/tui/app/format.ts`, `src/tui/app/App.tsx`: the pick, and the status line's room.
- `src/core/config/schema.ts` and the generated `docs/config.schema.json`: the custom file's
  description names `words`.
- `docs/interface.md`: the style table and the custom file's keys.
- No new dependency, no new configuration key, no change to what the core does.
