## Task 1: Client sync and config gaps

**Description:** `didOpen` repeat behavior, config handler, and shutdown kill need stronger fakes.

**Acceptance criteria:**
- [ ] Fake refuses second `didOpen` for same file; always-`didOpen` turns test red
- [ ] Fake waits for `workspace/configuration` answer; dropping handler turns it red
- [ ] Fake that ignores `shutdown` gets killed on `stop`; never-kill turns it red

**Verification:**
- [ ] Tests pass: `bun test src/core/lsp/__tests__/lsp.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/core/lsp/client.ts`
- `src/testing/fakeLsp.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Manager retry and post-tool handler

**Description:** Failed-start retry and post-edit diagnostics for patch and warnings need coverage.

**Acceptance criteria:**
- [ ] Server that fails once then works starts on retry; cached-failure turns it red
- [ ] Fake reports warnings; handler reports errors only (warnings skipped) proven by probe
- [ ] After `apply_patch`, changed files errors reach the model (today only `edit` tested)
- [ ] 20-line cap asserted with a long diagnostic list

**Verification:**
- [ ] Tests pass: `bun test src/core/lsp/__tests__/lsp.test.ts src/core/runtime/__tests__/index.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/lsp/manager.ts`
- `src/core/runtime/index.ts`
- `src/testing/fakeLsp.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-2
- [ ] Caught probes re-run: PATH fallback, `where` relative paths, `resolveProjectPath`, 1-based conversion, delayed diagnostics
- [ ] Smoke against pyright still passes where installed


## Source verbatim from openspec/DEFERRED.md (lines 282-321)

### 9.4 LSP (`7612e2b`)

`src/core/lsp/client.ts`:

- **break** `sync`: send `didOpen` every time.
  - **caught by**: `lsp.test.ts`, whose second diagnostics read would see the old text
    (the fake server replaces its text on `didOpen` too, so this is likely a **gap**:
    make the fake refuse a second `didOpen` for the same file).
- **break** `diagnosticsFor`: return at once without waiting for a newer report.
  - **caught by**: `lsp.test.ts`, where the fake publishes 20 ms later.
- **break**: drop the `workspace/configuration` handler.
  - **gap**: the fake asks and ignores the error. Make it wait for the answer.
- **break** `stop`: never kill a server that ignores `shutdown`.
  - **gap**: no fake ignores `shutdown`.

`src/core/lsp/manager.ts`:

- **break** `installed`: fall back to the process `PATH` when the session's has none.
  - **caught by**: `lsp.test.ts`, which expects nothing available with `PATH: ''`.
- **break**: a server that failed to start stays cached (drop the `.catch` delete).
  - **gap**: no test starts a server that fails once and then works.
- **break** `where`: show absolute paths inside the project.
  - **caught by**: `lsp.test.ts`, which expects `main.fk:1:10`.

`src/core/tools/lsp.ts`:

- **break**: drop `resolveProjectPath`, so `../outside.fk` is read.
  - **caught by**: `lsp.test.ts`.
- **break**: the 1-based to 0-based conversion.
  - **caught by**: `lsp.test.ts`, whose hover would name another word.

The runtime's post-tool handler (`src/core/runtime/index.ts`):

- **break**: report warnings as well as errors.
  - **gap**: the fake reports only errors.
- **break**: skip `apply_patch`'s files.
  - **gap**: only `edit` is tested.
- **break**: the 20-line cap.
  - **gap**.

