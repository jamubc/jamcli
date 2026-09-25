## Task 1: Priority and stale error gaps

**Description:** Approval-plus-error priority and stale error suppression are untested.

**Acceptance criteria:**
- [x] State holding both approval and error shows `need input`; error-first turns it red
- [x] Error from an earlier turn does not show after `lastUser` slice; dropping the slice turns it red

**Verification:**
- [x] Tests pass: `bun test src/tui/__tests__/micro.test.tsx`

**Dependencies:** None

**Files likely touched:**
- `src/tui/app/micro.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Unknown setting value

**Description:** Unknown `JAMCLI_MICRO` value handling needs a test on current behavior. Owner ruling on `ui.micro` is tracked separately and must not block this probe.

**Acceptance criteria:**
- [x] Unknown value falls back to `auto` per current code, asserted in test
- [x] Treating unknown as `always` turns it red
- [x] If `16-owner-decisions.md` later allows `ui.micro`, add a follow-up test then; this task closes without it

**Verification:**
- [x] Tests pass: `bun test src/tui/__tests__/micro.test.tsx`

**Dependencies:** Task 1 only (explicitly not blocked on 16; see `16-owner-decisions.md` Task 2 for the separate ruling)

**Files likely touched:**
- `src/tui/app/micro.ts`

**Estimated scope:** Small: 1 file

## Checkpoint: After Tasks 1-2
- [x] Caught probes re-run: `isMicro` boundary, `fitPhrase` word choice, forced reducedMotion, visible-not-unmount
  - Note: the forced `reducedMotion` probe is an equivalent mutant for what the frame can show. In micro mode the full view is mounted but not visible, so its animation cannot reach the captured frame; the flag still stops the hidden animation work. See the module 09 entry in the run ledger. The other three are caught.


## Source verbatim from openspec/DEFERRED.md (lines 432-453)

### 12.8 Micro status mode (`a158925`)

`src/tui/app/micro.ts`:

- **break** `isMicro`: `<` instead of `<=` for `MICRO_ROWS` or `MICRO_COLUMNS`.
  - **caught by**: `micro.test.tsx`, which checks 80 by 10, 40 by 30, and 41 by 11.
- **break** `microPhrase`: check `error` before `need input`.
  - **gap**: no test holds an approval and an error notice at once.
- **break**: drop the `lastUser` slice, so an error from an earlier turn still shows.
  - **gap**.
- **break** `fitPhrase`: return the first word instead of `words[key]`.
  - **caught by**: `micro.test.tsx`, which expects `input` at width 6.
- **break** `microSetting`: treat an unknown value as `always`.
  - **gap**.

`src/tui/app/App.tsx`:

- **break**: keep a timer running in micro mode (drop the forced `reducedMotion`).
  - **caught by**: `micro.test.tsx`'s two identical captures over an idle interval.
- **break**: unmount the full view instead of `visible={!micro}`.
  - **caught by**: `micro.test.tsx`, which restores the size and expects the state intact.

