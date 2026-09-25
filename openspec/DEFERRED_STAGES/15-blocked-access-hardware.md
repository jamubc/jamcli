## Task 1: 1.1 CI workflow landing

**Description:** Workflows cannot be pushed from the build environment. Land them by hand.

**Acceptance criteria:**
- [ ] Copy `openspec/changes/rehaul-jamcli/workflows/ci.yml` to `.github/workflows/ci.yml` (and release workflow when 12.6 runs)
- [ ] Type step prints `0 (baseline 0)` locally after Ink removal
- [ ] Until green CI, definition of done means four gates locally

**Verification:**
- [ ] Tests pass: `bun install`, `npx tsc --noEmit`, `bun test`, `bun run build`
- [ ] Manual check: first CI run findings recorded

**Dependencies:** None (unblocks 18)

**Files likely touched:**
- `.github/workflows/ci.yml`
- `openspec/changes/rehaul-jamcli/workflows/ci.yml`

**Estimated scope:** Small: 1-2 files

## Task 2: 3.7 Seatbelt live check on macOS

**Description:** Seatbelt profile is unit tested but never ran the escape suite on a Mac.

**Acceptance criteria:**
- [ ] Run `bun test src/core/sandbox` on macOS
- [ ] Record output in `tasks.md` 3.7 and check the box only then

**Verification:**
- [ ] Tests pass: `bun test src/core/sandbox` on macOS
- [ ] Manual check: output pasted, machine named

**Dependencies:** None

**Files likely touched:**
- `src/core/sandbox/__tests__/escape.test.ts`

**Estimated scope:** Small: 1 file

## Task 3: 5.2 OpenRouter sign-in live

**Description:** OAuth tested against a local fake only.

**Acceptance criteria:**
- [ ] Run `jamcli auth login openrouter` once on a networked machine
- [ ] Record success or provider error with machine and date

**Verification:**
- [ ] Manual check: key stored, no secret in logs

**Dependencies:** None

**Files likely touched:**
- `src/cli/auth.ts`

**Estimated scope:** Small: 1 file

## Task 4: Ollama candidates plus 12.7 live local check

**Description:** `PULL_CANDIDATES` from memory plus no live Ollama run. Do together.

**Acceptance criteria:**
- [ ] Check names and sizes against Ollama library
- [ ] With network off and Ollama only: model listing, tool-using turn, edit with approval, command
- [ ] Record where it ran

**Verification:**
- [ ] Manual check: transcript of the four actions, machine named

**Dependencies:** Owner provides networked Mac or Linux box with Ollama

**Files likely touched:**
- `src/tui/app/setup.ts`
- `src/core/catalog/`

**Estimated scope:** Medium: 3-5 files

## Task 5: 4.5 OpenAI Responses decision

**Description:** Adapter did not land; docs are blocked here.

**Acceptance criteria:**
- [ ] Either land the adapter with docs access, or keep the gap in `docs/feature-matrix.md` and close 4.5 as will-not-do with reason

**Verification:**
- [ ] Manual check: feature matrix row matches reality

**Dependencies:** None

**Files likely touched:**
- `docs/feature-matrix.md`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-5
- [ ] Each blocked item either done with recorded output or still blocked with owner named


## Source verbatim from openspec/DEFERRED.md (lines 536-557)

### Blocked on access or hardware

- **1.1 CI workflow.** The GitHub App used to push this work lacks the `workflows`
  permission, so nothing under `.github/workflows/` could be pushed.
  - The intended workflow is staged at `openspec/changes/rehaul-jamcli/workflows/ci.yml`,
    and its type step passes locally.
  - To finish: grant the permission, or copy the staged files into `.github/workflows/`
    by hand.
  - Until then, "green CI" in the definition of done means the four gates run locally.
- **3.7 Seatbelt live check.** The macOS sandbox is written and unit tested, but the escape
  suite has never run on a Mac.
  - To finish: run `bun test src/core/sandbox` on macOS and record the output in 3.7.
- **5.2 OpenRouter sign-in.** The OAuth flow is tested against a local fake. openrouter.ai
  is not reachable from the build environment.
  - To finish: run `jamcli auth login openrouter` once on a machine with network.
- **6.x Ollama suggestions.** `PULL_CANDIDATES` (the models onboarding offers to pull) were
  written from memory of Ollama's library. ollama.com is not reachable here.
  - To finish: check the names and sizes against the library, together with 12.7.
- **4.5 OpenAI Responses adapter.** It did not land, because OpenAI's documentation is
  blocked from the build environment. The gap is recorded in `docs/feature-matrix.md`.
  OpenAI rows in the catalog are absent for the same reason.

