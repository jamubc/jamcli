## Task 1: Socket creation race and slow client

**Description:** The umask window during listen and the slow-client drop have no tests.

**Acceptance criteria:**
- [x] Test checks mode during listen (umask path), not just after chmod; dropping `umask(0o177)` turns it red
- [x] Paused socket plus large turn output triggers drop past `SLOW_CLIENT_BYTES`; never-drop turns it red

**Verification:**
- [x] Tests pass: `bun test src/tui/__tests__/observer.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/tui/observer.ts`
- `src/tui/__tests__/observer.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Attach lifecycle and send guard

**Description:** Observer attach after session replace and watcher send failures need proof.

**Acceptance criteria:**
- [x] After `/clear`, attached observer receives only the new session after re-attach; keeping old watchers turns it red
- [x] Watcher `send` throwing does not throw into the interface; removing `try` turns it red (or document as equivalent if `send` already swallows)
- [x] `tap` ordering and coverage beyond `turn_start`/`turn_end` asserted

**Verification:**
- [x] Tests pass: `bun test src/tui/__tests__/observer.test.ts src/tui/__tests__/composer.test.tsx`

**Dependencies:** Task 1

**Files likely touched:**
- `src/tui/observer.ts`
- `src/tui/app/controller.ts`
- `src/tui/app/App.tsx`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-2
- [x] Caught probes re-run: live-socket steal, newSession/prompt refused, requires_action timeout
- [x] Kill-client-mid-turn leaves interface running with no lost output


## Source verbatim from openspec/DEFERRED.md (lines 254-281)

### 9.3a ACP observer (`8c1bade`)

`src/tui/observer.ts`:

- **break**: drop `process.umask(0o177)` and the `chmodSync`.
  - **caught by**: `observer.test.ts`, which checks the mode is 0600 (the chmod alone
    keeps it green; the umask needs a check made during listen, which is a **gap**).
- **break**: remove the live-socket probe, so a second interface steals the path.
  - **caught by**: `observer.test.ts` "...is in use by another process".
- **break** `SLOW_CLIENT_BYTES`: never drop.
  - **gap**: no test has a client that stops reading. Pause the socket and push a large
    output through a turn.
- **break**: `newSession` or `prompt` allowed.
  - **caught by**: `observer.test.ts`.
- **break**: `setState('requires_action')` removed.
  - **caught by**: `observer.test.ts`, whose need-input wait times out.
- **break**: `attach` keeps the old watchers after `/clear`.
  - **gap**: the interface test checks `attach` is called, not what an attached observer
    receives afterwards.
- **break** `event`: let a watcher's `send` throw into the interface (remove the `try`).
  - **gap**: `send` already swallows errors, so the `try` is a second guard with no test.

`src/tui/app/controller.ts` and `App.tsx`:

- **break**: call `tap` after `dispatch`, or only for some events.
  - **caught by**: partly, in `composer.test.tsx`, which checks `turn_start` and
    `turn_end` only.

