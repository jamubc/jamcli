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

Updated as stages of `rehaul-jamcli` land.

## Protocols

| Standard | Version | JamCLI role | Status | Evidence | Notes |
|---|---|---|---|---|---|
| Model Context Protocol | 2026-07-28, falling back to 2025-11-25 and earlier | client (stdio, streamable HTTP) | planned (stage 9); 2025-era client implemented | `src/cli/__tests__/mcp.test.ts`, `src/services/__tests__/mcpTransport.test.ts` today; reference-server suite planned | OAuth, elicitation, prompts, resources, negotiation in stage 9. Roots and sampling are deprecated upstream and are not implemented. |
| MCP authorization | 2026-07-28 (OAuth 2.1, PKCE, RFC 9207 issuer check, client metadata documents) | client | planned (stage 9) | | Dynamic client registration only as a fallback. |
| Agent Client Protocol | v1 (SDK 1.5.0) | agent (server) and client | implemented by hand today; official SDK planned (stage 9) | `src/acp/__tests__/*` | Schema validation of every message planned. |
| Language Server Protocol | 3.17 | client | planned (stage 9) | | Diagnostics, definition, references, hover, symbols. |
| JSON-RPC | 2.0 | used by ACP, MCP, LSP | implemented (newline framing); `Content-Length` framing planned | `src/acp/__tests__/protocol.test.ts` | One shared layer once the SDKs take over ACP and MCP. |
| Debug Adapter Protocol | 1.x | none | not implemented | | No evidence yet that a debugger protocol improves an agent loop over running tests; no benchmarked CLI ships it in its loop. |
| Agent2Agent (A2A) | | none | not implemented | | ACP covers delegation to other agents for this project. |

## Model APIs

| Standard | JamCLI role | Status | Evidence | Notes |
|---|---|---|---|---|
| OpenAI Chat Completions (and compatible endpoints) | client | implemented | `src/core/providers/__tests__/openai-compat.test.ts` | Streamed usage, retries, and error bodies in stage 2. |
| OpenAI Responses API | client | planned, optional (stage 4) | | Recorded as a gap if it does not land. |
| Anthropic Messages | client | implemented; caching and signed thinking planned (stage 4) | `src/core/providers/__tests__/anthropic.test.ts` | |
| Ollama native chat | client | implemented; `num_ctx` planned (stage 2) | `src/core/providers/__tests__/factory.test.ts` | |

## Formats and conventions

| Standard | Use | Status | Evidence |
|---|---|---|---|
| AGENTS.md | project instructions | implemented | `src/core/rules/__tests__/rules.test.ts` |
| Agent Skills (`SKILL.md`) | skills | planned (stage 8) | |
| JSON Schema 2020-12 | tool schemas, published configuration schema | implemented; `docs/config.schema.json` is generated from the Zod schemas, and a test fails when it is stale | `src/core/tools/__tests__/validation.test.ts`, `src/core/config/__tests__/schema.test.ts` |
| JSON Lines | transcripts, logs, traces, stream-json output | implemented | `src/core/runtime/__tests__/observe.test.ts`, `src/cli/__tests__/headless.test.ts` |
| SARIF 2.1.0 | `jamcli audit --format sarif` | planned (stage 12 at the latest) | |
| OpenTelemetry OTLP/HTTP JSON, GenAI semantic conventions | optional trace export; metrics are not exported | implemented against an in-memory collector: hex ids, nanosecond times, typed attributes, the `OTEL_EXPORTER_OTLP_*` variables, and the `gen_ai.*` span attributes for chat and tool execution | `src/core/observe/__tests__/otlp.test.ts` |
| OAuth 2.0 PKCE (RFC 7636) | OpenRouter login, MCP authorization | OpenRouter login implemented against a fake authorization server, with a live sign-in owed; MCP authorization planned (stage 9) | `src/cli/__tests__/auth.test.ts` |
| Semantic Versioning 2.0 | plugin versions and engine ranges | planned (stage 10) | |
| Conventional Commits 1.0 | drafted commit messages | planned (stage 7) | |
| CycloneDX SBOM, SLSA build provenance | release artifacts | planned (stage 12) | |
| XDG Base Directory | configuration, state, cache, and data paths | implemented: configuration follows `XDG_CONFIG_HOME`, state holds logs and the session index, and cache holds model metadata | `src/core/config/__tests__/load.test.ts` |
| `NO_COLOR` | monochrome output | planned (stage 6) | |
| Bracketed paste, OSC 8 hyperlinks, OSC 52 clipboard | terminal behavior | bracketed paste implemented; the others planned (stage 6) | |

## How to read a claim

A row moves to **conformant** only when a CI job runs its suite on every push. The job is
named in the Evidence column. Until then the row says **implemented** or **planned**,
whatever the code appears to do.
