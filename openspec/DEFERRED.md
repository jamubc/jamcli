# Deferred Probes and Unfinished Work

This file keeps two lists so they are not lost:

1. **Deferred mutation probes.** Every place where the code would have been broken on
   purpose to prove a test notices, and was not.
2. **Unfinished work.** Every task, check, or decision the `rehaul-jamcli` unit did not
   finish, with what is needed to finish it.

## Why this exists

Until task 9.2, the unit's rule was: "Each new test is shown able to fail with a mutation
probe before it counts as evidence" (`openspec/changes/rehaul-jamcli/tasks.md`). Every
task through 9.2's elicitation work was probed that way. The results are recorded in
`tasks.md`, and each probe that survived got a test.

On 2026-09-25 the owner changed the rule: finish the features first, and write down every
probe that would have run. From that point the work is still tested, but the tests have not
been shown able to fail. Until the probes below run, treat those tests as unproven.

## How to run a probe

`scripts/probe.ts` takes a JSON list of probes:

```json
[{ "name": "denied shell reads as ok",
   "file": "src/core/agent.ts",
   "old": "return status === 'denied' ? finish('refused'",
   "new": "return false ? finish('refused'",
   "tests": ["src/core/runtime/__tests__/turns.test.ts"] }]
```

```bash
bun scripts/probe.ts probes.json
```

For each probe, the script replaces the first `old` with `new`, runs the named test files,
and restores the file. A probe is **caught** when the tests fail or hang, and a hang is
killed after `timeout` seconds (default 180). A probe **survived** when the tests still
pass. A survivor needs a new test, or a written reason why the change makes no difference
(an equivalent mutant: `tasks.md` 5.4 records one).

Keep each probe small: flip one condition, drop one call, or return early. Name the test
the probe should turn red. Every entry below marks the probes expected to survive today:
they show where a test is missing, not only where one needs proving.

---

## Part 1: deferred mutation probes

Each entry gives:

- **where**: the file and the construct;
- **break**: what to change;
- **caught by**: the test that should fail.

Entries marked **gap** are expected to survive with today's tests. Write the test first,
then run the probe.

### 9.2 MCP prompts, resources, and `@` completion (`46c4fcb`)

`src/core/runtime/references.ts` (`expandReferences`, `@server:uri`):

- **break** `if (!servers.has(match[1])) continue;` → drop it, so an unknown server name
  is read as a resource.
  - **caught by**: `mcp.test.ts` "a server's prompts and resources...".
  - **gap**: that test only checks that a notice names `@nobody:x://y`, and both paths
    produce one. Assert the exact notice, which today comes from the path resolver.
- **break**: drop `paths = paths.split(match[0]).join('')`, so a resource token is also
  resolved as a path.
  - **gap**: nothing asserts the absence of a second "could not include" notice for
    `@modern:docs://readme`. Assert that the notices are empty for a valid resource.
- **break** `fenced(redact(await resources.read(...)))` → `fenced(await resources.read(...))`.
  - **gap**: no fixture resource contains a secret. Add a resource to
    `src/testing/modernMcpServer.ts` that embeds a value from `env`, and assert that the
    sent prompt carries the redaction marker.
- **break** the `seen` set: push a duplicate block.
  - **gap**: no test references the same resource twice.
- **break**: move the `catch` so a failing read throws out of `expandReferences`.
  - **gap**: no fixture resource fails to read. Add one that throws.

`src/core/mcp/prompts.ts` (`promptArguments`, `promptHint`):

- **gap, all of them**: `promptArguments` has no unit test. It is reached only by
  `/modern:review a.ts` in `composer.test.tsx`. Write a table test, then probe:
  - `name=value` is ignored for an undeclared name, which should stay positional;
  - the last open argument takes the rest of the words, as `index === open.length - 1`;
  - quotes keep spaces (`"a b"` and `'a b'`);
  - `missing` lists required arguments only.
- **break** `promptHint`: swap `<...>` and `[...]`.
  - **caught by**: `composer.test.tsx`, which expects `<file> [focus]`.

`src/cli/run.ts` (`customCommandTurn`, the `/server:prompt` branch):

- **gap**: headless `jamcli -p "/server:prompt args"` has no test.
- **break**: the case-insensitive match; `missing.length` not throwing; the returned
  `label`.
- **break**: pass `/tmp/x` through (a path, not a prompt) when no server is configured.
  - **caught by**: the existing `/tmp` pass-through case covers custom commands only.
    Add one with an MCP server configured.

`src/services/McpManager.ts` (`listServerPrompts`, `listServerResources`,
`getServerPrompt`, `readServerResource`):

- **gap**: one failing server should not hide another server's prompts or resources.
  - **break**: let one server's error reject the whole `Promise.all`.
  - No test has two servers, one of them broken.
- **break**: `readServerResource` returning only the first content block, or dropping a
  `blob`.
  - **gap**: the fixture has one text block only.

`src/tui/app/references.ts` and the composer (`App.tsx`, `Palette.tsx`):

- **break** `referenceToken`'s `(?:^|\s)` so that `a@b` (an email) opens completion.
  - **gap**: no test types an email address.
- **break** `matchReferences`: drop the `starts` group ordering, or `byLength`.
  - **gap**: the test has one resource and no files. Add a project with `src/`,
    `src/a.ts`, and `docs/`, then assert the order.
- **break** `completeReference`: always append a space, even after a directory.
  - **gap**: completing a directory should leave the cursor inside it, and is not tested.
- **break**: Enter on an open `@` list sends instead of completing (the `referenced`
  early return in `submit`).
  - **caught by**: partly, in `composer.test.tsx`. That test uses Tab and then Enter, so
    Enter alone is **gap**.
- **break**: Escape does not close the `@` list.
  - **gap**.
- **break** `referenceCandidates`' `.catch(() => [])` on `mcpResources`: throw instead.
  - **gap**: a server whose resource listing fails should still leave file completion
    working.

`src/tui/app/custom.ts` (`slashCommandForPrompt`) and the `mcp` source in
`src/tui/app/commands.ts`:

- **break**: dispatch an `mcp` row as a built-in command.
  - **caught by**: `composer.test.tsx`, whose prompt would not reach the model.
- **break**: a prompt with a missing required argument is sent anyway.
  - **gap**: the interface path for `missing` is not tested.

### Composer `!` shell (`9087d23`)

`src/core/agent.ts` (`CoreAgent.shell`):

- **break**: call the tool without `executeBatch`, going straight to `dispatcher.execute`,
  so permissions are skipped.
  - **caught by**: `turns.test.ts` "a command typed after !", which denies and checks the
    file was not made.
- **break** `status === 'denied' ? finish('refused', ...)` → always `ok`.
  - **caught by**: the same test. This one probe has run: it is the example above.
- **break**: record no user message, so the model never sees the output.
  - **caught by**: the same test, whose next turn looks for the output.
- **break** `this.truncate(result.output)` → `result.output`.
  - **gap**: no test runs a command with long output.
- **break** `signal.aborted` → `false`, so a stopped command reports `ok`.
  - **gap**: no test cancels a running `!` command.
- **break**: drop `hooks` from the `executeBatch` options, so `pre_tool` hooks do not see
  `!` commands.
  - **gap**: no hook test uses `!`. A deny hook on `run_command` must stop it.
- **break**: drop `beforeChange` and `afterChange`, so no checkpoint is taken.
  - **gap**: `/rewind` after a `!` command that edits a file is not tested.

`src/core/runtime/index.ts` (`run`, `turn.shell`):

- **break** `!provider && !turn.shell` → `!provider`.
  - **gap**: no test runs `!` in a session with no provider, which should still work.
- **break**: expand references for shell input.
  - **gap**: `!cat @a.txt` should run as typed, and is not tested.

`src/tui/app/App.tsx` (`submit`):

- **break** `text.slice(1).trim()` guard, so a lone `!` runs an empty command.
  - **gap**.
- **break**: send `!cmd` to the model instead.
  - **caught by**: `composer.test.tsx`, which checks the model was not called.

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

## Part 2: unfinished work

Each item names the task in `openspec/changes/rehaul-jamcli/tasks.md` (or the archived
copy once the unit closes), what is missing, and what finishing it needs.

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

### Stages not finished in this unit

(Updated as the unit closes. An item leaves this list when its task is checked.)

- **9.2 tool search** for large MCP tool sets.
- **9.3** ACP on the official SDK: `session/load`, `session/set_mode`, plans, available
  commands, diffs, the editor's file system and terminals, and schema validation. Also
  moving the ACP client to the SDK.
- **9.3a** The ACP observer for a running interface.
- **9.4** The LSP client and the `lsp` tool.
- **9.5** `docs/conformance.md`.
- **Stage 10**: plugins (10.1 to 10.5).
- **Stage 11**: workflows (11.1 to 11.5).
- **Stage 12**: 12.1 to 12.9.
- **`openspec/project.md`**: the tech stack still says tsup. The build moved to
  `bun build` in 6.13.
