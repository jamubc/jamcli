Small items found late. Each is one task. Attach to the module that touches the file first if work is already open there.

## Task 1: project.md still says tsup

**Description:** Build moved to `bun build` in 6.13.

**Acceptance criteria:**
- [ ] `openspec/project.md` tech stack says `bun build`, not tsup
- [ ] No other tsup references remain in openspec

**Verification:**
- [ ] Manual check: `rg -n tsup openspec` returns only historical notes

**Dependencies:** None

**Files likely touched:**
- `openspec/project.md`

**Estimated scope:** XS: 1 file

## Task 2: Default categories route to ollama:llama3

**Description:** Every category defaults to `ollama:llama3`. Without that model delegation fails, and llama3 tool calling is weak.

**Acceptance criteria:**
- [ ] Either default to the session model or document `categories` configuration with a clear error naming the real categories
- [ ] Probe: delegate with no llama3 installed, assert clear failure or fallback

**Verification:**
- [ ] Tests pass: `bun test src/core/routing/__tests__/categories.test.ts src/core/delegation/__tests__/`

**Dependencies:** None

**Files likely touched:**
- `src/core/routing/categories.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: /tools taller than terminal and mouse input

**Description:** Long reports scroll their top out of view. Mouse works but has no test.

**Acceptance criteria:**
- [ ] Long report opens at its top or pages; `/tools` first line visible without scrolling
- [ ] Mouse wheel scroll covered by a test or stays marked partial in the feature matrix with a reason

**Verification:**
- [ ] Tests pass: `bun test src/tui/__tests__/tools.test.tsx`
- [ ] Manual check: 80x24 terminal shows first tool line

**Dependencies:** None

**Files likely touched:**
- `src/tui/app/tools.ts`
- `docs/feature-matrix.md`

**Estimated scope:** Small: 1-2 files

## Task 4: web_fetch task audit and ACP title

**Description:** `web_fetch` was in D5 but not in `tasks.md` until late. Title shows only the tool name.

**Acceptance criteria:**
- [ ] Compare every D5 decision against `tasks.md` for others like it before archiving; file the diff
- [ ] `toolTitle` in `src/acp/updates.ts` includes the URL for `web_fetch`

**Verification:**
- [ ] Tests pass: `bun test src/acp/__tests__/features.test.ts src/core/tools/__tests__/webFetch.test.ts`

**Dependencies:** `12-probes-web-fetch.md`

**Files likely touched:**
- `src/acp/updates.ts`
- `openspec/changes/rehaul-jamcli/tasks.md` (audit note)

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-4
- [ ] 1.1 and 3.7 remain the only unchecked early-stage items, both tracked in `15-blocked-access-hardware.md`
- [ ] Four gates pass


## Source verbatim from openspec/DEFERRED.md (lines 704-723)

### Found late, not fixed

- **`openspec/project.md`**: the tech stack still says tsup. The build moved to
  `bun build` in 6.13.
- **Default categories** (`src/core/routing/categories.ts`) route every category to
  `ollama:llama3`. On a machine without that model, delegation fails until `categories`
  is configured, and llama3's tool calling is weak. Consider defaulting to the session's
  model.
- **`/tools` is taller than the terminal**, so its first line scrolls out of view. The
  tests now wait for the first tool line instead (`bc62c1a`). The interface should open
  a long report at its top, or page it.
- **Mouse input** is on through OpenTUI's defaults, and the transcript scrolls with the
  wheel, but no test covers it. The feature matrix marks it partial.
- **`web_fetch` had no task.** It was in design D5's tool table and the feature matrix,
  but not in `tasks.md`, so it went unbuilt until `bc62c1a`. Compare every design
  decision against `tasks.md` for others like it before archiving.
- **The ACP title for `web_fetch`** (`toolTitle` in `src/acp/updates.ts`) shows only the
  tool name. Add the URL.
- **Unchecked since earlier stages**: 1.1 (CI) and 3.7 (Seatbelt), both above.
