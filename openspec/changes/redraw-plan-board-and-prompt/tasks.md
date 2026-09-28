# Tasks

## 1. The board

- [x] 1.1 Draw each step as a mark and a color, the header as the plan's strip with the count and the phase, and the running step's check behind the rail; keep the worded lines for screen reader mode. Verified by the access test's board assertions and the frame snapshots.
- [x] 1.2 Keep the running step's start time in the view state and show how long it has run, ticking while it runs. Verified by the view reducer test on `since` and the board test's duration.
- [x] 1.3 Draw the board above the prompt or the composer, so it stays up while a call waits. Verified by the prompt test that finds the running step beside the prompt.
- [x] 1.4 List what runs beside the turn under the header, with its duration and its `/jobs stop`. Verified by the prompt test that finds the job line, stops it, and sees it go.

## 2. The prompt and the tool line

- [x] 2.1 Show a command once: drop the repeated command from the preview, keep its facts behind the rail, put the pattern count on the session row, name the same rule once on the project row, and color the frame by class. Verified by the updated prompt tests and frame snapshots.
- [x] 2.2 Name a granted rule on the tool line. Verified by the format test.

## 3. Gates and record

- [x] 3.1 Run the four gates: `bun install`, `npx tsc --noEmit`, `bun test`, `bun run build`.
- [ ] 3.2 Drive the interface on a real model through `jamcli mcp serve` in a throwaway fixture project and read the board and the prompt at 80x24 and 100x40. Deferred to the owner with the trial of `surface-background-work`: it needs a live model, and the fake provider covers every frame this unit changed.
- [x] 3.3 Record the unit in `openspec/SEQUENCE.md` and `openspec/ROADMAP.md`.
