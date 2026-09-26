## 1. Decide

- [x] 1.1 Read `/Users/jam/Documents/github/jamubc/opencode-langsearch/src/index.ts` and
  record the LangSearch contract in `design.md`: endpoint, method, how the key is sent,
  request body shape, the response shape that is actually parsed, and which line ranges
  are pure logic versus host adapter. Done: see "The LangSearch port" in `design.md`.
  Findings that change the design are that LangSearch returns page text itself, so
  `web_search` fetches nothing; and that the source has no cache, no rate limiting, and no
  retry, so the `web_fetch` cache is new work rather than ported. Verified independently:
  src/index.ts is 1495 lines, the plugin import is line 5, host adapter is 1302-1495, and
  `searchLangSearch` is 498-550.
- [x] 1.2 Decide the `SearchResult` shape from what LangSearch actually returns, not from
  what a search result could have. Done: recorded in `design.md`.
- [x] 1.3 Confirm the `subjectsOf` decision in `design.md`: `web_search` maps to the
  configured provider endpoint's hostname, reusing the existing `domain:` matcher rather
  than adding a `provider:` pattern kind to the rule grammar. See "Decisions to confirm".
- [x] 1.4 Confirm the cache shape for `web_fetch`: in-process only, keyed by the URL after
  redirects, 15 minute TTL, 8 MB cap with least-recently-used eviction, never on disk. See
  "Decisions to confirm".

## 2. Build

- [x] 2.1 Create `src/core/tools/web/extract.ts`: move `htmlToText` from
  `src/core/tools/webFetch.ts:35-54`, preserve `href` as markdown links, drop `nav`,
  `footer`, and `aside`, prefer `<main>` or `<article>` as the content root when present.
  Keep it a pure function over a string. This lands first because it is the only part that
  improves the offline path.
- [x] 2.2 Create `src/core/tools/web/providers.ts`: `DEFAULT_PROVIDERS` keyed by name with
  LangSearch as its single entry, merged with user config so a user entry of the same name
  replaces the default, following `LspManager` (`src/core/lsp/manager.ts:22-91`). Resolve
  keys with `resolveApiKey` (`src/core/providers/factory.ts:36-47`) unchanged. Expose
  `available` (a key resolves) and `run`. Do not probe reachability at construction.
- [x] 2.2a Port three pure functions from
  `/Users/jam/Documents/github/jamubc/opencode-langsearch/src/index.ts` into
  `providers.ts`, adapted to jamcli's types and lint rules but not redesigned:
  `searchLangSearch` (source 498-550), `dedupeResults` with `canonicalizeUrl`, `shingles`,
  and `containment` (source 619-729), and `withDateline` (source 431-442). Run them in that
  order inside `run`, before the refine stage. Do **not** port `resolveKey`; `resolveApiKey`
  already does that job here and includes the credential store.
- [x] 2.3 Create `src/core/tools/web/refine.ts`: `refineSearch` and `refineFetch`, both
  identity, both taking `ToolContext`, with a file comment naming the intended occupant:
  the TypeSafe System One gate (`jev-latest`) in `opencode-langsearch` at
  `src/index.ts:776-1148`. Nothing else goes in this file.
- [x] 2.4 Create `src/core/tools/web/index.ts`: `WEB_FETCH_TOOL` and `WEB_SEARCH_TOOL` with
  their schemas, both `policy: 'network'`. `web_search` takes `query` plus an optional
  `freshness`, whose enum and description transfer verbatim from `FRESHNESS_PROPERTY`
  (source 470-477). The source's `createPendingStore` is not needed and is not ported: a
  jamcli builtin receives its whole input, so `freshness` passes straight through. Carry
  over `web_fetch`'s existing behavior whole: the 5 MB cap, the 30 second timeout, manual
  redirects, the cross-host redirect refusal, and the non-text refusal. Add an optional
  `prompt` argument passed to `refineFetch`. Set a real user agent. Wire the cache from
  1.4. Call the refine stage in both tools on the way out.
- [x] 2.5 Delete `src/core/tools/webFetch.ts` and
  `src/core/tools/__tests__/webFetch.test.ts`; update the import in
  `src/core/tools/builtins.ts`; move the old test's coverage to
  `src/core/tools/web/__tests__/fetch.test.ts`. The tool name `web_fetch` does not change,
  so no existing permission rule breaks.
- [x] 2.6 Add the `search` block to `src/core/config/schema.ts` (`ConfigFileSchema`,
  lines 117-245), inserted at line 144 between `lsp` and `tool_search`, and its type to
  `src/types/config.ts`, mirroring `EndpointConfig` (`src/types/config.ts:23-30`), using
  `z.strictObject(...).partial()` with `.describe()` on every field. Regenerate
  `docs/config.schema.json` through `configJsonSchema()` (`src/core/config/schema.ts:294-297`).
- [x] 2.7 Register the new key variable in `configuredSecrets` and `keyVariables`
  (`src/core/runtime/model.ts:49-74`) so its value is scrubbed from output and its name is
  withheld from subprocess environments (`src/core/sandbox/env.ts:18-19, 70`, wired at
  `src/core/runtime/index.ts:303, 309`). A resolved key that is not registered here leaks
  into every hook.
- [x] 2.8 Register `web_search` conditionally in `src/core/runtime/index.ts` beside the LSP
  registration at line 441, as `if (providers.available.length) registry.register(...)`.
- [x] 2.9 Add the `web_search` branch to `subjectsOf`
  (`src/core/permissions/subjects.ts:52-73`) per 1.3.
- [x] 2.10 Update `docs/tools.md`: correct the `web_fetch` row (line 45) and add a
  `web_search` row, including how to allow a provider by rule and that the tool is absent
  when none is configured. Update the `web_search` gap row in `docs/feature-matrix.md`
  (line 119) to match.

## 3. Verify

- [x] 3.1 `extract.ts` unit tests: a link survives as a markdown link, `nav` and `footer`
  are dropped, `<main>` wins when present, and the existing entity-decoding and
  whitespace behavior is unchanged. No network.
- [x] 3.2 `web_fetch` tests in `src/core/tools/web/__tests__/fetch.test.ts`, carrying over
  the deleted `webFetch.test.ts` convention: a real local server via
  `Bun.serve({ port: 0, hostname: '127.0.0.1' })`. Every assertion that file makes today
  still passes, cross-host redirect and non-text refusal included.
- [x] 3.3 `web_search` tests following the `src/core/providers/__tests__/factory.test.ts`
  convention: swap `globalThis.fetch`, restore it in `afterEach`, assert the request
  LangSearch receives and the parse of a canned response. Save and restore env vars per
  test. No mocking library; the repository uses none. The source's own tests
  (`opencode-langsearch/test/plugin.test.ts`, its `stubFetch` and `routeFetch` helpers, plus
  the `samplePayload`, `duplicatePayload`, and dated fixtures) use the same seam, so its
  fixtures transfer.
- [x] 3.3a Cover the ported pure functions directly, since they arrive with behavior worth
  pinning: `dedupeResults` drops the same page and near-identical text while keeping
  distinct results; `withDateline` prefixes the publication date and does not double-stamp
  on a second pass; a result with no `url` is dropped; an unparseable `datePublished`
  becomes absent rather than an old date; `freshness` reaches the request body.
- [x] 3.4 Registration tests: `web_search` is absent with no key configured and present
  with one. Done in `src/core/tools/web/__tests__/search.test.ts` instead of
  `registration.test.ts`: that table only covers static builtins, and `web_search` is
  conditional, so it does not belong there (confirmed at implementation time; the
  original plan for this task line was superseded).
- [x] 3.5 Permission tests: `subjectsOf` yields the provider host for a `web_search` call,
  and `web_search(domain:...)` matches through the engine. Assert that a `network` tool
  asks by default, so the mode table is exercised rather than assumed.
- [x] 3.6 Refine seam test: replace a stage with a non-identity function and assert the
  output changed. Asserting that identity returns its input proves nothing; this is the
  only evidence the pipe is wired.
- [x] 3.7 Key precedence test: declared `key_env_var` beats a key in the file, and the
  well-known variable is the next fallback. Restore env state in `finally`.
- [x] 3.8 Drive both tools through each surface, per the definition of done: the
  interface, headless, and ACP. At least one test per surface drives the assembled
  product, not only the modules.
- [x] 3.9 Local-first check with no network and Ollama only: the session starts,
  `web_search` is absent rather than broken, `web_fetch` fails with a reason, and nothing
  errors at startup.
- [x] 3.10 The four gates: `bun install`, `npx tsc --noEmit` at the recorded baseline of 0,
  `bun test`, `bun run build`.
- [x] 3.11 `openspec validate --strict` passes for this change. The CLI is installed at
  `/opt/homebrew/bin/openspec`; `openspec validate improve-web-tools --strict` passes on
  this proposal today.

## 4. Archive

- [ ] 4.1 Apply the deltas in `specs/jamcli/spec.md` into `openspec/specs/jamcli/spec.md`
  and move this change to `openspec/changes/archive/` with every box above checked.
- [ ] 4.2 Update `openspec/SEQUENCE.md`'s open unit and closed units.
