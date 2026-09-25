Re-run the original probes from their tasks and extend them to the new callers named below. Each item is deny-first: dropping the guard must turn a test red.

## Task 1: Permission engine new callers

**Description:** Plugin commands and hooks plus workflow `tool` steps call tools outside a turn.

**Acceptance criteria:**
- [x] Each new caller goes through `decide`, `offers`, `narrow` with deny first
- [x] Probe: bypass the engine for plugin sources only, assert red

**Verification:**
- [x] Tests pass: `bun test src/core/permissions/__tests__/engine.test.ts src/core/plugins/__tests__/ src/core/workflows/__tests__/`

**Dependencies:** `07-probes-plugins.md`, `08-probes-workflows.md`

**Files likely touched:**
- `src/core/permissions/engine.ts`
- `src/core/plugins/runtime.ts`
- `src/core/workflows/runners.ts`

**Estimated scope:** Medium: 3-5 files

## Task 2: Sandbox wrap for plugin sources

**Description:** Plugin MCP servers and hooks must run wrapped.

**Acceptance criteria:**
- [x] Probe: drop wrap for plugin sources only, assert red

**Verification:**
- [x] Tests pass: `bun test src/core/sandbox/__tests__/ src/core/plugins/__tests__/`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/sandbox/`
- `src/core/plugins/runtime.ts`

**Estimated scope:** Medium: 3-5 files

## Task 3: Redaction of new outputs

**Description:** Workflow logs, ACP updates, LSP diagnostics are new outputs since the original redaction probes.

**Acceptance criteria:**
- [x] Probe: skip `redact` on each new output, assert red per output

**Verification:**
- [x] Tests pass: `bun test src/core/__tests__/redact.test.ts src/core/workflows/__tests__/ src/acp/__tests__/ src/core/lsp/__tests__/`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/redact.ts`
- `src/core/workflows/engine.ts`
- `src/acp/updates.ts`

**Estimated scope:** Medium: 3-5 files

## Task 4: Minimal env and trust digests for plugins

**Description:** Plugin processes need the credential filter, and plugin hooks need digest consent.

**Acceptance criteria:**
- [x] Probe: pass `process.env` whole to a plugin process, assert red
- [x] Probe: accept a changed plugin hook digest, assert red

**Verification:**
- [x] Tests pass: `bun test src/core/sandbox/__tests__/env.test.ts src/core/plugins/__tests__/`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/sandbox/env.ts`
- `src/core/plugins/lock.ts`
- `src/core/hooks/commands.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-4
- [x] Original probe lists from tasks 3.x, 8.x, 10.x re-run green
- [x] New caller matrix recorded in the module that owns the caller


## Source verbatim from openspec/DEFERRED.md (lines 512-530)

### Probes to repeat once later stages land

These areas were probed in their own tasks, but the unfinished stages below add new paths
through them. Re-run their original probes, and extend them to the new callers:

- **The permission engine** (`src/core/permissions/engine.ts`, `decide`, `offers`, and
  `narrow`): plugins bring contributed commands and hooks, and workflow `tool` steps call
  tools outside a turn. Each new caller must still go deny first.
- **The sandbox wrap** (`src/core/sandbox/`): plugin MCP servers and plugin hooks must run
  wrapped. Probe: drop the wrap for plugin sources only.
- **Redaction** (`src/core/redact.ts`): workflow run logs, ACP updates, and LSP
  diagnostics are new outputs. Probe: skip `redact` on each.
- **The minimal environment** (the credential filter used by hooks and MCP): plugin
  processes must get it. Probe: pass `process.env` whole.
- **Trust digests** (`trusted-hooks.json`): plugin hooks need the same consent. Probe:
  accept a changed digest.

---

