## Task 1: Lazy SDK import test

**Description:** Headless startup regression is only caught by `bun run bench`, not by `bun test`.

**Acceptance criteria:**
- [ ] Test imports `src/cli.ts` and asserts the ACP SDK module was not loaded
- [ ] Top-level SDK import in `src/services/AcpClient.ts` turns it red

**Verification:**
- [ ] Tests pass: `bun test src/cli/__tests__/lazy.test.ts`
- [ ] Manual check: `bun run bench` headless startup still within budget

**Dependencies:** None

**Files likely touched:**
- `src/services/AcpClient.ts`
- `src/cli.ts`
- `src/cli/__tests__/lazy.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Compiled binary loader gap

**Description:** Missing `--loader .scm:text` in `scripts/compile.ts` is only caught by the staged release smoke test.

**Acceptance criteria:**
- [ ] Local test or documented manual step proves `.scm` text loads from the built output
- [ ] Until automated, record as local gap owned by `18-stage12-perf-security-ci.md`

**Verification:**
- [ ] Tests pass: `bun test src/cli/__tests__/lazy.test.ts`
- [ ] Manual check: `bun run compile` plus `--version` smoke on Linux binary

**Dependencies:** Task 1

**Files likely touched:**
- `scripts/compile.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-2
- [ ] Bench budgets reviewed for headless startup impact


## Source verbatim from openspec/DEFERRED.md (lines 502-511)

### Lazy loading and the compiled binary (`e01cf10`, `9bc0c2a`)

- **break**: import `@agentclientprotocol/sdk` at the top of `src/services/AcpClient.ts`
  again.
  - **caught by**: only `bun run bench` (headless startup), which is not a test. A
    **gap**: add a test that imports `src/cli.ts` and checks the SDK module was not loaded.
- **break** `scripts/compile.ts`: leave out `--loader .scm:text`.
  - **caught by**: nothing in `bun test`. The compiled binary's `--version` smoke test in
    the staged workflows would catch a load failure. A **gap** locally.

