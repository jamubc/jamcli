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

### 9.2 tool search

`src/core/tools/toolSearch.ts` (`searchTools`, `toolSearchTool`):

- **break**: name hits scored like description hits (`score += 3` → `score += 1`).
  - **caught by**: `toolSearch.test.ts` "words in the name rank above...", which expects
    `create_issue` before `list_issues`.
- **break**: drop `.filter((entry) => entry.score > 0)`.
  - **caught by**: the same test, where `weather` must find nothing.
- **break**: in `select:`, match by prefix instead of exact name.
  - **gap**: no test has two names where one is a prefix of the other.
- **break**: the `limit` clamp (`Math.min(..., 20)`).
  - **gap**: no test asks for more than 20.

`src/core/runtime/index.ts` (the `searching` block) and `src/core/runtime/tools.ts`
(`deferred`):

- **break** `mcpServers.size > searchThreshold` → `>=`.
  - **gap**: the test uses a threshold of 2 against 4 tools. Add a case at the threshold.
- **break**: skip `toolSet.definitions.push(...)` in `load`, so a loaded tool appears only
  after the next rebuild.
  - **caught by**: `mcp.test.ts` "past the threshold...", whose second request must carry
    `modern__echo`.
- **break**: `deferred` also hides built-in tools.
  - **gap**: the test checks MCP names only. Assert that `read_file` is still in the first
    request.
- **break**: a mode switch (`reassemble`) forgets the loaded tools.
  - **gap**: no test loads a tool and then switches the mode.
- **break**: `permissions.offers` is not consulted for a loaded tool.
  - **gap**: a tool denied by a rule must not be loadable. `search_tools` reads
    `toolSet.summaries`, which is already filtered, but no test proves it.

### 9.3 ACP on the SDK (`a0f1bff`, `7268f91`)

`src/acp/server.ts`:

- **break**: offer `bypass` in `acpModes` (`src/acp/session.ts`).
  - **caught by**: `features.test.ts`, which lists the modes.
- **break**: `setMode` refusal ignored (always `{}`).
  - **caught by**: `features.test.ts`, which expects an error for `bypass`.
- **break**: `allow_always` mapped to `{ allow: true }` without `scope: 'session'`.
  - **gap**: no test answers "allow always" and then checks that a second call does not ask.
- **break**: `reject-always` treated as allow (compare `kind` wrongly).
  - **gap**: only `reject-once` is tested.
- **break**: `ask` catch swallowing an error but allowing the call.
  - **gap**: no test makes `requestPermission` fail (client answers with an error).
- **break**: replay after the `loadSession` reply instead of before it.
  - **caught by**: `features.test.ts`, which slices the messages before the reply.
- **break** `promptText`: drop `resource_link` blocks.
  - **gap**: only an embedded resource is tested.
- **break**: send `available_commands_update` before the `session/new` reply.
  - **gap**: the test does not check the order.
- **break**: `queue` in `agent()` not awaited before the prompt reply, so the last updates
  arrive after `end_turn`.
  - **gap**: no test checks that every update precedes the reply.

`src/acp/updates.ts`:

- **break** `toolKind`: map `edit` to `other`.
  - **caught by**: `runtime.test.ts` and `observer.test.ts`, which expect `kind: 'edit'`.
- **break** `diffContent`: skip `reversePatch`, so `oldText` equals `newText`.
  - **caught by**: `features.test.ts`, which expects `oldText: 'old\n'`.
- **break**: the `OUTPUT_LIMIT` cut.
  - **gap**: no test streams a long output.
- **break** `planOf`: every status becomes `pending`.
  - **caught by**: `features.test.ts`.
- **break** `pathsOf` for `apply_patch`.
  - **gap**: no ACP test uses `apply_patch`.

`src/services/AcpClient.ts`:

- **break**: offer `fs` capabilities again in `initialize`.
  - **gap**: no test asserts the client capabilities are empty. The fake agent should
    record them in `_meta` like `envNames`.
- **break** `within`: ignore the agent exiting.
  - **gap**: no test kills the fake agent mid-prompt.
- **break**: `subprocessEnv` replaced by `process.env`.
  - **caught by**: `acpClient.test.ts` "an external agent gets no provider key...".

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

### 9.4 LSP (`7612e2b`)

`src/core/lsp/client.ts`:

- **break** `sync`: send `didOpen` every time.
  - **caught by**: `lsp.test.ts`, whose second diagnostics read would see the old text
    (the fake server replaces its text on `didOpen` too, so this is likely a **gap**:
    make the fake refuse a second `didOpen` for the same file).
- **break** `diagnosticsFor`: return at once without waiting for a newer report.
  - **caught by**: `lsp.test.ts`, where the fake publishes 20 ms later.
- **break**: drop the `workspace/configuration` handler.
  - **gap**: the fake asks and ignores the error. Make it wait for the answer.
- **break** `stop`: never kill a server that ignores `shutdown`.
  - **gap**: no fake ignores `shutdown`.

`src/core/lsp/manager.ts`:

- **break** `installed`: fall back to the process `PATH` when the session's has none.
  - **caught by**: `lsp.test.ts`, which expects nothing available with `PATH: ''`.
- **break**: a server that failed to start stays cached (drop the `.catch` delete).
  - **gap**: no test starts a server that fails once and then works.
- **break** `where`: show absolute paths inside the project.
  - **caught by**: `lsp.test.ts`, which expects `main.fk:1:10`.

`src/core/tools/lsp.ts`:

- **break**: drop `resolveProjectPath`, so `../outside.fk` is read.
  - **caught by**: `lsp.test.ts`.
- **break**: the 1-based to 0-based conversion.
  - **caught by**: `lsp.test.ts`, whose hover would name another word.

The runtime's post-tool handler (`src/core/runtime/index.ts`):

- **break**: report warnings as well as errors.
  - **gap**: the fake reports only errors.
- **break**: skip `apply_patch`'s files.
  - **gap**: only `edit` is tested.
- **break**: the 20-line cap.
  - **gap**.

### Stage 10 plugins (`36b6570`, `fdf6c9d`)

`src/core/plugins/manifest.ts`:

- **break**: drop the `..` check in `inside`.
  - **caught by**: `plugins.test.ts` "a manifest is checked...".
- **break**: skip `semver.satisfies` for `engines`.
  - **caught by**: the same test.
- **break** `widened`: ignore `filesystem`.
  - **caught by**: the same test.

`src/core/plugins/store.ts`:

- **break** `integrityOf`: hash contents without paths, so renaming a file keeps the hash.
  - **gap**: no test renames a file.
- **break**: allow symbolic links in `files`.
  - **gap**: no test installs a plugin with a link, which could point the hash at a file
    outside the plugin.
- **break**: skip consent when `before` exists, even when the permissions grow.
  - **caught by**: "a plugin from git...", which expects the widened request.
- **break** `verifyPlugins`: report but do not disable.
  - **caught by**: the same test, which expects `enabled: false`.
- **break**: install before consent (move the copy above `consent`).
  - **caught by**: "install shows every contribution...", which checks nothing is
    installed after a refusal.
- **break** `fetchSource`: keep `.git` in the copy.
  - **caught by**: the git test.

`src/core/plugins/runtime.ts` and the runtime wiring:

- **break**: `network: true` for every plugin.
  - **caught by**: the hostile test ("network blocked").
- **break**: `envFor([])` instead of the declared names.
  - **caught by**: the hostile test, which expects the declared token.
- **break**: `readOnlyProject: false` for every plugin.
  - **caught by**: the hostile test ("project blocked").
- **break**: plugin hooks subscribed through the project trust gate.
  - **gap**: the hostile test has no project hooks, so it would still pass; add a case
    with untrusted project hooks and a plugin hook that must run.
- **break**: skip `verifyPlugins` at session start.
  - **gap**: no runtime test tampers with an installed plugin before a session.
- **break**: the unsandboxed notice.
  - **gap**: the tests run where bubblewrap works.

`src/cli/plugin.ts`:

- **break**: `--yes` ignored, or consent assumed without a terminal.
  - **caught by**: the git test's last check.
- **break** `--scope`: always `user`.
  - **gap**: the command-line tests install for the user only.

### Stage 11 workflows (`9eb27d2`, `cec4b48`, `b79f4a4`)

`src/core/workflows/expr.ts`:

- **break**: accept an unknown character in `tokenize` instead of throwing.
  - **caught by**: `workflows.test.ts`, which expects `a; b` to fail.
- **break**: `and` evaluated as `or`.
  - **caught by**: the grammar test.
- **break** `lookup`: follow inherited properties (drop `hasOwnProperty`).
  - **gap**: no test reads `inputs.constructor` or `__proto__`.

`src/core/workflows/schema.ts`:

- **break**: skip the cycle search.
  - **caught by**: the load-time test.
- **break** `checkPath`: allow any step, not only ancestors.
  - **caught by**: the load-time test.
- **break**: the concurrency cap of 4.
  - **caught by**: the load-time test (9 is refused).

`src/core/workflows/engine.ts`:

- **break**: ignore `concurrency` (start every ready step).
  - **caught by**: the engine test, which expects a peak of 2.
- **break**: run a step whose need failed.
  - **caught by**: the engine test (`e` must not run).
- **break**: on resume, keep `running` steps as they are.
  - **caught by**: the resume test's cut-off run.
- **break**: append to the log after the step starts rather than before.
  - **gap**: no test kills the process between the two.
- **break**: a `cancelled` step is not retried on resume.
  - **gap**: resume after a cancel is not tested.

`src/core/workflows/runners.ts`:

- **break**: approve asking calls when nobody can answer (`allow: true`).
  - **gap**: the real-run test passes `--allow-tool run_command`, so nothing asks. Add a
    run step with no rule and expect it to fail.
- **break**: the agent step ignores `mode`.
  - **gap**: the real run's plan step makes no call; give it an edit and expect a refusal.
- **break**: nested depth unlimited.
  - **gap**: no test nests workflows.
- **break**: `commit` with `message: agent` skips drafting.
  - **gap**: only a given message is tested.

`src/core/workflows/triggers.ts`:

- **break**: overwrite a foreign git hook.
  - **caught by**: the trigger test.
- **break** `editCrontab`: keep the old line when replacing.
  - **caught by**: the trigger test, which expects two lines after two schedules.
- **break**: quote nothing in `cronLine`.
  - **caught by**: the trigger test's exact line (a path with a quote in it is a **gap**).

`src/tui/app/workflows.ts`:

- **gap, all of it**: `/workflows run` with a picker approval has no interface test; only
  the empty list is tested.

### 12.8 Micro status mode (`a158925`)

`src/tui/app/micro.ts`:

- **break** `isMicro`: `<` instead of `<=` for `MICRO_ROWS` or `MICRO_COLUMNS`.
  - **caught by**: `micro.test.tsx`, which checks 80 by 10, 40 by 30, and 41 by 11.
- **break** `microPhrase`: check `error` before `need input`.
  - **gap**: no test holds an approval and an error notice at once.
- **break**: drop the `lastUser` slice, so an error from an earlier turn still shows.
  - **gap**.
- **break** `fitPhrase`: return the first word instead of `words[key]`.
  - **caught by**: `micro.test.tsx`, which expects `input` at width 6.
- **break** `microSetting`: treat an unknown value as `always`.
  - **gap**.

`src/tui/app/App.tsx`:

- **break**: keep a timer running in micro mode (drop the forced `reducedMotion`).
  - **caught by**: `micro.test.tsx`'s two identical captures over an idle interval.
- **break**: unmount the full view instead of `visible={!micro}`.
  - **caught by**: `micro.test.tsx`, which restores the size and expects the state intact.

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

### Language servers in the sandbox (`74aa7b6`)

`src/core/lsp/manager.ts` and `src/core/runtime/index.ts`:

- **break**: pass `undefined` for `wrap` whatever the sandbox kind.
  - **gap**: `lsp.test.ts` runs the fake server without a sandbox. Add a bwrap test in
    which the fake server tries to read a hidden path, as the hostile plugin test does.
- **break**: pass the process environment instead of `envFor()`.
  - **gap**, as above.

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

### Lazy loading and the compiled binary (`e01cf10`, `9bc0c2a`)

- **break**: import `@agentclientprotocol/sdk` at the top of `src/services/AcpClient.ts`
  again.
  - **caught by**: only `bun run bench` (headless startup), which is not a test. A
    **gap**: add a test that imports `src/cli.ts` and checks the SDK module was not loaded.
- **break** `scripts/compile.ts`: leave out `--loader .scm:text`.
  - **caught by**: nothing in `bun test`. The compiled binary's `--version` smoke test in
    the staged workflows would catch a load failure. A **gap** locally.

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

### Stage 12: where each task stands

None of 12.1 to 12.9 is checked in `tasks.md`. What was done, and what is left:

- **12.1 Performance budgets: not met here.** Medians on the build machine, after
  `e01cf10` made the ACP SDK, plugin checks, and the workflow engine load only when used:

  | Measure | Now | At `5282c51` (this session's start) | Budget |
  |---|---|---|---|
  | `--version` | 22.5 ms | | 60 ms |
  | Headless startup | 168.2 ms | 176 ms | 150 ms |
  | First frame | 381.1 ms | 388 ms | 250 ms |
  | Keystroke | 7.1 ms | | 16 ms |
  | Memory | 151.9 MB | 151.6 MB | 150 MB |

  The later stages add nothing measurable, so the overage is this machine or older
  work. To finish: run the staged `performance` job (`bun run bench -- --enforce`) on a
  CI Linux runner. If it is still over, profile the first frame (OpenTUI's native load)
  and headless startup, or bring the budgets to the owner.
- **12.2 Security review: done as a review, with findings open.**
  - Fixed: the ACP client no longer offers the editor file system to other agents
    (`7268f91`); a lockfile committed to a repository can no longer load a plugin, since
    consent lives in the state directory and the copy must be JamCLI's own (`8f78615`);
    language servers run in the sandbox with the session's environment (`74aa7b6`).
  - Open, highest first:
    1. **Project MCP servers have no trust gate** (predates this unit, high). A cloned
       repository's `.jamcli/mcp.json` starts its commands when JamCLI opens. Fix: gate
       them on the same digest as project hooks (`trusted-hooks.json`, `jamcli hooks
       trust`), and ask on first start in the interface.
    2. **A project workflow's agent step may set `mode: auto`**, so a repository raises
       the mode of its own steps. Fix: cap a step's mode at the session's, or require the
       workflow file to be trusted as hooks are.
    3. **An installed git hook runs whatever the workflow file says now.** Editing the
       workflow changes what the hook runs with no review. Fix: record the file's digest
       at `hook install` and refuse to run when it changed.
    4. **The observer socket** (`JAMCLI_ACP_ENDPOINT=unix:<path>`) may be placed in a
       shared directory, with a window between checking the path and binding it. Fix:
       refuse a path whose directory is writable by others, or always bind inside a 0700
       directory under the state directory.
    5. **Plugin network access is not per host** (stage 10 above).
  - The review read the diff; it was not a line-by-line audit. Many probes in Part 1
    guard security paths and are unproven until they run.
- **12.3 CI: staged, never run.** `openspec/changes/rehaul-jamcli/workflows/ci.yml` and
  `release.yml` could not be pushed (see 1.1).
  - To finish: copy them into `.github/workflows/` and fix what their first run finds.
    Windows and macOS have never run the gates.
  - Missing from the staged security job, against design D22: secret scanning,
    dependency review, and `bun audit`.
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
