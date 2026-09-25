## Task 1: 9.3 editor file system and terminals

**Description:** ACP editor offers `fs/read_text_file`, `fs/write_text_file`, `terminal/*`. JamCLI tools still use disk and own processes.

**Acceptance criteria:**
- [ ] `ToolContext` gains optional `readText`, `writeText`, `terminal`
- [ ] Set from client capabilities in `src/acp/session.ts`
- [ ] Used in `read_file`, `edit`, `write_file`, `run_command` below the dispatcher so permissions and checkpoints still apply

**Verification:**
- [ ] Tests pass: `bun test src/acp/__tests__/ src/core/tools/__tests__/`
- [ ] Manual check: unsaved buffer read and editor terminal run proven in a live editor session

**Dependencies:** `04-probes-acp-sdk.md`

**Files likely touched:**
- `src/core/tools/dispatch.ts`
- `src/acp/session.ts`
- `src/core/tools/read.ts`
- `src/core/tools/edit.ts`
- `src/core/tools/command.ts`

**Estimated scope:** Large: 5-8 files (split by tool if needed)

## Task 2: 9.4 rest of LSP

**Description:** Delegated tasks have no server; status lacks counts; symbols, rename, code actions unused.

**Acceptance criteria:**
- [ ] Delegated task (including worktree child) gets a language server or documents why not
- [ ] Status line shows MCP and LSP counts per D14
- [ ] Workspace symbols, rename, code actions wired or recorded as gaps with reasons

**Verification:**
- [ ] Tests pass: `bun test src/core/lsp/__tests__/ src/tui/__tests__/status.test.tsx`

**Dependencies:** `06-probes-lsp.md`, `11-probes-lsp-sandbox.md`

**Files likely touched:**
- `src/core/lsp/manager.ts`
- `src/core/runtime/children.ts`
- `src/tui/app/status.ts`

**Estimated scope:** Large: 5-8 files (split per bullet)

## Task 3: Stage 10 per-host network and consent UI

**Description:** Any declared host turns the sandbox network on. Install is CLI only.

**Acceptance criteria:**
- [ ] Either land a filtering proxy or namespace resolver, or record as known limit with reason
- [ ] Interface flow to install, update, remove reuses CLI consent text; `/plugins` lists plus manages

**Verification:**
- [ ] Tests pass: `bun test src/core/plugins/__tests__/ src/tui/__tests__/plugins.test.tsx`
- [ ] Manual check: hostile net test still blocked per host if proxy lands

**Dependencies:** `07-probes-plugins.md` only. Proxy scope is decided inside this task (default: record as known limit unless owner approves proxy work here).

**Files likely touched:**
- `src/core/sandbox/bwrap.ts`
- `src/core/plugins/runtime.ts`
- `src/tui/app/plugins.ts`
- `src/cli/plugin.ts`

**Estimated scope:** Large: 5-8 files (split net vs UI)

## Task 4: Stage 11 leftovers

**Description:** Schedules are crontab-full but launchd and Windows limited; agent `category` takes first model without fallback.

**Acceptance criteria:**
- [ ] macOS single numbers and Windows daily/weekly documented as limits, or ranges/steps added
- [ ] Launchd and Windows paths run on their systems and output recorded
- [ ] Agent step `category` falls back along the chain like delegation, or records why not

**Verification:**
- [ ] Tests pass: `bun test src/core/workflows/__tests__/`
- [ ] Manual check: schedule files from each OS pasted

**Dependencies:** `08-probes-workflows.md` only. Hardware runs stay in `15-blocked-access-hardware.md` and do not block closing the code and docs here.

**Files likely touched:**
- `src/core/workflows/triggers.ts`
- `src/core/workflows/runners.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-4
- [x] Each item either implemented with surface tests or recorded as a gap with reason
- [x] Four gates pass

## Record (2026-09-25): what was implemented and what is a recorded gap
- Implemented: an agent step's `category` now resolves through `resolveRoute` like delegation, so an unconfigured provider at the head of the chain is skipped and the next servable model runs. Test: workflows.test.ts "an agent step category falls back along the chain like delegation"; probe 17a is caught.
- Implemented: the status line counts language servers beside MCP (`LSP n`, zero takes no room). The runtime exposes `lspServers`; tests: lsp.test.ts asserts it contains `probe`, format.test.ts asserts `LSP 3` and no `LSP 0`; probe 17b is caught.
- Gap, 9.3 editor file system and terminals: not implemented. It needs optional `readText`, `writeText`, and `terminal` on `ToolContext`, set from the ACP client's capabilities in `src/acp/session.ts` and used below the dispatcher so permissions and checkpoints still apply. That is 5-8 files of protocol work, and its acceptance needs a live editor session (unsaved buffer read, editor terminal run), which needs the owner's editor. Scoped for a follow-up unit rather than half-built here.
- Gap, 9.4 onwards: delegated runs deliberately get no language server (`options.parent` skips the manager) because the parent's servers own the workspace and two servers would race on diagnostics; recorded as the documentation of why not. Workspace symbols, rename, and code actions are not wired: the fake server does not exercise them and each needs its own request and result mapping; recorded as gaps with that reason.
- Known limit, stage 10 per-host network: a plugin's declared hosts still turn the sandbox network on or off as a whole. A filtering proxy or a network namespace with its own resolver is a project of its own; the plan's default is to record this as a known limit unless the owner approves the proxy work.
- Gap, stage 10 consent in the interface: `/plugins` lists only; install, update, and remove stay on the command line, which already carries the consent text. An interface flow would reuse `consentWith`; recorded as UI work for a later unit.
- Known limits, stage 11 schedules: macOS accepts single numbers only and Windows daily or weekly times only; `triggers.ts` refuses what it cannot express with clear errors ('launchd cannot express', 'daily'). Ranges and steps stay crontab-only.
- Blocked on hardware, stage 11: the launchd and Windows schedule files have not run on their systems (the same limit as 3.7); owner-provided machines are needed, tracked in `15-blocked-access-hardware.md`.


## Source verbatim from openspec/DEFERRED.md (lines 573-599)

### Stages not finished in this unit

(An item leaves this list when its task is checked.)

- **9.3, the editor's file system and terminals.** ACP lets an editor offer
  `fs/read_text_file`, `fs/write_text_file`, and `terminal/*`, so an agent reads unsaved
  buffers and runs commands in the editor's terminal. JamCLI's tools still use the disk
  and their own processes.
  - To finish: give `ToolContext` optional `readText`, `writeText`, and `terminal`
    functions, set them in `src/acp/session.ts` from the client's capabilities, and use
    them in `read_file`, `edit`, `write_file`, and `run_command`. The permission engine
    and checkpoints must still apply, so this goes below the dispatcher.
- **9.4, the rest of LSP.** A delegated task gets no language server. The status line
  does not count servers (D14 lists "MCP and LSP counts"). Workspace symbols, rename, and
  code actions are not used. (Servers now run in the session's sandbox: `74aa7b6`.)
- **Stage 10, per-host network.** A plugin's `permissions.network` lists hosts, but the
  sandbox has the network on or off; any declared host turns it on. Finishing it needs a
  filtering proxy the sandbox routes through (as Claude Code's sandbox does), or a
  network namespace with its own resolver.
- **Stage 10, consent in the interface.** Installing is on the command line only; `/plugins`
  lists. An interface flow to install, update, and remove would reuse the same consent text.
- **Stage 11, what was left out of workflows.** Schedules take single numbers on macOS
  and daily or weekly times on Windows; ranges and steps work only in crontab. Neither the
  launchd nor the Windows path has run on its system (see 3.7 for the same limit on
  macOS). An agent step's `category` takes the chain's first model and does not fall
  back along it as delegation does.

