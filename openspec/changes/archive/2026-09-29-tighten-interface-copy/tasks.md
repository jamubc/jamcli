# Tasks

## 1. Tool lines and phase words

- [x] 1.1 Rewrite `toolLine` in `src/tui/app/format.ts` to lead with the call, then the
  diff stat as `+n −n`, the duration, and the person's decision, separated by `·`, with the
  phase mark leading. Keep the screen reader path wordy and put its state word after the
  facts. Extend `format.test.ts` with a running call and a policy decision so the marks
  path and the no-marks path are both pinned.
- [x] 1.2 Reduce `PHASE_WORDS` to one word each: `tool` to `running`, `waiting` to
  `waiting`. Update the `statusParts` and `fitStatus` expectations, including the narrow
  fit, which the shorter phase changes.
- [x] 1.3 Make `compactionLine` a fact: `compacted to fit the window · n → n tokens`, and
  `dropped, summary failed` where the summary did not return.

## 2. The composer and saved settings

- [x] 2.1 Replace the composer placeholder in `src/tui/app/App.tsx` with
  `Message JamCLI · / commands · ? help`, and `Message: Message JamCLI` in screen reader
  mode. Confirm `keysFor` is still used elsewhere in the file.
- [x] 2.2 Rewrite the three `reopen` notices in `src/commands/builtin/index.ts` so a saved
  setting reports that it applied rather than how it was carried.

## 3. Land it against the tests

- [x] 3.1 Update the 14 assertions across `app`, `prompt`, `commands`, `access`,
  `overlays`, `composer`, `extensions`, `entry`, and `exercise` tests that pin the old
  strings, keeping each test's intent: the styled paths assert the mark and the call, the
  screen reader paths assert the word.
- [x] 3.2 Regenerate the 8 frame snapshots and read the diff: confirm the styled frames are
  noun-led, the screen reader frame still names every state in a word, and the `NO_COLOR`
  frame's color assertion is untouched.
- [x] 3.3 Run the four gates: `bun install`, `npx tsc --noEmit`, `bun test`,
  `bun run build`.

## 4. Record the sequence

- [x] 4.1 Name this unit as the open one in `openspec/SEQUENCE.md`.
- [x] 4.2 Record the two interface units and `/btw` in `openspec/ROADMAP.md`, in order,
  with their sources.

## 5. Not done here, and why

- [ ] 5.1 Drive the interface on a real model through `jamcli mcp serve` in a throwaway
  fixture project and read the frames at 80x24 and 60x20. Deferred to the owner: it needs
  a live model, and the fake provider covers every frame this unit changed. Not run: the owner closed the unit on 2026-09-29 to open the review units in `openspec/ROADMAP.md`, which halt interface work, while the working tree held uncommitted interface edits a drive would have run with it.
