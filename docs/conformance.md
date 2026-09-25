# Standards conformance

JamCLI claims a standard only when a test in this repository exercises it. This page
lists each standard, JamCLI's role, the status, and the test that backs the claim.
Statuses:

| Status | Meaning |
|---|---|
| planned | scheduled in `rehaul-jamcli` |
| implemented | code exists and its tests pass |
| conformant | a conformance suite runs in CI |
| not implemented | a deliberate gap, with a reason |

Updated as the deferred modules land.

## Protocols

| Standard | Version | JamCLI role | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Model Context Protocol | 2026-07-28, falling back to 2025-11-25 | client (stdio, streamable HTTP) | implemented | `src/core/mcp/__tests__/connect.test.ts` (a 2.x server over stdio and HTTP, a 1.x server), `src/core/runtime/__tests__/mcp.test.ts`, `src/cli/__tests__/mcp.test.ts` | Negotiation through `server/discover`, tools with annotations and error results, prompts as `/server:prompt`, resources as `@server:uri`, elicitation (form and URL) in both eras, and `search_tools` past a threshold. Checked by hand against the reference server `@modelcontextprotocol/server-everything` 2026.8.31 (see `tasks.md` 9.2); no CI job runs it. Roots and sampling are deprecated upstream and not implemented. |
| MCP authorization | 2026-07-28 (OAuth 2.1, PKCE, RFC 9207 issuer check) | client | implemented against a fake authorization server | `src/core/mcp/__tests__/oauth.test.ts` | Dynamic client registration; client metadata documents are not used. Tokens live in the credential store. A live sign-in against a real server is owed (`openspec/DEFERRED_STAGES/15-blocked-access-hardware.md`). |
| Agent Client Protocol | v1 (SDK 1.5.0) | agent (server) and client | implemented | `src/acp/__tests__/features.test.ts` checks every message the server sends against the SDK's zod schemas; `src/acp/__tests__/*`, `src/services/__tests__/acpClient.test.ts` | `session/load`, `session/set_mode`, `session/set_config_option`, plans, available commands, diffs, and permission requests. Not implemented: the editor's file system and terminals (`fs/*`, `terminal/*`), recorded in `openspec/DEFERRED_STAGES/17-unfinished-stages.md`. |
| ACP observer endpoint | v1, plus the v2 draft's `state_update` | agent (read-only) on a Unix socket | implemented | `src/tui/__tests__/observer.test.ts` | `JAMCLI_ACP_ENDPOINT=unix:<path>`; `state_update` is unstable upstream and may change. |
| Language Server Protocol | 3.17 | client | implemented | `src/core/lsp/__tests__/lsp.test.ts` (a scripted server, and pyright when installed) | Diagnostics, hover, definition, references, and document symbols; full-text sync. Workspace symbols, rename, and code actions are not used. |
| JSON-RPC | 2.0 | used by ACP, MCP, LSP | implemented: newline and `Content-Length` framing | `src/core/protocols/jsonrpc/__tests__/jsonrpc.test.ts` (property tests splitting messages at every byte) | The LSP client uses this layer; ACP and MCP use their SDKs' own. |
| Debug Adapter Protocol | 1.x | none | not implemented | | No evidence yet that a debugger protocol improves an agent loop over running tests; no benchmarked CLI ships it in its loop. |
| Agent2Agent (A2A) | | none | not implemented | | ACP covers delegation to other agents for this project. |

## Model APIs

| Standard | JamCLI role | Status | Evidence | Notes |
|---|---|---|---|---|
| OpenAI Chat Completions (and compatible endpoints) | client | implemented | `src/core/providers/__tests__/openai-compat.test.ts` | Streamed usage, retries, and error bodies in stage 2. |
| OpenAI Responses API | client | not implemented, will not do | | OpenAI's documentation is blocked from the build environment, so the adapter was not built against it; recorded in `docs/feature-matrix.md` and closed as will-not-do. Chat Completions stays fully supported. |
| Anthropic Messages | client | implemented, with prompt caching and signed thinking | `src/core/providers/__tests__/anthropic.test.ts` | |
| Ollama native chat | client | implemented, with `num_ctx` sized from the catalog | `src/core/providers/__tests__/factory.test.ts` | |

## Formats and conventions

| Standard | Use | Status | Evidence |
|---|---|---|---|
| AGENTS.md | project instructions | implemented | `src/core/rules/__tests__/rules.test.ts` |
| Agent Skills (`SKILL.md`) | skills | implemented, checked against the specification's examples and invalid names | `src/core/ext/__tests__/skills.test.ts` |
| JSON Schema 2020-12 | tool schemas, published configuration schema | implemented; `docs/config.schema.json` is generated from the Zod schemas, and a test fails when it is stale | `src/core/tools/__tests__/validation.test.ts`, `src/core/config/__tests__/schema.test.ts` |
| JSON Lines | transcripts, logs, traces, stream-json output | implemented | `src/core/runtime/__tests__/observe.test.ts`, `src/cli/__tests__/headless.test.ts` |
| SARIF 2.1.0 | `jamcli audit --format sarif` | not implemented | | Planned in stage 12; not landed in this unit. `jamcli audit` reports findings as text and JSON. |
| OpenTelemetry OTLP/HTTP JSON, GenAI semantic conventions | optional trace export; metrics are not exported | implemented against an in-memory collector: hex ids, nanosecond times, typed attributes, the `OTEL_EXPORTER_OTLP_*` variables, and the `gen_ai.*` span attributes for chat and tool execution | `src/core/observe/__tests__/otlp.test.ts` |
| OAuth 2.0 PKCE (RFC 7636) | OpenRouter login, MCP authorization | implemented against fake authorization servers; live sign-ins owed | `src/cli/__tests__/auth.test.ts`, `src/core/mcp/__tests__/oauth.test.ts` |
| Semantic Versioning 2.0 | plugin versions and engine ranges | implemented | `src/core/plugins/__tests__/plugins.test.ts` | A plugin's version must be a semantic version, and `engines.jamcli` a semver range checked against the running version. |
| Conventional Commits 1.0 | drafted commit messages | implemented: `/commit` asks the model for a conventional message | `src/tui/app/__tests__/commit.test.tsx` |
| CycloneDX SBOM, SLSA build provenance | release artifacts | staged; a tagged run is owed | `.github/workflows/release.yml` | The release job builds the SBOM, adds provenance, and opens a draft release; none of it has run because the tag is the owner's action. |
| XDG Base Directory | configuration, state, cache, and data paths | implemented: configuration follows `XDG_CONFIG_HOME`, state holds logs and the session index, and cache holds model metadata | `src/core/config/__tests__/load.test.ts` |
| `NO_COLOR` | monochrome output | implemented: the monochrome theme | `src/tui/app/__tests__/theme.test.ts` |
| Bracketed paste, OSC 8 hyperlinks, OSC 52 clipboard | terminal behavior | bracketed paste (OpenTUI) and OSC 52 (`/copy`) implemented; OSC 8 not implemented | |

## How to read a claim

A row moves to **conformant** only when a CI job runs its suite on every push. The job is
named in the Evidence column. Until then the row says **implemented** or **planned**,
whatever the code appears to do.
