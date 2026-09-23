# Audit: JamCLI when `rehaul-jamcli` opened

Measured on 2026-09-23 against `feat/agentic-harness-core` at `8fe1baf`, with Bun 1.4.2
(the version CI pins) and TypeScript 7.0.2. Every claim below is backed by a fresh run, a
probe, or a line reference. Status files and prose are not evidence, so none are cited.

## Gates at the start of the change

| Gate | Result |
|---|---|
| `bun install --frozen-lockfile` | clean, no lockfile changes |
| `npx tsc --noEmit` | 22 errors: `src/tui/ConfigMenuScreen.tsx` 21 (TS2300, TS2339), `src/tui/useConfigWizard.ts` 1 (TS2345). **This is the baseline for the change.** CI still carries the old ceiling of 35. |
| `bun test` | 147 pass, 0 fail, 466 assertions, 34 files, under 1.5 s |
| `bun run build` | succeeds in about 85 ms; `dist/index.js` 300.61 KB plus two chunks |
| `openspec validate --all --strict` | 1 passed |

## Measurements

- `jamcli --version`: 511 to 586 ms through `node dist/index.js`, 346 to 376 ms through
  `bun src/index.tsx`. `src/index.tsx:1-3` imports React, Ink, and the whole interface
  before looking at the arguments.
- A headless run with no reachable provider exits 1, prints `fetch failed` on stderr, and
  emits `{"status":"error","response":""}` with no error field. It also creates
  `.jamcli/` with default files in whatever directory it was run from.
- Source: 17,955 lines in 121 files. Tests: 3,188 lines in 36 files.

## Why the gates passed

The 147 tests exercise modules in isolation: the registry, the providers, the policy
resolver, the loop against stub providers. No test assembles a surface (interface,
headless, ACP) the way a user reaches it. Every critical finding below lives in that
assembly, which is why the previous unit's definition of done could be satisfied while
the product did not work as specified.

## Findings

Severity: **critical** means a spec promise is false for a normal user; **high** means a
common path fails or misleads; **medium** means a real defect with a narrower trigger.

| # | Severity | Finding | Location | Evidence |
|---|---|---|---|---|
| F1 | critical | The interface offers tools only when the provider is OpenRouter and a regular expression says the message needs them. With Ollama, the default, no tool is ever offered. When tools are offered they are the three read tools plus MCP tools. | `src/tui/useChatSubmit.ts:183`, `src/core/sensor.ts:16-41`, `src/tui/useToolConversation.ts:67-70` | code |
| F2 | critical | No surface can write or execute. Headless accepts 5 of the 21 registered tool names and offers 3 by default; ACP offers the same 3. Delegated `task` children are headless runs, so they are read-only too. | `src/types/tools.ts:1,54,60`, `src/cli/run.ts:42-54,101`, `src/acp/session.ts:57` | probe P3 |
| F3 | critical | Headless and ACP advertise every tool with `{ properties: {}, additionalProperties: true }`, so the model has to guess argument names. | `src/cli/run.ts:133-140`, `src/acp/session.ts:80-87` | code |
| F4 | critical | `write_file` cannot create any file: it calls `resolveProjectPath(relative, projectRoot)` with the arguments reversed and throws "escapes the project root" for every normal path. No test covers it. | `src/core/tools/write_file.ts:27` | probe P1 |
| F5 | critical | `edit` and `apply_patch` pass the replacement to `String.prototype.replace` as a string, so `$$`, `$&`, `` $` `` and `$'` are interpreted. | `src/services/FileSystemService.ts:26` | probe P2 |
| F6 | critical | ACP sessions forget every earlier prompt: `agent.run` never writes back to the session object, so each prompt reaches the provider alone. ACP also persists no history. | `src/acp/session.ts:119`, `src/core/state.ts:17` | probe P4 |
| F7 | high | The tool path calls `provider.complete`, so nothing streams once tools are available. When a step returns tool calls, the assistant's text and reasoning are discarded. The system prompt is appended after the user message. | `src/core/agent.ts:119-189` | code |
| F8 | high | The first call that needs approval ends the batch: calls after it never run, get no result, and disappear from the transcript. A rejection ends the turn without recording anything in the conversation. | `src/core/tools/dispatch.ts:37-39`, `src/core/agent.ts:203-208` | code |
| F9 | high | Loop defaults are 8 steps, 5 tool calls per user turn, and 2,000 characters of tool output in context, so a file read keeps roughly its first 50 lines and a read-edit-test cycle cannot finish. | `src/types/config.ts` (`DEFAULT_AGENT_LOOP_CONFIG`) | code |
| F10 | high | `--allow-tool run_command` resolves to `ask` under the default configuration, which headless refuses, and it denies every read tool that is not listed. | `src/core/policy/index.ts:52-67` | probe P3 |
| F11 | high | `run_command` is `child_process.exec` with no timeout, no exit code in the result, stderr dropped whenever stdout is non-empty, no cancellation, a 1 MB buffer, and the full parent environment including provider keys. | `src/services/ExecutionService.ts` | code |
| F12 | high | `grep` and `search_code` scan at most 400 files in glob order and ignore `.gitignore`, so in a larger repository they report "no matches" for text that exists. | `src/core/tools/grep.ts:10,57`, `src/core/tools/builtins.ts:25,105` | code |
| F13 | high | Three assemblies build providers differently. ACP turns any profile provider other than OpenRouter into Ollama. | `src/acp/session.ts:48-51`, `src/services/LLMProvider.ts` | code |
| F14 | high | The Anthropic seam replays stored reasoning as `thinking` blocks without signatures, which the Messages API rejects, so switching to Anthropic mid-session fails. It never enables thinking, sends no `cache_control`, caps output at 4,096 tokens, and defaults to `claude-3-5-sonnet-latest`. | `src/core/providers/anthropic.ts:21-22,101-103` | code |
| F15 | high | No request is retried anywhere. HTTP error bodies are discarded (`chat completions responded with status 400`). Headless prints `fetch failed` and the JSON result has no error field. | `src/core/providers/openai-compat.ts:137-139`, `src/cli.ts:229-247` | run |
| F16 | high | `/config` in the interface lists the loaded instruction files and the trust gate state, but interface turns send neither the rules nor screen results. Hooks are created only by headless. The interface reports state that is not in effect. | `src/tui/useInfoPanels.ts:211-221`, `src/tui/useChatSubmit.ts:206` | grep |
| F17 | high | History stores only the final user and assistant text of a turn, so `--continue` and `/resume` lose every tool call and result, and an unwatched run cannot be explained from its transcript. ACP writes nothing. | `src/cli/run.ts:193-202` | code |
| F18 | medium | `.jamcli/` is never git-ignored by JamCLI. It is ignored here only because this repository's own `.gitignore` lists it; in any other project the history directory can be committed. | `src/services/ConfigService.ts:98-113` | grep |
| F19 | medium | Ollama's `num_ctx` is never set, so long contexts are truncated by Ollama itself, silently, from the front. | `src/core/providers/ollama.ts:143-146` | code |
| F20 | medium | Context management is off by default, runs only in the interface, estimates tokens as characters over four, and can separate an assistant tool call from its tool result, which providers reject. | `src/core/context/manager.ts:64-107`, `src/services/config/defaults.ts` | code |
| F21 | medium | The trust gate drops results a classifier scores below 0.3 relevance, embeds raw tool output in the classifier prompt with no escaping, and sends it untruncated. | `src/core/trust/index.ts:73-86,137-145` | code |
| F22 | medium | Path checks are lexical: a symbolic link inside the project that points outside it passes. | `src/core/tools/paths.ts:11-16` | code |
| F23 | medium | MCP stdio servers inherit the full environment. There is no OAuth. The SDK (1.22) predates the 2026-07-28 protocol. Headless builds an `McpManager` and never uses it, so MCP tools are absent headless and over ACP. | `src/services/McpManager.ts:37-43`, `src/cli/run.ts:90` | code |
| F24 | medium | `@` references expand only in the interface; headless and ACP send them literally. | `src/tui/useChatSubmit.ts:113` | grep |
| F25 | low | A failing hook is reported as assistant text, so it appears inside the answer. | `src/core/hooks/index.ts:113-116` | code |
| F26 | process | `master` and this branch share no commit, so the archived unit cannot be merged without `--allow-unrelated-histories`. No pull request exists. Local Bun was 1.3.11 against CI's 1.4.2, and the `openspec` CLI was absent. | `git merge-base` | run |

## Probes

Each probe is reproducible from the repository root at `8fe1baf`.

**P1, `write_file`.** Calling `writeFile({ path: 'hello.txt', content: 'hi\n' }, { projectRoot })`
throws `Path <projectRoot> escapes the project root.` and the file does not exist
afterward. `resolveProjectPath(projectRoot, 'hello.txt')` in the correct order returns
`<projectRoot>/hello.txt`.

**P2, replacement text.** `editRunner` asked to replace `echo PID` with
`echo "pid=$$ match=$&"` writes `echo "pid=$ match=echo PID"`.

**P3, tool names and policy.** The registry lists 21 tools. `ALL_TOOL_NAMES` is
`list_files,read_file,search_code,apply_patch,run_command` and `SAFE_TOOL_NAMES` is
`list_files,read_file,search_code`. `resolveToolPolicy('run_command', { permissions:
defaults, allowTools: ['run_command'] })` returns `ask` ("configuration sets this tool"),
and `grep` under the same run returns `deny`.

**P4, session memory.** A `CoreAgent` driven twice with the same session object sends one
message to the provider on each prompt, and `session.messages` is still empty afterward.

## Spec truth table

Grades for the 36 requirements in `openspec/specs/jamcli/spec.md` as the code stands:
**holds**, **partial** (true on some surfaces or paths), **broken** (false for a normal
user), or **unverified** (not re-run in this audit; the previous unit claims it).

| Requirement | Grade | Note |
|---|---|---|
| Terminal User Interface | partial | Streams only when no tools are involved (F7). |
| Slash Command Surface | unverified | Claimed by the previous unit's task 11.2; re-exercised in stage 6. |
| Project Root Discovery | holds | `src/utils/projectRoot.ts`. |
| Provider Configuration | partial | ACP ignores configured providers (F13). |
| Model Discovery | holds | Unit tests; not re-run live. |
| Read-Only Tool Execution | partial | Tools work in isolation; not offered on the default path (F1), caps give false negatives (F12). |
| Approval-Gated State Changes | broken | No surface offers a state-changing built-in (F1, F2); decisions are not recorded in the transcript (F17). |
| Tool Permission Policy | partial | Deny works; allow flags do not (F10). |
| MCP Server Integration | partial | Interface only (F23). |
| MCP Tool Discovery | partial | "Select relevant tools per turn" is the regex gate behind F1. |
| Behavior Profiles | unverified | |
| Project Rules and Tool Guidance | partial | Injected by headless only (F16). |
| Context Management | partial | Off by default, interface only, can split tool pairs (F20). |
| Token Accounting | holds | Session and per-model counts accumulate; no cost. |
| Session History Persistence | partial | Text only (F17). |
| Session Listing and Export | holds | CLI subcommands. |
| Workspace References | partial | Interface only (F24). |
| UI Style Configuration | unverified | |
| Bounded Agent Loop | holds | Enforced in the core, but the defaults prevent real work (F9). |
| Configuration Persistence | partial | "git ignores it" is false outside this repository (F18). |
| Transport-Agnostic Agent Core | broken | Three assemblies with different tools, providers, rules, and hooks (F1, F2, F13, F16). |
| Single Tool Protocol | partial | Native only, but calls after an approval request are dropped (F8). |
| Tool Registry | broken | Registration does not reach headless or ACP; schemas are not advertised there (F2, F3). |
| Filesystem Write Tools | broken | F4, F5. |
| Edit Reliability | holds | Anchors work, but `edit` is not offered anywhere (F2). |
| Generic Provider Endpoints | partial | F14, F15, F19. |
| Category-Based Model Routing | holds | Unit tests; used only by delegation. |
| Delegated Task Execution | partial | Children are read-only headless runs (F2). |
| Tool Output Trust Gate | partial | Headless only; F21. |
| Project Rules Hierarchy | partial | Loaded everywhere, injected by headless only (F16). |
| Lifecycle Hooks | partial | The bus exists; only headless creates it; no configuration surface registers a hook. |
| Delegation Audit | unverified | |
| Command Line Invocation | partial | F10, F15. |
| MCP Streamable HTTP Transport | holds | Authentication is reported as not connected, as specified. |
| ACP Agent Surface | broken | F6, F2, F13. |
| ACP Client Surface | unverified | Unit tests only. |

Totals: holds 8, partial 18, broken 6, unverified 4.

## What is sound

The module boundaries are right and are kept: a core with no interface imports (enforced
by a test), a tool registry with real schemas and validation, a provider interface with
one OpenAI-compatible client, policy resolution that carries its reason, the rules
hierarchy with conditional sections, category routing with capability normalization,
line anchors, the hook bus, and fast tests. The defects are in how the pieces are
assembled per surface and in a handful of tool implementations, which is why this change
is a rehaul in place rather than a rewrite.
