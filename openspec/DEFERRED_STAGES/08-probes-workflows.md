## Task 1: Expression prototype safety

**Description:** `lookup` must not follow inherited properties.

**Acceptance criteria:**
- [x] Test reads `inputs.constructor` and `__proto__` and asserts they do not resolve
- [x] Dropping `hasOwnProperty` turns it red

**Verification:**
- [x] Tests pass: `bun test src/core/workflows/__tests__/workflows.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/core/workflows/expr.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Engine resume gaps

**Description:** Log-before-start ordering and cancelled-step retry on resume are unproven.

**Acceptance criteria:**
- [x] Document or test that log append happens before step start; post-start append turns it red (kill-between test if feasible, else reason)
- [x] Resume after cancel retries the cancelled step; non-retry turns it red

**Verification:**
- [x] Tests pass: `bun test src/core/workflows/__tests__/engine.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/workflows/engine.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Runner permission and nesting gaps

**Description:** Asking calls with no answer, agent mode, nesting, and agent-drafted commit need tests.

**Acceptance criteria:**
- [x] Run step with no rule and no flag fails (does not auto-allow); `allow:true` turns it red
- [x] Agent step with edit in plan mode is refused; ignoring `mode` turns it red
- [x] Nested workflow beyond depth 5 is refused
- [x] `commit message: agent` drafts from session; skipping draft turns it red

**Verification:**
- [x] Tests pass: `bun test src/core/workflows/__tests__/runners.test.ts`

**Dependencies:** Task 2

**Files likely touched:**
- `src/core/workflows/runners.ts`

**Estimated scope:** Medium: 3-5 files

## Task 4: Trigger quoting and interface approval

**Description:** Cron quoting with special paths and the picker approval path need coverage.

**Acceptance criteria:**
- [x] Path with a quote produces an exact quoted `cronLine`; unquoted turns it red
- [x] `/workflows run` with picker approval has an interface test (today only empty list tested)

**Verification:**
- [x] Tests pass: `bun test src/core/workflows/__tests__/triggers.test.ts src/tui/__tests__/workflows.test.tsx`

**Dependencies:** Task 3

**Files likely touched:**
- `src/core/workflows/triggers.ts`
- `src/tui/app/workflows.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-4
- [x] Caught probes re-run: tokenize unknown char, and-as-or, cycle search, checkPath ancestors, concurrency caps, failed-need skip, running-on-resume, foreign hook overwrite, crontab replace


## Source verbatim from openspec/DEFERRED.md (lines 373-431)

### Stage 11 workflows (`9eb27d2`, `cec4b48`, `b79f4a4`)

`src/core/workflows/expr.ts`:

- **break**: accept an unknown character in `tokenize` instead of throwing.
  - **caught by**: `workflows.test.ts`, which expects `a; b` to fail.
- **break**: `and` evaluated as `or`.
  - **caught by**: the grammar test.
- **break** `lookup`: follow inherited properties (drop `hasOwnProperty`).
  - **gap**: no test reads `inputs.constructor` or `__proto__`.

`src/core/workflows/schema.ts`:

- **break**: skip the cycle search.
  - **caught by**: the load-time test.
- **break** `checkPath`: allow any step, not only ancestors.
  - **caught by**: the load-time test.
- **break**: the concurrency cap of 4.
  - **caught by**: the load-time test (9 is refused).

`src/core/workflows/engine.ts`:

- **break**: ignore `concurrency` (start every ready step).
  - **caught by**: the engine test, which expects a peak of 2.
- **break**: run a step whose need failed.
  - **caught by**: the engine test (`e` must not run).
- **break**: on resume, keep `running` steps as they are.
  - **caught by**: the resume test's cut-off run.
- **break**: append to the log after the step starts rather than before.
  - **gap**: no test kills the process between the two.
- **break**: a `cancelled` step is not retried on resume.
  - **gap**: resume after a cancel is not tested.

`src/core/workflows/runners.ts`:

- **break**: approve asking calls when nobody can answer (`allow: true`).
  - **gap**: the real-run test passes `--allow-tool run_command`, so nothing asks. Add a
    run step with no rule and expect it to fail.
- **break**: the agent step ignores `mode`.
  - **gap**: the real run's plan step makes no call; give it an edit and expect a refusal.
- **break**: nested depth unlimited.
  - **gap**: no test nests workflows.
- **break**: `commit` with `message: agent` skips drafting.
  - **gap**: only a given message is tested.

`src/core/workflows/triggers.ts`:

- **break**: overwrite a foreign git hook.
  - **caught by**: the trigger test.
- **break** `editCrontab`: keep the old line when replacing.
  - **caught by**: the trigger test, which expects two lines after two schedules.
- **break**: quote nothing in `cronLine`.
  - **caught by**: the trigger test's exact line (a path with a quote in it is a **gap**).

`src/tui/app/workflows.ts`:

- **gap, all of it**: `/workflows run` with a picker approval has no interface test; only
  the empty list is tested.

