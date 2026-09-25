## Task 1: Sandbox wrap and env for language servers

**Description:** `lsp.test.ts` runs the fake server without a sandbox, so wrap and env regressions would pass silently.

**Acceptance criteria:**
- [x] Bwrap test where fake server tries to read a hidden path fails when wrapped; `wrap: undefined` turns it red
- [x] Same test asserts server sees `envFor()` not `process.env`; whole-env turns it red
- [x] Follows the hostile plugin test pattern for hidden paths

**Verification:**
- [x] Tests pass: `bun test src/core/lsp/__tests__/lsp.test.ts`
- [x] Skipped with reason when bubblewrap is absent

**Dependencies:** `06-probes-lsp.md` Task 1 (shares fake)

**Files likely touched:**
- `src/core/lsp/manager.ts`
- `src/core/runtime/index.ts`
- `src/testing/fakeLsp.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Task 1
- [x] Four gates pass
- [x] Escape suite pattern reused, not duplicated


## Source verbatim from openspec/DEFERRED.md (lines 471-480)

### Language servers in the sandbox (`74aa7b6`)

`src/core/lsp/manager.ts` and `src/core/runtime/index.ts`:

- **break**: pass `undefined` for `wrap` whatever the sandbox kind.
  - **gap**: `lsp.test.ts` runs the fake server without a sandbox. Add a bwrap test in
    which the fake server tries to read a hidden path, as the hostile plugin test does.
- **break**: pass the process environment instead of `envFor()`.
  - **gap**, as above.

