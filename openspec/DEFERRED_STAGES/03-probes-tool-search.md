## Task 1: select exactness and limit clamp

**Description:** `select:` must match exact names, and `limit` must clamp at 20.

**Acceptance criteria:**
- [ ] Two tools where one name is a prefix of the other; prefix match turns test red, exact match passes
- [ ] Request over 20 returns at most 20; removing `Math.min(..., 20)` turns it red

**Verification:**
- [ ] Tests pass: `bun test src/core/tools/__tests__/toolSearch.test.ts`

**Dependencies:** None

**Files likely touched:**
- `src/core/tools/toolSearch.ts`
- `src/core/tools/__tests__/toolSearch.test.ts`

**Estimated scope:** Small: 1-2 files

## Task 2: Threshold edge and built-in visibility

**Description:** The deferred-loading threshold and built-in visibility need edge tests.

**Acceptance criteria:**
- [ ] Case at exactly the threshold (`mcpServers.size` vs `searchThreshold`) distinguishes `>` from `>=`
- [ ] First request still contains `read_file` when MCP tools are deferred; hiding built-ins turns it red

**Verification:**
- [ ] Tests pass: `bun test src/core/runtime/__tests__/mcp.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/core/runtime/index.ts`
- `src/core/runtime/tools.ts`

**Estimated scope:** Small: 1-2 files

## Task 3: Mode switch and denied-tool loadability

**Description:** Loaded tools must survive a mode switch, and denied tools must not be loadable.

**Acceptance criteria:**
- [ ] Load a tool, switch mode via `reassemble`, assert tool still loaded
- [ ] Tool denied by rule is not loadable via `search_tools`; consulting `permissions.offers` is proven by probe

**Verification:**
- [ ] Tests pass: `bun test src/core/runtime/__tests__/mcp.test.ts src/core/permissions/__tests__/engine.test.ts`

**Dependencies:** Task 2

**Files likely touched:**
- `src/core/runtime/tools.ts`
- `src/core/runtime/permissions.ts`

**Estimated scope:** Medium: 3-5 files

## Checkpoint: After Tasks 1-3
- [ ] Caught probes still red when broken: name scoring, zero-score filter, `definitions.push` in `load`
- [ ] Four gates pass


## Source verbatim from openspec/DEFERRED.md (lines 175-206)

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

