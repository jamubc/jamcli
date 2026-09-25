## Task 1: Cap and timeout gaps

**Description:** Large responses and hanging responses have no tests.

**Acceptance criteria:**
- [x] Fixture serves over 5 MB; uncapped `readCapped` turns it red (or asserts bounded memory)
- [x] Fixture never ends; missing timeout turns it red (hang killed per probe timeout)

**Verification:**
- [x] Tests pass: `bun test src/core/tools/__tests__/webFetch.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/core/tools/webFetch.ts`
- `src/core/tools/__tests__/webFetch.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Policy end to end

**Description:** `web_fetch` as a network tool needs an engine-level test.

**Acceptance criteria:**
- [x] In `default` mode the engine asks for `web_fetch`; `policy: read` turns it red
- [x] `web_fetch(domain:...)` allow rule permits the matching call and still asks otherwise

**Verification:**
- [x] Tests pass: `bun test src/core/tools/__tests__/webFetch.test.ts src/core/runtime/__tests__/permissions.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/tools/webFetch.ts`
- `src/core/runtime/permissions.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-2
- [x] Caught probes re-run: cross-host redirect, file scheme, isText PNG, script strip


## Source verbatim from openspec/DEFERRED.md (lines 481-501)

### `web_fetch` (`bc62c1a`)

`src/core/tools/webFetch.ts`:

- **break**: follow a redirect to another host (drop the `next.host !== url.host` check).
  - **caught by**: `webFetch.test.ts` "a redirect to another host is reported".
- **break**: allow `file:` URLs.
  - **caught by**: `webFetch.test.ts` "binary content, other schemes...".
- **break** `isText`: return true for every type.
  - **caught by**: the same test (the PNG case).
- **break** `readCapped`: no cap.
  - **gap**: no test serves more than 5 MB.
- **break**: drop the timeout.
  - **gap**: no test serves a response that never ends.
- **break** `htmlToText`: keep `<script>` contents.
  - **caught by**: `webFetch.test.ts` "HTML comes back as readable text".
- **break**: change `policy: 'network'` to `'read'`.
  - **caught by**: `webFetch.test.ts` "it is a network tool". That the engine then asks
    in `default` mode, and that `web_fetch(domain:...)` allows, has no end-to-end test:
    a **gap**.

