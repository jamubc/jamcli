## Task 1: Long output truncation for ! commands

**Description:** `CoreAgent.shell` truncates via `this.truncate`. No test runs a long-output command.

**Acceptance criteria:**
- [x] Test runs `!` command with output over the limit and asserts truncation note plus bounded length
- [x] `this.truncate(result.output)` to `result.output` turns the test red

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/turns.test.ts`
- [x] Manual check: probe without truncate fails

**Dependencies:** None

**Files likely touched:**
- `src/core/agent.ts`
- `src/core/runtime/__tests__/turns.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Cancel a running ! command

**Description:** A stopped `!` command must not report `ok`.

**Acceptance criteria:**
- [x] Test cancels a running `!` command and asserts cancelled status, not `ok`
- [x] `signal.aborted` to `false` turns the test red

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/turns.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/agent.ts`
- `src/core/runtime/__tests__/turns.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Hooks and checkpoints see ! commands

**Description:** `pre_tool` hooks must see `!` commands, and file-editing `!` commands must take checkpoints for `/rewind`.

**Acceptance criteria:**
- [x] Deny hook on `run_command` stops a `!` command; dropping `hooks` from `executeBatch` turns it red
- [x] `/rewind` after a `!` command that edits a file restores it; dropping `beforeChange`/`afterChange` turns it red

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/turns.test.ts src/core/git/__tests__/checkpoints.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/core/agent.ts`
- `src/core/runtime/__tests__/turns.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 4: ! with no provider and no @ expansion

**Description:** `!` must work with no provider and must run shell text literally.

**Acceptance criteria:**
- [x] Test runs `!` in a session with no provider and asserts it still works
- [x] `!cat @a.txt` runs as typed (no reference expansion); expanding it turns the test red
- [x] Lone `!` does not run an empty command (guard in `submit`)

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/turns.test.ts src/tui/__tests__/composer.test.tsx`

**Dependencies:** Tasks 1-3

**Files likely touched:**
- `src/core/runtime/index.ts`
- `src/tui/app/App.tsx`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-4
- [x] Already-caught probes re-run green: `executeBatch` bypass, denied-as-ok, missing user message, `!cmd` to model
- [x] New gap tests fail without fix


## Source verbatim from openspec/DEFERRED.md (lines 139-174)

### Composer `!` shell (`9087d23`)

`src/core/agent.ts` (`CoreAgent.shell`):

- **break**: call the tool without `executeBatch`, going straight to `dispatcher.execute`,
  so permissions are skipped.
  - **caught by**: `turns.test.ts` "a command typed after !", which denies and checks the
    file was not made.
- **break** `status === 'denied' ? finish('refused', ...)` → always `ok`.
  - **caught by**: the same test. This one probe has run: it is the example above.
- **break**: record no user message, so the model never sees the output.
  - **caught by**: the same test, whose next turn looks for the output.
- **break** `this.truncate(result.output)` → `result.output`.
  - **gap**: no test runs a command with long output.
- **break** `signal.aborted` → `false`, so a stopped command reports `ok`.
  - **gap**: no test cancels a running `!` command.
- **break**: drop `hooks` from the `executeBatch` options, so `pre_tool` hooks do not see
  `!` commands.
  - **gap**: no hook test uses `!`. A deny hook on `run_command` must stop it.
- **break**: drop `beforeChange` and `afterChange`, so no checkpoint is taken.
  - **gap**: `/rewind` after a `!` command that edits a file is not tested.

`src/core/runtime/index.ts` (`run`, `turn.shell`):

- **break** `!provider && !turn.shell` → `!provider`.
  - **gap**: no test runs `!` in a session with no provider, which should still work.
- **break**: expand references for shell input.
  - **gap**: `!cat @a.txt` should run as typed, and is not tested.

`src/tui/app/App.tsx` (`submit`):

- **break** `text.slice(1).trim()` guard, so a lone `!` runs an empty command.
  - **gap**.
- **break**: send `!cmd` to the model instead.
  - **caught by**: `composer.test.tsx`, which checks the model was not called.

