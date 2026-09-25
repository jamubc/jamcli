## Task 1: D14 # note to AGENTS.md

**Description:** Design lists `#` opens a note to `AGENTS.md`. Not built: conflicts with no-memory rule.

**Acceptance criteria:**
- [ ] Owner approves or refuses in writing
- [ ] If approved: `#text` appends to project `AGENTS.md` after confirmation diff, through `edit` path with checkpoints
- [ ] If refused: strike from D14 at archive time and record in archived `tasks.md`

**Verification:**
- [ ] Tests pass: `bun test src/tui/__tests__/composer.test.tsx` (for either path)
- [ ] Manual check: decision recorded

**Dependencies:** Owner input, blocks 19 docs (`interface.md` keys)

**Files likely touched:**
- `src/tui/app/App.tsx`
- `AGENTS.md` (project file, only if approved)

**Estimated scope:** Medium: 3-5 files

## Task 2: 12.8 micro setting

**Description:** Request asked for `ui.micro`; acceptance forbids `src/core/` changes, so `JAMCLI_MICRO` env was used instead.

**Acceptance criteria:**
- [ ] Owner accepts env override or allows schema change to add `ui.micro` (`auto`, `always`, `never`)
- [ ] If schema allowed: add to `src/core/config/schema.ts`, update docs and tests, then check 12.8
- [ ] If env kept: document in `interface.md` and close 12.8

**Verification:**
- [ ] Tests pass: `bun test src/tui/__tests__/micro.test.tsx src/core/config/__tests__/schema.test.ts`

**Dependencies:** Owner input

**Files likely touched:**
- `src/core/config/schema.ts` (only if allowed)
- `src/tui/app/micro.ts`
- `docs/interface.md` (in 19)

**Estimated scope:** Small: 1-2 files

## Task 3: 12.6 version number and tag

**Description:** Version is 2.0.0 after config and history format changes. Tag push is the owner's action.

**Acceptance criteria:**
- [ ] Owner confirms 2.0.0
- [ ] Tag push performed by owner; release job in 19 depends on it

**Verification:**
- [ ] Manual check: `package.json` version matches tag

**Dependencies:** Owner input

**Files likely touched:**
- `package.json`

**Estimated scope:** Small: 1 file

## Checkpoint: After Tasks 1-3
- [ ] No held item blocks probes; docs and release know which path to write


## Source verbatim from openspec/DEFERRED.md (lines 558-572)

### Held for an owner decision

- **D14 `#` note to `AGENTS.md`.** The design lists "`#` opens a note to `AGENTS.md`"
  for the composer.
  - It was not built, because it conflicts with the hard rule "No memory, learning, or
    self-improvement features".
  - A person-typed note is arguably not memory, since the person writes it and nothing is
    learned. But it is the exact feature other agents call "memory", so it waits for the
    owner.
  - If approved: `#text` appends `text` to the project's `AGENTS.md` after a confirmation
    showing the diff, through the `edit` path so checkpoints apply.
  - If refused: strike it from D14 at archive time.
- **D14 composer features, found late.** `@` completion and `!` were missing from stage 6
  and were built in 9.2 (above). `#` is the only D14 composer feature left.

