# Change: Web search, and a web fetch worth reading

## Why

JamCLI's entire web capability is one tool. `web_fetch` takes a URL and returns the page
as de-tagged text. There is no search tool: nothing under `src/` searches the web, which
means the model can only fetch URLs it already guessed. On the local-first path, with a
small model and no prior knowledge of a library's documentation layout, that is not a
degraded research path, it is no research path.

The spec's only web requirement, "Web Fetch Tool", is met literally and thinly. Three
defects in how it meets it cost real output quality:

- **Every link is discarded.** `htmlToText` ends with `.replace(/<[^>]+>/g, '')`
  (`src/core/tools/webFetch.ts:45`), which strips attributes along with tags, so
  `<a href="...">text</a>` becomes bare text. Research is iterative link-following. The
  tool reads a page of references and cannot follow one of them.
- **No main-content extraction.** Navigation, sidebars, footers, and cookie banners all
  survive into the output, so the model pays for them.
- **Nothing stands between the page and the model.** Up to 5 MB of text comes back whole.
  A single fetch can spend tens of thousands of tokens to answer one question, and there
  is no place to put a filter, a summarizer, or a reranker even if one were wanted.

A user cannot fix any of this from outside, either. Plugins may contribute commands,
skills, hooks, and MCP servers (`src/core/plugins/manifest.ts:31-38`), but not tools, and
`ToolRegistry.register` throws on a duplicate name
(`src/core/tools/registry.ts:103-111`), so nothing can shadow a builtin. That invariant is
correct and stays. It does mean the pluggability has to live inside the tool, in
configuration, which is where a coding CLI's provider configuration belongs anyway.

## What Changes

- A `web_search` tool, policy class `network`, registered only when a search provider is
  actually configured, following the LSP precedent where a tool the model could not use is
  never offered (`src/core/runtime/index.ts:441-442`).
- One provider implementation, LangSearch, behind a named-provider seam modelled on
  `LspManager`'s default-registry-merged-with-user-config pattern
  (`src/core/lsp/manager.ts:22-91`). A second provider becomes an additive change, not a
  refactor. No seam is built for providers that do not exist.
- Provider credentials declared in configuration the same way model providers declare
  theirs, resolved by the existing `resolveApiKey`
  (`src/core/providers/factory.ts:36-47`), so the precedence a user already knows
  (declared `key_env_var`, then a key in the file, then the well-known variable, then the
  credential store) applies unchanged.
- A refinement stage per tool, shipped as an identity pass: wired, piped, tested, and
  doing nothing. The file opens with a comment naming its intended first occupant, the
  TypeSafe System One gate (`jev-latest`) in `opencode-langsearch`
  (`src/index.ts:776-1148`), deferred to a later unit so this one stays one concern.
- `htmlToText` reworked to preserve links as markdown, drop `nav`, `footer`, and `aside`,
  and prefer `<main>` or `<article>` when present. A response cache and a real user agent,
  since `jamcli web_fetch` is refused by a meaningful share of the web.
- One branch added to `subjectsOf` (`src/core/permissions/subjects.ts:52-73`) so
  `web_search` rules can name a provider host. Without it, that function derives a
  `domain` subject only from a literal `args.url`, and a `web_search(domain:...)` rule
  would silently match nothing.

## Impact

- **Affected specs:** `jamcli`. "Web Fetch Tool" is modified; a "Web Search Tool"
  requirement is added.
- **Affected code, new:** `src/core/tools/web/` holding `index.ts` (both tool definitions),
  `providers.ts` (LangSearch and the seam), `refine.ts` (the identity stages), and
  `extract.ts` (HTML to readable text), with tests beside them. The whole of the change's
  substance is reachable by opening that directory.
- **Affected code, modified:** `src/core/tools/builtins.ts` (import path),
  `src/core/runtime/index.ts` (conditional registration),
  `src/core/permissions/subjects.ts` (the `web_search` branch),
  `src/core/config/schema.ts` and `src/types/config.ts` (the `search` block),
  `src/core/runtime/model.ts` (redaction of the new key variable),
  `src/core/tools/__tests__/registration.test.ts` (the `web_search` row),
  `docs/tools.md` and `docs/feature-matrix.md` (the two web rows),
  `docs/config.schema.json` (regenerated from the schema, never hand-edited).
- **Affected code, deleted:** `src/core/tools/webFetch.ts` and its test
  `src/core/tools/__tests__/webFetch.test.ts`. The tool name `web_fetch` does not change,
  so no user-visible name or permission rule breaks; the test's coverage moves to
  `src/core/tools/web/__tests__/fetch.test.ts`.
- **Reused unchanged:** `resolveApiKey` (`src/core/providers/factory.ts:36-47`),
  `loadConfig` (`src/core/config/load.ts:144-211`), the `domain:` matcher in
  `src/core/permissions/rules.ts`, and `MODE_DEFAULTS`
  (`src/core/permissions/modes.ts:32-38` in the working tree; 24-30 at `9d9f5c6`), under
  which a `network` tool asks by default in every mode but bypass with no code of its own.
- **Not affected:** the local-first path. `web_search` is absent without a key, the
  refinement stages are identity passes, and the extraction rework is pure local logic
  that makes the offline path strictly better. Ollama with no network behaves as it does
  today, minus the chrome in fetched pages.
