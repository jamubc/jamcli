## Task 1: 12.4 Documentation

**Description:** Six pages written; ten missing with broken links; two stale.

**Acceptance criteria:**
- [ ] Written and kept current: `README.md`, `getting-started.md`, `configuration.md`, `permissions.md`, `tools.md`, `feature-matrix.md`
- [ ] New pages: `providers.md`, `sessions.md`, `commands-and-skills.md`, `hooks.md`, `plugins.md`, `workflows.md`, `protocols.md` (MCP, ACP, observer, LSP), `headless.md`, `interface.md` (keys, @ and !, micro), `security.md`
- [ ] No broken links from written pages
- [ ] Updated: `conformance.md` final check, `architecture.md` describes what was built
- [ ] Facts sourced from: `jamcli --help`, `src/cli.ts` result/event JSON, `src/core/hooks/commands.ts`, `src/core/workflows/schema.ts` and `expr.ts`, `workflows.test.ts` example, `src/core/plugins/manifest.ts`, `src/core/ext/commands.ts` and `skills.ts`, `src/tui/app/keys.ts`, `src/core/providers/factory.ts`, `src/tui/observer.ts`, `src/tui/app/micro.ts`

**Verification:**
- [ ] Manual check: link checker passes, `openspec validate --all --strict` passes
- [ ] Build succeeds: `bun run build`

**Dependencies:** `16-owner-decisions.md` (for # and micro docs)

**Files likely touched:**
- `docs/providers.md`
- `docs/sessions.md`
- `docs/commands-and-skills.md`
- `docs/hooks.md`
- `docs/plugins.md`
- `docs/workflows.md` (plus protocols, headless, interface, security)

**Estimated scope:** Large: 5-8 files (split one page per task)

## Task 2: 12.5 Migration and changelog

**Description:** Release job uses `docs/CHANGELOG.md` as notes, so tags fail until it exists.

**Acceptance criteria:**
- [ ] `docs/migration.md` covers: `config migrate` for 1.x `.jamcli/mcp.json`; legacy keys (`telemetry`, `context_management`, `general`, `available_models`); v1 history load/resume; keys to keychain; modes replacing per-tool approval; `list_files` and `search_code` aliases; Ink removal
- [ ] `docs/CHANGELOG.md` exists with 2.0.0 entry (pending `16-owner-decisions.md` Task 3)

**Verification:**
- [ ] Manual check: staged release job finds the changelog

**Dependencies:** Task 1, `16-owner-decisions.md` Task 3

**Files likely touched:**
- `docs/migration.md`
- `docs/CHANGELOG.md`

**Estimated scope:** Small: 1-2 files

## Task 3: 12.6 Release build

**Description:** Binaries built once with stale checksums, Linux smoke passed. SBOM and provenance never ran.

**Acceptance criteria:**
- [ ] `bun run compile` builds all five targets here, checksums recorded fresh
- [ ] Linux x64 `--version` smoke passes
- [ ] Staged release job runs: CycloneDX SBOM, provenance, draft release

**Verification:**
- [ ] Manual check: checksums and smoke log pasted

**Dependencies:** `13-probes-lazy-loading.md` (loader flags), `15-blocked-access-hardware.md` Task 1

**Files likely touched:**
- `scripts/compile.ts`
- `openspec/changes/rehaul-jamcli/workflows/release.yml`

**Estimated scope:** Small: 1-2 files

## Task 4: 12.7 Live check plus 12.9 archive

**Description:** Live Ollama check never ran. Archive closes the unit.

**Acceptance criteria:**
- [ ] Live check done with 15 Task 4, recorded where it ran
- [ ] Archive: check finished tasks, apply spec deltas to `openspec/specs/jamcli/spec.md`, move change to archive, run `openspec validate --all --strict`
- [ ] Update `openspec/SEQUENCE.md` and `AGENTS.md` Known state
- [ ] Record in archived `tasks.md` what DEFERRED still lists

**Verification:**
- [ ] Tests pass: four gates plus `openspec validate --all --strict`
- [ ] Manual check: archive path and validation output pasted

**Dependencies:** All modules above; `16-owner-decisions.md`

**Files likely touched:**
- `openspec/specs/jamcli/spec.md`
- `openspec/SEQUENCE.md`
- `AGENTS.md`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-4
- [x] Docs complete with no broken links
  - The twelve pages are written (`docs/CHANGELOG.md`, `migration.md`, `interface.md`, `providers.md`, `hooks.md`, `commands-and-skills.md`, `sessions.md`, `plugins.md`, `workflows.md`, `protocols.md`, `headless.md`, `security.md`); `conformance.md` is brought to its final check; every relative link resolves (checked with a script over `docs/` and `README.md`).
- [ ] Release artifacts reproducible
  - Locally `bun run compile darwin-arm64` builds and `--version` prints 2.0.0 (module 13). Building all five targets needs every platform's native library (`bun install --os='*' --cpu='*'`), and the Linux x64 `--version` smoke needs Linux. The staged `release.yml` runs the SBOM, provenance, and draft release, and the CI `e2e` job compiles linux-x64 and smokes it; all of it awaits the owner's push and tag.
- [ ] Unit archived, next unit unblocked
  - The archive waits on the release steps above: apply the change's deltas to `openspec/specs/jamcli/spec.md`, move the change to the archive, run `openspec validate --all --strict`, update `SEQUENCE.md` and `AGENTS.md`'s Known state, and record in the archived `tasks.md` what DEFERRED still lists. Nothing else blocks it.

## Record (2026-09-25): what module 19 did and what it waits on
- 12.4: all ten missing pages written, plus `migration.md` and `CHANGELOG.md`; `conformance.md` updated (MCP/ACP references, the OpenAI Responses row as will-not-do, SARIF as not implemented, SemVer as implemented, SBOM/provenance as staged); `architecture.md` already described the built layers.
- 12.5: `docs/CHANGELOG.md` carries the 2.0.0 entry and `docs/migration.md` the 1.x to 2.0.0 moves, so the staged release job finds its notes.
- 12.6: awaits the owner's push and tag; see the checkpoint.
- 12.7: already run and recorded in `tasks.md` (module 15).
- 12.9: awaits the release steps; the deletion checklist for `DEFERRED.md` is verified in `22-source-provenance.md`, and the file itself is deleted at archive time.


## Source verbatim from openspec/DEFERRED.md (lines 648-703)

- **12.4 Documentation: part written.**
  - Written: `README.md`, `docs/getting-started.md`, `docs/configuration.md`,
    `docs/permissions.md`, `docs/tools.md`, and `docs/feature-matrix.md` in its final
    state.
  - Not written: `docs/providers.md`, `sessions.md`, `commands-and-skills.md`,
    `hooks.md`, `plugins.md`, `workflows.md`, `protocols.md` (MCP, ACP, the observer,
    LSP), `headless.md`, `interface.md` (keys, the composer's `@` and `!`, micro mode),
    and `security.md`. The written pages already link to these names, so those links
    are broken until the pages exist.
  - Not updated: `docs/conformance.md` needs its final check, and
    `docs/architecture.md` describes the plan, not what was built.
  - Where the facts are, so they need not be found again: every flag and subcommand in
    `jamcli --help`; the headless output in `src/cli.ts` (`resultToJson`,
    `eventToJson`); the hook protocol in `src/core/hooks/commands.ts`; the workflow
    format in `src/core/workflows/schema.ts` and `expr.ts`, with a full example in
    `src/core/workflows/__tests__/workflows.test.ts`; the plugin manifest in
    `src/core/plugins/manifest.ts`; commands in `src/core/ext/commands.ts` and skills
    in `skills.ts`; keys in `src/tui/app/keys.ts`; providers and their default
    endpoints in `src/core/providers/factory.ts`; the observer in
    `src/tui/observer.ts`; micro mode in `src/tui/app/micro.ts`.
- **12.5 `docs/migration.md` and `docs/CHANGELOG.md`: not written.** The staged release
  job uses `docs/CHANGELOG.md` as the release notes, so a tagged release fails until it
  exists. The migration page should cover:
  - `jamcli config migrate` for 1.x tool settings in `.jamcli/mcp.json`;
  - the legacy keys still read (`telemetry`, `context_management`, `general`,
    `available_models`);
  - version 1 history, which still loads and resumes;
  - keys moved out of project files into the keychain (`jamcli auth set`);
  - the permission modes that replace per-tool approval;
  - the `list_files` and `search_code` aliases;
  - the Ink interface's removal.
- **12.6 Release: built, not published.**
  - `bun run compile` built all five targets here once. Their checksums came from an
    earlier commit, so they are stale and are not recorded. The Linux x64 binary passed
    its `--version` smoke test.
  - The staged release job adds a CycloneDX SBOM, build provenance, and a draft release
    (`2dcefaf`). None of it has run.
  - The version is now 2.0.0 (`8fa95e3`), because the configuration and history
    formats changed. **Owner decision**: confirm the number. Pushing the tag is the
    owner's action.
- **12.7 The live local check: not run.** Ollama is not available in the build
  environment. With the network off and Ollama the only provider, confirm model listing,
  a tool-using turn, an edit with approval, and a command, then record where it ran.
  Check `PULL_CANDIDATES` at the same time (see above).
- **12.8 Micro status mode: built** (`a158925`), and its tests pass. **Owner decision**:
  the request asked for a `ui.micro` setting, but that needs
  `src/core/config/schema.ts`, and the acceptance says no file under `src/core/`
  changes. The override is the `JAMCLI_MICRO` environment variable (`auto`, `always`,
  `never`) instead. Either accept that, or allow the schema change and add `ui.micro`.
  Check 12.8 once decided.
- **12.9 Archive: not done.** Check the tasks that are finished. Apply the change's
  spec deltas to `openspec/specs/jamcli/spec.md`, move the change into the archive, and
  run `openspec validate --all --strict`. Update `openspec/SEQUENCE.md` and the "Known
  state" section of `AGENTS.md`. Record in the archived `tasks.md` what this note still
  lists.

