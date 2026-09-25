## Task 1: Unknown server notice exactness

**Description:** Prove the unknown-server guard in `expandReferences` matters by asserting the exact notice, not just that a notice names the token.

**Acceptance criteria:**
- [x] Test asserts exact notice text for `@nobody:x://y`
- [x] Dropping `if (!servers.has(match[1])) continue;` turns the test red

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/mcp.test.ts`
- [x] Build succeeds: `bun run build`
- [x] Manual check: probe JSON with the dropped guard fails

**Dependencies:** None

**Files likely touched:**
- `src/core/runtime/references.ts`
- `src/core/runtime/__tests__/mcp.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Valid resource produces no second notice

**Description:** A valid `@server:uri` must not also resolve as a path and emit a second "could not include" notice.

**Acceptance criteria:**
- [x] Test asserts notices are empty for `@modern:docs://readme`
- [x] Dropping `paths.split(match[0]).join('')` turns the test red

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/mcp.test.ts`
- [x] Manual check: probe shows the duplicate notice

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/runtime/references.ts`
- `src/core/runtime/__tests__/mcp.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Resource redaction

**Description:** Resource text must pass through `redact` like file content.

**Acceptance criteria:**
- [x] Fixture in `src/testing/modernMcpServer.ts` embeds a secret from `env`
- [x] Test asserts sent prompt carries the redaction marker, not the secret
- [x] `fenced(redact(...))` to `fenced(...)` turns the test red

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/mcp.test.ts`
- [x] Manual check: secret value absent from prompt snapshot

**Dependencies:** None

**Files likely touched:**
- `src/testing/modernMcpServer.ts`
- `src/core/runtime/references.ts`
- `src/core/runtime/__tests__/mcp.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 4: Duplicate resource dedupe and failing read

**Description:** Same resource twice must not duplicate a block. A failing read must produce a notice, not throw.

**Acceptance criteria:**
- [x] Test references the same resource twice and asserts one block
- [x] Fixture resource that throws yields a notice, and moving the `catch` to throw out turns the test red

**Verification:**
- [x] Tests pass: `bun test src/core/runtime/__tests__/mcp.test.ts`

**Dependencies:** Task 3 (shares fixture)

**Files likely touched:**
- `src/testing/modernMcpServer.ts`
- `src/core/runtime/references.ts`

**Estimated scope:** Small: 1-2 files

## Task 5: promptArguments table test

**Description:** `promptArguments` has no unit test. Write a table test covering the four deferred probes, then run them.

**Acceptance criteria:**
- [x] Table test covers: undeclared `name=value` stays positional; last open arg takes rest; quotes keep spaces; `missing` lists required only
- [x] Each of the four breaks turns the table red
- [x] `promptHint` swap of `<...>` and `[...]` turns `composer.test.tsx` red (already caught, just run)

**Verification:**
- [x] Tests pass: `bun test src/core/mcp/__tests__/prompts.test.ts src/tui/__tests__/composer.test.tsx`

**Dependencies:** None

**Files likely touched:**
- `src/core/mcp/prompts.ts`
- `src/core/mcp/__tests__/prompts.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 6: Headless /server:prompt and McpManager isolation

**Description:** Headless prompt invocation and multi-server isolation have no coverage.

**Acceptance criteria:**
- [x] Headless `jamcli -p "/server:prompt args"` tested: case-insensitive match, `missing.length` throws, `label` returned
- [x] `/tmp/x` with an MCP server configured still passes through as path
- [x] Two servers where one fails still lists the other's prompts and resources
- [x] `readServerResource` with text plus blob blocks returns all content

**Verification:**
- [x] Tests pass: `bun test src/cli/__tests__/run.test.ts src/services/__tests__/McpManager.test.ts`

**Dependencies:** Task 5

**Files likely touched:**
- `src/cli/run.ts`
- `src/services/McpManager.ts`
- `src/testing/modernMcpServer.ts`

**Estimated scope:** Medium: 3-5 files

## Task 7: TUI @ completion gaps

**Description:** Close the six TUI reference gaps: email, ordering, directory space, Enter, Escape, failed resource listing.

**Acceptance criteria:**
- [x] Typing email `a@b` does not open completion
- [x] Project with `src/`, `src/a.ts`, `docs/` asserts starts-group then length order
- [x] Completing a directory leaves cursor inside (no trailing space); file completion appends space
- [x] Enter on open list completes (not sends); Escape closes
- [x] Failed `mcpResources` listing still leaves file completion working
- [x] `slashCommandForPrompt` missing-arg path tested (prompt not sent)

**Verification:**
- [x] Tests pass: `bun test src/tui/__tests__/composer.test.tsx`
- [x] Manual check: each break listed in DEFERRED flips the matching test

**Dependencies:** Tasks 1-6

**Files likely touched:**
- `src/tui/app/references.ts`
- `src/tui/app/App.tsx`
- `src/tui/app/Palette.tsx`
- `src/tui/app/custom.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-7
- [x] All tests pass
- [x] Probe file runs: `bun scripts/probe.ts` with one entry per break above
- [x] Review with human before proceeding to shell probes


## Source verbatim from openspec/DEFERRED.md (lines 60-138)

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

