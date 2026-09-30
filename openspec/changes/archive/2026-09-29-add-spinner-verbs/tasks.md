# Tasks

## 1. Words on a word style

- [x] 1.1 Add the phases a pool may name to `src/types/config.ts` and `words` to a custom definition; carry `words` from a text style into the built style in `src/styles/statusStyles.ts`, read it from a custom file keeping only the three phases and non-empty lists of words, and add the builtin `whimsy` (glow with a pool for each phase). Verify with a unit test that a custom file's `words` survive resolution, that `retrying`, `compacting`, empty lists, and non-strings are dropped, and that `whimsy` resolves with its pools.
- [x] 1.2 Name `words` in the custom file's description in `src/core/config/schema.ts`, regenerate `docs/config.schema.json` with `bun run config-schema`, and document `words` and `whimsy` in `docs/interface.md`; verify with the docs check and the schema test.

## 2. The indicator shows the word

- [x] 2.1 Add a pure `phaseWord` to `src/tui/app/format.ts` and pick in `src/tui/app/App.tsx` once per phase change from a count of phase changes, passing the word to the indicator and measuring the status line's room on it. Verify in `src/tui/app/__tests__/indicator.test.tsx` that a style's word is shown while thinking and another phase's while a tool runs, that it holds across frames, that screen reader mode still says thinking, and that a long word leaves the status line on one row at a narrow width, a check that fails when the room is measured on the phase word.

## 3. Close

- [x] 3.1 Choose `whimsy` with `/style whimsy` in the interface on `opencode-go:deepseek-v4.1-flash` in a throwaway fixture through `jamcli mcp serve`'s `terminal_*` tools, send a prompt that thinks and runs a tool, and keep the recording; done when it shows a pooled word for each phase and `/style glow` returns the plain words. Done: the indicator read `pondering` while the model thought and `churning` while `sleep 4` ran, and after `/style glow` it read `thinking`.
- [x] 3.2 Run the four gates and `openspec validate add-spinner-verbs --strict`, record the unit in `openspec/SEQUENCE.md` and `openspec/ROADMAP.md`, and archive the change.
