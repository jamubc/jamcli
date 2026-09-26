# Design

## Containment is a requirement, not a preference

The substance of this change lives in one directory of four files. The owner must be able
to open `src/core/tools/web/` and reach everything that matters: the tool definitions, the
provider, the refinement stage, and the extraction.

```
src/core/tools/web/
  index.ts      both tool definitions and their schemas
  providers.ts  LangSearch and the provider seam
  refine.ts     the identity stages, the file to iterate on
  extract.ts    HTML to readable text
```

Outside that directory, ten files are modified and two are deleted. Each is mechanical,
and each has its reason here; the Impact list in `proposal.md` is the whole list:

- **Wiring, three files.** `src/core/tools/builtins.ts` (import path for the fetch tool),
  `src/core/runtime/index.ts` (conditional `web_search` registration beside the LSP
  precedent at line 441), `src/core/permissions/subjects.ts` (one `web_search` branch).
- **Configuration, four files.** `src/core/config/schema.ts` (the `search` block),
  `src/types/config.ts` (its type), `src/core/runtime/model.ts` (key redaction),
  `docs/config.schema.json` (regenerated from the schema, never hand-edited).
- **Tests, one file.** `src/core/tools/__tests__/registration.test.ts` gains the
  `web_search` row.
- **Docs, two files.** `docs/tools.md` (the two tool rows) and `docs/feature-matrix.md`
  (the web search gap row).
- **Deletions, two files.** `src/core/tools/webFetch.ts` and
  `src/core/tools/__tests__/webFetch.test.ts`; the tool name `web_fetch` does not change,
  and the test's coverage moves under `web/__tests__/fetch.test.ts`.

This is a constraint on the design because the alternative has a record. Capability spread
across a dozen small modules is how a codebase stops being readable one reasonable commit
at a time. The honest list above is longer than an early draft claimed; every entry is an
import path, a one-line branch, a schema block, a redaction entry, or a doc row.

## The provider seam

Three patterns in the repository do "pick a backend, detect whether it is available, fall
back without failing":

- `search.ts`'s ripgrep detection: a cached probe, a forced-backend override, and a
  secondary fallback when ripgrep's regex dialect rejects a pattern.
- `LspManager`: a record of built-in defaults keyed by name, merged with the user's config
  map, each entry capability-detected, only available entries exposed.
- `resolveRoute`: an ordered chain tried in turn, each skip carrying a reason.

`LspManager` (`src/core/lsp/manager.ts:22-91`) is the closest, because the question is the
same: a named registry of things that might or might not be usable on this machine, where
a user entry of a given name replaces the built-in of that name. It merges defaults at
line 74 and filters by availability at line 75. Follow it.

```ts
const DEFAULT_PROVIDERS: Record<string, SearchProvider> = { langsearch: { ... } };

class SearchProviders {
  constructor(settings: SearchSettings);
  get available(): string[];
  async run(query: string, opts: SearchOptions): Promise<SearchResult[]>;
}
```

"Available" means a key resolves. It does not mean reachable: a liveness probe on every
session start would be a network call nobody asked for. An unreachable provider fails at
call time with the reason, which is the same contract `web_fetch` already has.

`resolveRoute`'s `skipped: { reason }[]` shape is worth borrowing for the multi-provider
case later. With one provider it would be ceremony, so it is not in this change.

### Credentials

`resolveApiKey` (`src/core/providers/factory.ts:36-47`) already takes any
`{ api_key?, key_env_var? }` object and applies the precedence this repository has settled
on: declared `key_env_var`, then `api_key` in the file, then a well-known fallback
variable, then the OS credential store. It is provider-agnostic. Call it and add nothing.

The one obligation that comes with a new key is redaction. `configuredSecrets` and
`keyVariables` (`src/core/runtime/model.ts:49-74`) collect key values for output scrubbing
and key variable names so subprocesses do not inherit them
(`src/core/sandbox/env.ts:18-19`, applied at line 70; wired at
`src/core/runtime/index.ts:303, 309`). The search provider's variable joins both. A key
that is resolved but not registered there is a key that leaks into a hook's environment.

Extending `jamcli auth` to manage search-provider keys is deliberately **out of scope**.
`src/cli/auth.ts` hardcodes the chat providers, and widening that surface is its own
change. `key_env_var` is enough for this one.

## The refinement stage

The owner wants a place between a raw result and the calling model. The decision taken in
this unit is explicit: the pipe exists, does nothing, and says in the file what it is for.

So the stage ships empty, and `refine.ts` opens with the note the owner asked for:

```ts
// The refinement pipe: results and fetched text pass through here untouched.
// The intended first occupant is the TypeSafe System One gate (model jev-latest)
// from opencode-langsearch/src/index.ts:776-1148. It is deferred to a later unit;
// it fails open, and it needs TYPESAFE_API_KEY when it lands.
export async function refineSearch(
  query: string, results: SearchResult[], ctx: ToolContext,
): Promise<SearchResult[]> { return results }

export async function refineFetch(
  url: string, text: string, prompt: string | undefined, ctx: ToolContext,
): Promise<string> { return text }
```

Two functions, one per tool, narrow types rather than a tagged union, because the two
cases share no fields and a union would only add branching.

`ctx` is passed today although identity ignores it, because an implementation will need
routing and providers, and threading it later would change both signatures and every call
site. That is the one piece of forward accommodation in this change, and it costs two
unused parameters.

`web_fetch` gains an optional `prompt` argument, carried to `refineFetch` and otherwise
unused. It is the argument a refinement needs in order to be worth anything, and adding it
now means turning refinement on later is an edit to one file.

The test obligation is unusual and important: asserting that an identity function returns
its input proves nothing. One test must replace a stage with a non-identity function and
assert the output changed, because that is the only evidence the pipe is actually wired.
A seam that silently is not called is worse than no seam.

## Extraction

`htmlToText` (`src/core/tools/webFetch.ts:35-54`) moves into `extract.ts` and changes in
three ways: `href` preserved as a markdown link, `nav`/`footer`/`aside` dropped alongside
the existing `script`/`style` removals, and `<main>` or `<article>` preferred as the
content root when present. The link loss is the final `.replace(/<[^>]+>/g, '')` at line
45, which strips attributes along with tags.

It stays a pure function over a string. No dependency, no DOM, no network, and therefore
cheap to test exhaustively. It is also the largest quality gain per line in the change and
the only part that improves the offline path, so it lands first.

Structure-aware truncation is **deferred**. The 5 MB byte cap stays. Once extraction drops
the chrome and a refinement stage exists, blind truncation is a much smaller problem, and
solving it now would be solving it without evidence.

## Registration

`registerBuiltinTools` (`src/core/tools/builtins.ts:17-38`) is a static list with no view
of configuration, so a conditionally-registered tool cannot live there.
`src/core/runtime/index.ts:441-442` shows the shape:

```ts
if (lsp?.available.length) registry.register(lspTool(lsp));
```

`web_search` follows it exactly, constructed from config and registered only when a
provider resolves. The model never sees a tool it could not use, which matters more here
than usual: a search tool that always fails is worse than no search tool, because the
model will keep trying it.

`web_fetch` needs no credentials and stays in the static list.

## Permissions, and the finding that shaped this

`subjectsOf` (`src/core/permissions/subjects.ts:52-73`) is argument-driven, not
tool-name-driven. Any call whose `arguments.url` is a string gets a `domain` subject, which
is how `web_fetch` gets domain rules with no special-casing anywhere. That is a good
design and the reason `web_fetch(domain:docs.python.org)` works.

It also means a tool whose argument is `query` gets **no** subject at all, and a rule
written as `web_search(domain:...)` would parse cleanly, match nothing, and never say so.
A permission rule that silently does not apply is the worst failure mode available in a
policy engine. Verified: `query` appears nowhere in `subjectsOf`, and the only `domain`
construction in `src/` is line 67, from `args.url`.

Two options were considered. A new `provider:` pattern kind would require changes to
`patternMatches` and the rule grammar in `src/core/permissions/rules.ts:72-81`, adding a
concept to the policy language for one tool. Instead, add one branch to `subjectsOf`
mapping `web_search` to the configured provider endpoint's hostname. This reuses the
existing `domain:` matcher untouched, so `web_search(domain:api.langsearch.com)` gates by
which provider may be reached, which is the question a user actually has.

Gating by query content is not attempted and should not be. The URLs a search returns are
gated per host by `web_fetch` when they are actually fetched, which is where that decision
belongs.

Both tools declare `policy: 'network'`. Under `MODE_DEFAULTS`
(`src/core/permissions/modes.ts:32-38` in the working tree; 24-30 at `9d9f5c6`) a network
tool asks in every mode but bypass, so the default posture needs no code.

## Configuration

A `search` block joins `ConfigFileSchema` (`src/core/config/schema.ts:117-245`) under the
conventions already in force there: `z.strictObject(...).partial()` so a typo is an error
rather than silence, and `.describe()` on every field so it reaches
`docs/config.schema.json` through `configJsonSchema()` (`src/core/config/schema.ts:294-297`)
and editors autocomplete it. The insertion point is line 144, between `lsp` and
`tool_search`.

`EndpointConfig` (`src/types/config.ts:23-30`) is the precedent to mirror: it is how this
repository already lets a user name a backend the CLI knows nothing about in advance.

Layering, profiles, and origin tracking come from `loadConfig`
(`src/core/config/load.ts:144-211`) for free. No new env-var special case is added;
`ENV_SETTINGS` stays as it is.

## The LangSearch port

The source is the owner's own
`/Users/jam/Documents/github/jamubc/opencode-langsearch`, `src/index.ts` (1495 lines, the
only source file), which is a working implementation with 1526 lines of tests. The
contract below is read from that file, not from documentation.

The source touches its host in exactly two places: the plugin import at line 5 and the
adapter at 1302-1495. Everything else, lines 1-1299, is plain `fetch`, arrays, and
strings; this change draws from the pure-function block at 388-1299.
`opencode-deep-research` is **not** a source for this. It contains no LangSearch
integration in its source or anywhere in its git history; its web-search agent uses
OpenCode's builtin tools. It was checked, and it is recorded here so nobody checks again.

### The contract

One endpoint, one method. `POST https://api.langsearch.com/v1/web-search`, headers
`Authorization: Bearer <key>` and `Content-Type: application/json`, nothing else. Request
body:

```jsonc
{
  "query": "<string>",
  "count": 8,                             // integer, clamped 1-50
  "freshness": "noLimit",                 // or oneDay/oneWeek/oneMonth/oneYear
  "includeDomains": [],                   // omitted when empty
  "excludeDomains": [],                   // omitted when empty
  "contents": { "text": true }            // or { "text": { "maxCharacters": 5000 } }
}
```

The request carries a 30 second timeout (`combineSignals`, source 394-396, 527). The
response is `data.webPages.value[]`, each entry carrying `url`, `name`, `snippet`, `text`,
and `datePublished`. Entries without a `url` are dropped. The mapping is
`title: name ?? url`, `content: text ?? snippet ?? ''`, and `datePublished` parsed to
epoch milliseconds, with anything unparseable becoming absent rather than old.

**LangSearch returns page text itself.** `contents.text` makes the service crawl and
extract server-side, so `web_search` performs no page fetching of its own and needs no
HTML handling. That is why `extract.ts` serves only `web_fetch`.

The source has no caching, no rate limiting, and no retry or backoff: each call is a
single `fetch` that throws on a non-2xx with the status and the first 500 characters of
the body (source 530-534). The `web_fetch` cache in this change is therefore new work,
not ported, and `web_search` gets no cache at all.

### `SearchResult`

Settled from what the provider actually returns, per task 1.2:

```ts
interface SearchResult {
  url: string
  title?: string
  content?: string
  time: { published?: number }
}
```

### What ports, and where it goes

Of the pure part, this change takes three pieces into `providers.ts`:

- `searchLangSearch` (source 498-550), the request and parse.
- `dedupeResults` with its `canonicalizeUrl`, `shingles`, and `containment` helpers
  (source 619-729), a local duplicate filter with no network.
- `withDateline` (source 431-442), which prefixes a result's text with its publication
  date so the model reads the date inline rather than relying on a field being rendered.
  It is idempotent.

These three are provider-output normalization, not refinement, so they sit in
`providers.ts` and run before the refine stage. `refine.ts` stays identity.

`resolveKey` does **not** port: `resolveApiKey` already does that job here, better, with
the credential store included.

### The freshness argument

`FRESHNESS_PROPERTY` (source 470-477) transfers verbatim as a property of the
`web_search` input schema: a string enum of `noLimit`, `oneDay`, `oneWeek`, `oneMonth`,
`oneYear`, with a description telling the model to use the short periods for prices, news,
scores, and releases, and `noLimit` for reference material. It is worth keeping because it
is the one argument that changes result quality for time-sensitive questions.

The source needs a bounded query-to-freshness side map (`createPendingStore`, source
1274-1299) purely because OpenCode hands a search provider only `{ query }`. A jamcli
builtin receives its whole input, so that machinery is dropped entirely.

## The gate, and why `refine.ts` still ships empty

The owner already built the thing the refine stage is for, and it works. The source's
`gate` option (option type at source 116, `GateOptions` at 120-156, normalizer at 732-736;
implementation at 776-1148) is a two-stage filter against TypeSafe's System One model
`jev-latest` at `https://api.typesafe.ai/v1/systemone`:

1. Every result is scored on two `noul` questions: does it address the query, and does it
   attempt to control the system answering the query. Results over the injection threshold
   or under the relevance threshold are dropped, survivors are ranked by relevance and
   capped, and if nothing survives the best non-injection result is kept as a fallback.
2. Every remaining result is split into passages and each passage scored on whether it
   states something bearing on the query. Passages that do not are dropped, and each
   result always keeps its best passage.

It fails open at both stages: any error returns the stage's input untouched. Defaults are
`maxResults: 4`, `minRelevance: 0.45`, `maxInjection: 0.5`, `maxContentChars: 1500`,
`timeoutMs: 8000`. In the source it is enabled only when a `TYPESAFE_API_KEY` (or a gate
key file) resolves and the endpoint is the default; an injection is never returned, even
as the fallback.

Two things follow. First, the injection scoring is a real security control, not a quality
one: search results are untrusted text arriving inside a tool result, and this is the only
mechanism in either codebase that treats them that way. Second, roughly 900 lines of
already-tested pure logic is available to drop into `refine.ts` when the owner wants it.

It is still **out of scope here**, and the decision is the owner's, taken in this session:
the stage ships as a pipe that does nothing, with a comment in the file naming the gate as
the intended occupant. Porting a second network service plus a second API key in the same
unit would violate one concern per unit, and the point of the note is that
`refineSearch`'s signature must be able to host the gate unchanged, which it can: it
receives the query, the results, and the context, which is exactly what the gate needs.

One defect in the owner's current setup, found while reading: the live
`~/.config/opencode/opencode.jsonc` passes `"debug": true`, but `normalizeDebugOption`
(source 557-563) returns undefined unless `debug` is an object with a `file` path. No trace
is being written today, and the plugin warns about it. That is a fix in that repository,
not this one.

## Decisions to confirm

Two decisions belong to the owner at plan approval. Recommendations:

- **`web_search` rule subject.** Add one branch to `subjectsOf` mapping `web_search` to
  the configured provider endpoint's hostname, so `web_search(domain:...)` gates by
  provider, reusing the existing `domain:` matcher rather than adding a `provider:` kind.
  Alternative rejected above.
- **`web_fetch` cache shape.** In-process only, keyed by the URL after redirects, 15
  minute TTL, 8 MB total cap with least-recently-used eviction, never on disk. No jamcli
  precedent exists; this mirrors what a coding CLI needs and nothing more.
