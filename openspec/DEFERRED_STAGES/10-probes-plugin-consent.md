## Task 1: Consent digest gaps

**Description:** planted-lockfile test fails on directory check first, hiding digest bugs.

**Acceptance criteria:**
- [ ] Case with `dir` inside `pluginsDir()` but no consent record fails on digest comparison
- [ ] Editing lockfile permissions after consent is detected; leaving `permissions` out of digest turns it red

**Verification:**
- [ ] Tests pass: `bun test src/core/plugins/__tests__/plugins.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/core/plugins/lock.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Forget and mode gaps

**Description:** Re-plant after remove and consent file mode need proof.

**Acceptance criteria:**
- [ ] Remove then plant same name requires fresh consent; no-op `forgetConsent` turns it red
- [ ] Consent file mode is `0600`; writing without mode turns it red

**Verification:**
- [ ] Tests pass: `bun test src/core/plugins/__tests__/lock.test.ts src/core/plugins/__tests__/plugins.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/plugins/lock.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-2
- [ ] Caught probe re-run: `insidePluginsDir` skip still red when broken


## Source verbatim from openspec/DEFERRED.md (lines 454-470)

### Plugin consent outside the project (`8f78615`)

`src/core/plugins/lock.ts`:

- **break** `trustProblem`: skip the `insidePluginsDir` check.
  - **caught by**: `plugins.test.ts`, the planted-lockfile test (the planted entry points
    inside the repository).
- **break** `trustProblem`: skip the consent digest comparison.
  - **gap**: the planted test fails on the directory check first. Add a case whose `dir`
    is inside `pluginsDir()` but that has no consent record.
- **break** `consentDigest`: leave `permissions` out of the digest.
  - **gap**: no test edits a lockfile's permissions after consent.
- **break** `forgetConsent`: do nothing.
  - **gap**: no test removes and then plants the same name.
- **break** `recordConsent`: write without `mode: 0o600`.
  - **gap**: no test checks the file's mode.

