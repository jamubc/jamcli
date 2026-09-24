# Tasks: Rehaul JamCLI

Twelve stages. Stage 1 precedes everything and stage 2 precedes everything after it.
The other ordering constraints are in `proposal.md` under Sequencing.

Every checkpoint ends with the same four commands, and none of them may regress:

```bash
bun install
npx tsc --noEmit        # at or under the recorded baseline
bun test
bun run build
```

**Type baseline for this change: 22 errors** (`npx tsc --noEmit`, TypeScript 7.0.2, Bun
1.4.2, measured on `8fe1baf` before any source change; see `audit.md`). A checkpoint
that raises it is not a checkpoint.

Each new test is shown able to fail with a mutation probe before it counts as evidence.
Line references describe the tree when the change opened.

## Stage 1: Foundations

- [ ] 1.1 Record the baseline. Files: this file, `.github/workflows/ci.yml`. Lower `TYPE_ERRORS_BASELINE` from 35 to 22. Verify CI's type step prints `22 (baseline 22)`.
  - **Blocked on access**: the GitHub App this work is pushed with lacks the `workflows` permission, so no commit that touches `.github/workflows/` can be pushed. The intended workflow is staged at `openspec/changes/rehaul-jamcli/workflows/ci.yml`. Its type step, run locally on Bun 1.4.2, prints `tsc --noEmit errors: 22 (baseline 22)` and passes. It lands in `.github/workflows/` once the permission is granted or the owner copies it there, and every later workflow change is staged beside it.
- [x] 1.2 Build the fake provider server. Files: `src/testing/fakeProvider.ts`, `src/testing/__tests__/fakeProvider.test.ts`.
  - It serves OpenAI chat completions (SSE and JSON), Anthropic messages (SSE and JSON), and Ollama `/api/chat` (NDJSON), plus `/models` and `/api/tags`.
  - Each response comes from a queue of scripted turns (text, reasoning, tool calls, usage, errors, delays, status codes). Every request body is captured for assertions.
  - Verify: the existing providers round-trip a scripted tool call through each dialect against it.
  - **Verification**: 11 tests pass against a real local server: OpenAI, Anthropic, and Ollama each stream text in pieces and assemble a scripted tool call. Scripted 429 status and headers, an exhausted script, a stream cut short, and the model routes are also covered. Mutation probe: disabling chunk splitting turns two tests red.
  - **Found while building it**: Ollama 0.8 and later streams tool calls in a non-final chunk, but `OllamaProvider.streamChat` reads them from the final chunk only. It is recorded as a todo in `fakeProvider.test.ts` and fixed in 2.8.
- [x] 1.3 Add surface-level regression tests for the audit's critical findings, marked as the acceptance checks for stage 2. Files: `src/core/__tests__/audit.test.ts`. Tests that pass only after stage 2 are written with `test.todo` so every checkpoint stays green, and each is converted to `test` in the task that fixes it.
  - **Verification**: 25 todos, F1 to F25, each naming the task that converts it. `bun test` reports 158 pass and 26 todo.

## Stage 2: One honest runtime

- [x] 2.1 Extend the core contracts. Files: `src/core/types.ts`.
  - Add `ToolResult.callId` and `ToolResult.status`.
  - Add reasoning blocks with the producing provider family.
  - Add the events `turn_start`, `step_start`, `tool_progress`, `retry`, `compaction`, and `turn_end`, and a `notice` level.
  - Add an `ApprovalRequest` with a preview, a reason, and suggestions. `decide` accepts a boolean or an `ApprovalDecision`.
  - Additive only, so the Ink interface still compiles.
  - **Verification**: the type count stays at 22 and all tests pass. The two callbacks that took only a boolean (the loop's approval request and an ACP test stub) now read the decision through `readDecision`, so `true` and `false` stay valid decisions.
- [x] 2.2 Fix `write_file` (F4). Files: `src/core/tools/write_file.ts`, `src/core/tools/__tests__/writeFile.test.ts`. Verify create, refuse to overwrite, overwrite, refuse a directory, and refuse an escape.
  - **Verification**: 5 tests pass. Mutation probe: restoring the reversed arguments turns four of them red. F4 in `audit.test.ts` is live.
- [x] 2.3 Make replacements literal and add `replace_all` (F5). Files: `src/services/FileSystemService.ts`, `src/core/tools/edit.ts`, tests. Verify `$$`, `$&`, `` $` ``, and `$'` survive, and CRLF files keep CRLF.
  - **Verification**: `src/core/tools/textEdit.ts` holds the literal replacement. `edit` gains `replace_all` and `occurrence` and reports a unified diff in its metadata. `FileSystemService.applyEdit` inserts literally too, which also fixes the Ink approval path until stage 6 removes it. 8 tests pass. Mutation probe: restoring the string replacement turns the `apply_patch` dollar test red. F5 is live.
- [x] 2.4 Resolve symbolic links in path checks (F22). Files: `src/core/tools/paths.ts`, tests. Verify a link inside the project that points outside is refused for reads and writes.
  - **Verification**: a read and a write through an outward link are refused, and nothing is created outside. A project root that is itself reached through a link still works. Mutation probe: disabling the real path check turns both escape tests red. F22 is live.
- [x] 2.5 Rebuild `run_command` (F11). Files: `src/core/tools/command.ts` (new), `src/core/tools/builtins.ts`, `src/services/ExecutionService.ts` (removed), tests.
  - Spawn, timeout, exit code or signal, and labeled streams.
  - Head and tail truncation with a note, and `tool_progress` events.
  - The abort signal kills the process group.
  - Background jobs with `command_output` and `command_kill`.
  - **Verification**: 11 tests pass.
    - They cover exit codes with labeled streams, a timeout that stops the whole process group (a backgrounded child's file never appears), and cancellation.
    - They also cover head and tail truncation, streamed progress, end of input on stdin, a refused working directory, and background start, read, and kill.
    - Mutation probes: signaling only the shell fails both the timeout and the cancellation tests, because the orphaned child holds the pipes open. Disabling the timer fails the timeout test.
    - Tool payloads now carry a status that the registry maps to `success`.
    - `ExecutionService` is kept as a thin wrapper over the new runner for the Ink approval path and is deleted with Ink in 6.15. F11 is live.
- [x] 2.6 Rebuild search (F12). Files: `src/core/tools/search.ts` (new), `glob.ts`, `grep.ts`, tests.
  - Use ripgrep when present, otherwise a JavaScript walk honoring `.gitignore`, `.ignore`, and configured patterns through `ignore`. Add `ignore` in its own commit first.
  - No silent cap: limits are reported in the output.
  - Verify a match in file 401 of a 1,000-file tree is found by both implementations, and ignored files are skipped by both.
  - **Verification**: `search.test.ts` runs every case against both backends, 20 tests.
    - They cover a match in the last of 1,000 files, root and nested `.gitignore` outside a git repository, hidden files, binary files, and the files and count modes.
    - They also cover a reported limit, a path restriction, and consistent glob meaning, plus ripgrep falling back to the JavaScript engine on a pattern it cannot compile.
    - Mutation probes: not reading ignore files, or restoring a 400-file cap, turns the builtin cases red.
    - A real defect was caught while building it: ripgrep lets the last matching `--glob` win, so exclusions must follow the include glob.
    - `grep` gains `path`, `output_mode`, and a limit of up to 1,000. `glob` gains `path` and a limit of up to 1,000. F12 is live, and `search_code` and `list_files` are routed in 2.7.
- [x] 2.7 Rationalize the tool set (D5). Files: `src/core/tools/builtins.ts`, `src/core/tools/registry.ts`, `src/types/tools.ts`.
  - Add `hidden` and `aliasOf` to registered tools. `list_files` and `search_code` become hidden aliases.
  - `read_file` gains line windows, a long-line cut, and binary refusal.
  - `apply_patch` takes a multi-file unified diff applied all or nothing.
  - Add `git_log`.
  - Remove the five-name `ToolName` union as a source of truth; it stays only as a legacy type.
  - **Verification**: `glob` and `grep` are the only advertised listing and search tools; `list_files` and `search_code` stay callable as hidden aliases with their old argument shapes.
    - `apply_patch` now takes unified diffs only, across several files, with creation and deletion through `/dev/null`. Every hunk is checked before any write, and CRLF is kept. Its old find-and-replace mode duplicated `edit` and is gone; `edit` covers that job.
    - `read_file` reads in line windows within an output budget and says where to continue. It cuts long lines for display while anchoring their full content, and refuses binary files with their size.
    - `git_log` is added.
    - The interim Ink tool path now offers every read-class tool rather than the legacy three names.
    - 6 patch, 5 read, and 2 tool-set tests pass. Mutation probes: writing while planning breaks the all-or-nothing test, and advertising an alias breaks the tool-set test.
- [x] 2.8 Provider hardening (F13, F14, F15, F19). Files: `src/core/providers/*.ts`, tests against the fake server.
  - Add `withRetry`, and `ProviderError` with body text and hints.
  - Add `stream_options.include_usage`.
  - Set Ollama `num_ctx` from configuration or the model's reported context length.
  - Replay reasoning only to the producing family.
  - Remove hardcoded model defaults.
  - Verify: a scripted 429 with `Retry-After: 1` retries once and succeeds; a 400 body appears in the error message; switching from an OpenRouter reasoning model to Anthropic sends no `thinking` block.
  - **Verification**: `src/core/providers/http.ts` holds retries and `ProviderError`.
    - Retries honor `Retry-After` and `retry-after-ms`, and each one reports a `retry` callback.
    - A `ProviderError` carries the provider's own message with keys scrubbed and a hint: `ollama serve`, the key variable, `/compact`, or `/model`.
    - Streams request usage and fall back once when an endpoint rejects `stream_options`.
    - Ollama sends `num_ctx` on every request: the configured value, the model's reported limit capped at 16,384, or 8,192.
    - Ollama streams keep tool calls from any chunk, a defect the fake server exposed in 1.2.
    - Anthropic replays only its own signed thinking and redacted thinking, and reports cache reads and writes in usage.
    - No provider picks a model silently.
    - Every provider takes a retry policy.
    - 12 hardening tests pass.
    - Mutation probes: replaying across families, dropping `num_ctx`, reading tool calls only from the final chunk, and not retrying 429 each turn a test red.
    - F14, F15, and F19 are live. F13, ACP choosing its own provider, is fixed by 2.13.
- [x] 2.9 Build the turn engine (D3; F7, F8, F9). Files: `src/core/agent.ts`, `src/core/tools/dispatch.ts`, `src/types/config.ts` (new loop defaults), tests.
  - Streams every step, with the system prompt first.
  - One assistant message holds the text, reasoning, and all calls.
  - One result per call, including denied and cancelled. Per-call approvals.
  - Concurrent read-only calls; cancellation through a per-run controller.
  - Returns the updated session.
  - Convert the F7 and F8 checks in `audit.test.ts` to live tests.
  - **Verification**: `CoreAgent` streams every step, with the system prompt first and never stored in the session. One assistant message holds the text, the reasoning with its provider family and signatures, and every call.
    - `executeBatch` in `dispatch.ts` gives each call exactly one result.
      - Consecutive reads run concurrently; approvals run one at a time with a built request (summary, diff or command preview, suggested patterns, from `src/core/approval.ts`).
      - A denial or cancellation answers the remaining calls.
      - A denial with feedback continues the turn; one without it ends the turn as refused.
      - The optional per-turn cap answers capped calls.
    - Trust gate removals still answer the call, with a note.
    - Cancellation aborts the stream and keeps the partial text.
    - `RunResult.session` returns the updated conversation.
    - Retries surface as events, and hook failures are notices (F25).
    - The echo stub for a missing provider is gone; that case is an error.
    - Loop defaults are now 50 steps, no per-turn cap, and 30,000 characters.
    - 15 engine tests and 5 harness tests pass; the old tests encoded the removed behavior and were rewritten.
    - Mutation probes: sending the system prompt last, dropping text beside calls, stopping a batch after an approval, and restoring the cap of 5 each turn a test red.
    - F7, F8, F9, and F25 are live.
- [x] 2.10 Build the transcript event log (D4; F17). Files: `src/core/transcript/` (new), `src/services/HistoryService.ts` (reader and index only), tests.
  - Version 2 writer, version 1 reader, a mixed-file reader, and projections to provider messages and Markdown.
  - Secret redaction.
  - `jamcli sessions show` and `jamcli sessions fork` on the command line, beside list, search, and export.
  - Verify a version 1 fixture resumes, and a version 2 session with tool calls resumes with the calls in the next request.
  - **Verification (log)**: `src/core/transcript/` holds the event types, the reader for both formats, `SessionLog` (lazy header, append, fork with a parent pointer, rebuild with usage by model), `TranscriptRecorder` (engine events to log events), the project-filtered index, and the Markdown projection.
    - The engine emits `message` and `approval_decision` events, and tool messages carry the tool name and status, which providers never receive.
    - `HistoryService` and `src/core/session/store.ts` read and write through it, so the interface and headless now append version 2 lines, and version 1 files are read and never rewritten.
    - The index takes the creation time from the session file and lists only the current project's sessions, which fixes `--continue` picking another project's latest session. Search reads message content.
    - D4 in `design.md` now describes one `message` type instead of one type per role.
    - 24 transcript and session tests pass, including `jamcli sessions show`, `fork`, and `export` run as a subprocess.
    - Mutation probes: ignoring version 1 lines, dropping tool calls on write, stamping the creation time at update, trusting a stale index entry, listing other projects, writing the header early, losing the fork's parent, sending the tool name to a provider, fixed three-backtick fences, searching metadata only, writing version 1 from the interface, not recording approvals, starting a window on an orphaned tool result, and not recording tool status each turn a test red.
    - F17 is live.
  - **Verification (redaction)**: `src/core/redact.ts` builds the redactor from the environment and named extras, and `executeBatch` applies it to every result and progress chunk. `CoreAgent` uses the environment's credentials unless the runtime passes its own, which 2.11 extends with configured `key_env_var` names and stored keys.
    - 4 tests: markers name the source, short values and ordinary variables are left alone, and a secret in a command's output is absent from the next request, the surfaced events, and the session file.
    - Mutation probes: not redacting output, not redacting progress, an identity default, not passing the redactor to the batch, no longest-first order, anchoring `PASSWORD`, no minimum length, and ignoring named extras each turn a test red.
- [x] 2.11 Build `createRuntime` (D2). Files: `src/core/runtime/` (new), tests.
  - It is the one place that builds the provider, the full registry (built-ins plus MCP), policy (legacy semantics with F10 fixed), rules, hooks, context management, the trust gate (D21 repairs), and the transcript.
  - `@` references expand in the runtime, not in a surface (F24).
  - **Verification**: `createRuntime` in `src/core/runtime/index.ts` assembles the provider, the registry with MCP server tools (`tools.ts`; read-only hints run without asking, a server that fails or hangs past 10 seconds becomes a notice), the policy (`policy.ts`), rules, hooks, the trust gate, redaction with configured keys and headers (`model.ts`), the system prompt (`prompt.ts`), `@` expansion (`references.ts`), and the session log.
    - Policy: a deny from a flag or a setting wins; `--allow-tool` allows the named tool even where a setting asks, and restricts nothing else (F10); settings and flags for `list_files` and `search_code` apply to `glob` and `grep`; flags naming no tool are reported.
    - A state-changing call allowed without asking is recorded with who allowed it and the rule (`autoApproval` in the dispatcher), so the log explains every change.
    - Model references keep a model id's own colon (`qwen2.5-coder:7b`), where the old headless parser took `qwen2.5-coder` as a provider. A provider that cannot be built is reported by the first turn instead of failing assembly.
    - Trust gate (D21): tool output and the task are escaped and bounded in the classifier prompt (F21), each removal names its own result where reasons could previously attach to the wrong one, and the configured threshold is honored where it was ignored.
    - Context management is deferred to 4.3; the reason is recorded under D2.
    - 7 policy, 9 assembly, and 13 runtime tests against the fake provider server with real tools in temporary projects.
    - Mutation probes: a setting outranking `--allow-tool`, an allow list that denies others, allow outranking deny, ignoring aliases, offering denied tools, running a tool that was not offered, ignoring MCP read-only hints, one failing MCP server aborting assembly, not recording automatic approvals, unredacted references and tool output, expanding binary files, resuming empty, no escaping, no bounding, dropping the threshold, leaving rules out, splitting on any colon, a generic provider error, not recording a model switch, dropping startup notices, and not reporting unknown flags each turn a test red.
    - F21 is live. F24 moves to 2.12 and 2.13, when headless and ACP start using the runtime.
- [x] 2.12 Move headless onto the runtime. Files: `src/cli/run.ts`, `src/cli.ts`, tests.
  - JSON carries `error`, `model`, `provider`, and `permission_denials`.
  - `stream-json` carries tool output and notices.
  - `--allow-tool` allows (F10). Exit code 130 on interrupt.
  - Verify with the fake server: `jamcli -p` edits a file with `--allow-tool edit`, runs a command with `--allow-tool run_command`, and resumes with the tool calls intact.
  - **Verification**: `runHeadless` is now a surface over `createRuntime`: it renders nothing itself and answers each approval request by not making the call, telling the model why and which flag would allow it, and carrying on. The denial is recorded as decided by the mode (`ApprovalDecision.by`), not by a person, and listed in `permission_denials`.
    - The result object gains `type`, `error`, `provider`, `model`, `permission_denials`, and `notices`; `stream-json` adds tool output, progress, approval decisions, retries, and notices. The delegation child parser still reads both.
    - The first interrupt cancels the turn and prints the result with exit code 130; a second one exits at once. `--resume` with an unknown id fails with the path it looked in; `--continue` with no earlier session says so and starts one.
    - Text output keeps stdout for the answer and reports notices and denials on stderr.
    - 7 end-to-end tests run the real command line as a subprocess against the fake server: an edit with `--allow-tool edit` (full tool set with schemas offered, `@a.txt` expanded, approval recorded by flag), a command with `--allow-tool run_command` in `stream-json`, a denied edit that the run survives, `--resume` and `--continue` with tool calls in the next request, a provider error, text output and an unknown resume id, and an interrupt.
    - Mutation probes: approving, denying without an explanation, recording the denial as the user's, no interrupt handler, exit 1 on cancel, no denials, no tool output, hidden notices, no provider, no error, ignoring `--resume`, and dropping `--allow-tool` each turn a test red.
    - F10 is live. The README's headless section describes the new output, exit codes, and flags.
- [x] 2.13 Move ACP onto the runtime (F6). Files: `src/acp/session.ts`, `src/acp/server.ts`, tests. Verify the second prompt of an ACP session reaches the provider with the first exchange in context, the session persists to history, and write tools are offered.
  - **Verification**: `createAcpSession` is a runtime with surface `acp`; the server only renders events and forwards approval requests to the editor. The session id is the runtime's, so it names the session file.
    - Tool results are matched to their calls by call id; the server used to match by tool name, so two calls to one tool in a step both reported against the last. Sessions are closed when the client disconnects, which stops their MCP servers.
    - 3 tests drive the real server with runtime sessions against the fake server: two prompts with the first exchange in the second request and the session recorded as `acp`; write tools offered, an edit approved in the editor and recorded as the user's, `@a.txt` expanded, and each concurrent call keeping its own id; and a configured OpenAI-compatible provider used instead of Ollama. One more checks that sessions are closed on disconnect.
    - Mutation probes: inventing a session id, matching results by tool name, not closing sessions, forcing Ollama, a fresh session per prompt, and approving without asking the editor each turn a test red.
    - F2, F3, F6, F13, and F24 are live, each driving the headless and ACP surfaces in process. F23 now waits only on 3.5, since MCP tools reach every surface through the runtime.
- [x] 2.14 Move delegation children onto the runtime. Files: `src/core/tools/task.ts`, `src/core/delegation/`. Verify a child can edit under the delegated policy and cannot widen it.
  - **Verification**: children are runtimes in the same process (`src/core/runtime/children.ts`), launched through `ToolContext.delegate`. The behavior is recorded under D2.
    - They replace subprocess children, which had three defects: their depth was never passed down, so nesting was unbounded; the category table was never given to them; and since 2.12 they could not edit, because a headless child cannot ask.
    - A nested approval travels through `ToolContext.requestApproval` to the parent's surface, scoped under the parent call's id.
    - The task tool counts only running background tasks against the concurrency limit, where finished ones used to count until collected. It keeps streamed text whole instead of joining fragments with newlines, and reports partial output on cancel. The `task` description lists the categories in effect.
    - 7 tests against the fake server:
      - A child edits under an inherited `--allow-tool edit` on its own model and session, recorded as `child` and naming its parent.
      - A child's edit that the parent would ask about reaches the parent's surface as `t1/e1`.
      - A child cannot widen an inherited deny or ask.
      - Depth is bounded, and an unknown category names the real ones.
      - Cancelling the parent cancels the child.
      - Background tasks report status, results, and partial output on cancel.
      - Finished tasks free their slot.
    - Mutation probes, each turning a test red:
      - ignoring the parent's policy;
      - never asking the parent;
      - unscoped nested ids;
      - not incrementing depth;
      - counting finished tasks;
      - hiding partial output;
      - inheriting the parent's model;
      - not passing the signal;
      - not recording the parent;
      - not describing categories;
      - an unknown category that names nothing.
- [x] 2.15 Lazy entry point. Files: `src/index.tsx`. Dispatch on arguments before importing the interface. Verify `--version` median at or under 120 ms here (the 60 ms budget is enforced after stage 6's build change).
  - **Verification**: `src/index.tsx` has no static imports. `--version` loads only `src/core/version.ts`, the command surfaces load `src/cli.ts` without the interface, and a bare `jamcli` loads `src/tui/start.tsx` with React and Ink. `--version` in both `src/index.tsx` and `src/cli.ts` prints `JAMCLI_VERSION`, where `cli.ts` printed `npm_package_version` or a hard-coded `1.0.0`.
    - `--version`, median of 7 runs here, before and after:
      - `node dist/index.js`: 503 ms to 41 ms.
      - `bun src/index.tsx`: 271 ms to 19 ms.
      - `bun dist/index.js`: 252 ms to 19 ms.
    - The floors are `node -e 0` at 29 ms and `bun -e 0` at 5 ms, so both runners already meet the 60 ms budget.
    - The interface still renders from the bundle under Node and from the sources under Bun, checked in a pseudo-terminal.
    - 3 tests: the entry has no static imports, `--version` and `-v` print the recorded version, and `--help` reaches the command line.
    - Mutation probes: a static import of the interface, and a wrong version, each turn a test red.
- [x] 2.16 The conformance test for one runtime. Files: `src/core/runtime/__tests__/surfaces.test.ts`. Drive the same scripted session through the headless and ACP assemblies and the interface's runtime factory call, and assert identical tool lists, provider requests, and transcripts.
  - **Verification**: the interface's factory call is `createInterfaceRuntime` in `src/tui/runtime.ts`, which stage 6 renders from.
    - The same scripted conversation runs through `runHeadless` with `--allow-tool edit`, `createAcpSession` with the editor allowing, and `createInterfaceRuntime` with the user allowing. The conversation has two concurrent reads (one from an MCP server), an edit, an `@` reference, and a rules file.
    - The provider requests are identical on all three, and so are the transcripts once session ids, timestamps, and the deciding surface are set aside. A second test checks that each surface records itself as the decider: `headless` by flag, `acp` and `tui` by the user.
    - Mutation probes, each turning a test red:
      - ACP choosing its own model;
      - headless hiding a tool;
      - the interface bounding its steps;
      - the prompt naming the surface;
      - ACP skipping references;
      - the interface allowing by flag.

The Ink interface keeps running on its existing paths until stage 6; the checks above
cover headless, ACP, and delegation.

## Stage 3: Permission modes and sandbox

- [ ] 3.1 The rule engine (D6). Files: `src/core/permissions/` (new), tests.
  - Pattern parsing and matching for path, command, domain, and MCP rules.
  - Compound command splitting, where substitution always asks.
  - Scopes and precedence, and provenance on every decision.
  - Legacy `mcp.json` mapping.
- [ ] 3.2 Modes. Files: `src/core/permissions/modes.ts`, runtime wiring, tests. `plan`, `default`, `accept-edits`, `auto` (refused without a sandbox), and `bypass` (flag or confirmation, recorded).
- [ ] 3.3 Grants. Files: runtime, `src/core/permissions/grants.ts`. Session grants and project grants written to `.jamcli/config.local.json`, with suggested patterns derived from the call.
- [ ] 3.4 The sandbox adapters (D7). Files: `src/core/sandbox/` (new).
  - bubblewrap with a read-only root, writable project and temporary directory, hidden credential paths, and network off by default.
  - A Seatbelt profile generator, and `none`.
  - Detection and the reported kind.
- [ ] 3.5 The minimal environment for every subprocess (commands, hooks, MCP servers, language servers). Files: `src/core/sandbox/env.ts`, `src/services/McpManager.ts`. Verify a provider key in the parent environment is absent in a spawned command and an MCP server.
- [ ] 3.6 Sandbox escape tests. Files: `src/core/sandbox/__tests__/escape.test.ts`. Under bubblewrap, reading `~/.ssh`, writing outside the project, network access, and reading a provider key all fail. Skipped with a stated reason when bubblewrap is absent.
- [ ] 3.7 Seatbelt live check on macOS. Stays unchecked until run on a Mac: run the escape suite there and record the output here.
- [ ] 3.8 Headless flags. Files: `src/cli.ts`. Add `--permission-mode`, `--allowed-tools`, `--disallowed-tools`, `--dangerously-bypass-permissions`, and `--dry-run` (plan mode plus a report of what would have changed).

## Stage 4: Models, cost, and context

- [ ] 4.1 The model catalog (D9). Files: `src/core/catalog/` (new), `catalog.json`, tests. Sources are configuration, provider metadata (OpenRouter, Ollama `/api/show`, Anthropic, and OpenAI), the bundled table, and defaults. Metadata is cached for a day.
- [ ] 4.2 The cost ledger. Files: `src/core/catalog/cost.ts`, runtime, transcript. Cost per request, per session, and per model. Unknown prices are reported as unpriced.
- [ ] 4.3 Context management v2 (D10; F20). Files: `src/core/context/`, tests. On by default, budgets from the catalog, estimates corrected by reported usage, pair-safe compaction, `/compact [focus]`, and a fallback that is reported.
- [ ] 4.4 Anthropic caching and thinking (D8). Files: `src/core/providers/anthropic.ts`, tests. Load the `claude-api` skill before editing for current model identifiers, caching rules, and thinking signatures.
- [ ] 4.5 Optional: an OpenAI Responses API adapter. If it does not land, record the gap in `docs/feature-matrix.md`.

## Stage 5: Configuration, credentials, observability, command line

- [ ] 5.1 Layered configuration (D11). Files: `src/core/config/` (new), `src/services/ConfigService.ts`, tests. Layers and provenance; Zod schemas with generated `docs/config.schema.json`; lazy `.jamcli/` creation with a self-ignoring `.gitignore` (F18); `jamcli config get|set|list|migrate`.
- [ ] 5.2 Credentials (D12). Files: `src/core/config/credentials.ts`, `src/cli/auth.ts`, tests. Keychain adapters, a `0600` file fallback, `jamcli auth`, and OpenRouter PKCE login tested against a fake authorization server.
- [ ] 5.3 Logs and traces (D13). Files: `src/core/observe/` (new), `src/cli.ts`. Structured logs, `-v` and `-vv`, `--log-file`, and `--trace-file`.
- [ ] 5.4 The OpenTelemetry exporter. Files: `src/core/observe/otlp.ts`, tests with an in-memory collector. GenAI attributes, content excluded by default, off by default.
- [ ] 5.5 `jamcli doctor`. Files: `src/cli/doctor.ts`. Checks provider reachability, models, ripgrep, sandbox kind, git, `gh`, MCP servers, language servers, keychain, and configuration errors, each with a fix.
- [ ] 5.6 Performance measurement in CI (D24). Files: `.github/workflows/ci.yml`, `scripts/bench/`. Record startup and headless overhead. Budgets that cannot pass before stage 6's build change are recorded but not enforced yet.

## Stage 6: The interface on OpenTUI

- [ ] 6.1 Benchmark before. Files: `scripts/bench/pty-latency.py`, this file. Record keystroke echo latency and frame sizes for the Ink interface on a 1,000-message session.
- [ ] 6.2 Add `@opentui/core` and `@opentui/react` at exact versions, in their own commit. Run `npx skills add anomalyco/opentui --skill opentui` for reference material, and do not commit what it installs unless it belongs in the repository.
- [ ] 6.3 The view reducer. Files: `src/tui/state/` (new), tests. Runtime events reduce to view state (transcript rows, tool blocks, pending approval, status line data) as a pure function.
- [ ] 6.4 The app shell. Files: `src/tui/app/` (new). Header, transcript scroll box with windowing, composer, and status line, all driven by the runtime.
- [ ] 6.5 Tool blocks, diffs, Markdown, and code highlighting.
- [ ] 6.6 The permission prompt with grants (D6), and the bypass confirmation.
- [ ] 6.7 Slash commands and the command palette. Every command in the current surface works, plus the ones added by D5, D6, D9, D10, and D15.
- [ ] 6.8 Overlays: model picker (with catalog data), session picker, help, configuration, and themes.
- [ ] 6.9 Keybindings file, themes, `NO_COLOR`, screen reader mode, and reduced motion.
- [ ] 6.10 Onboarding on first run.
- [ ] 6.11 Status indicator styles ported: built-in and custom styles keep working.
- [ ] 6.12 Snapshot tests. Files: `src/tui/__tests__/`. Frame text of the empty session, a streaming reply, a tool block, a diff, the permission prompt, screen reader mode, and `NO_COLOR`.
- [ ] 6.13 Build change. Files: `package.json`, `scripts/`. `bun build` replaces `tsup`, with a `bun` banner. Remove `tsup` in its own commit.
- [ ] 6.14 Benchmark after. Run the same harness on OpenTUI and record the numbers here next to 6.1's.
- [ ] 6.15 Remove Ink. Delete the Ink interface, `ink`, `ink-text-input`, `src/services/LLMProvider.ts`, the sensor's tool gate, and every remaining legacy path. Record the type error count, which is expected to reach 0.
- [ ] 6.16 Boot and exercise. Run the interface in a pseudo-terminal, exercise every slash command, one approval, one rejection, `/resume`, `/compact`, `/undo` after stage 7, and a mode switch, and record the result.

## Stage 7: Git workflows

- [ ] 7.1 Checkpoints (D15). Files: `src/core/git/checkpoints.ts`, tests. Temporary-index tree snapshots on a private ref, and file backups outside git. Verify the user's index, HEAD, and stash are untouched.
- [ ] 7.2 `/undo` and `/rewind`, with a preview and restore choices for code, conversation, or both.
- [ ] 7.3 `/diff` with hunk stage, unstage, and revert.
- [ ] 7.4 The commit path: `git_commit` and `/commit`, the dedicated approval, and attribution off by default.
- [ ] 7.5 `/pr` through `gh`, with push and creation approved separately.
- [ ] 7.6 Worktrees: `--worktree` and `task(isolation: "worktree")`.

## Stage 8: Commands, skills, and hooks

- [ ] 8.1 Add `yaml` in its own commit. Custom commands (D16). Files: `src/core/ext/commands.ts`, tests.
- [ ] 8.2 Agent Skills. Files: `src/core/ext/skills.ts`, the `skill` tool, tests against the specification's examples.
- [ ] 8.3 User hooks (D17). Files: `src/core/hooks/commands.ts`, tests. The protocol, decisions, `updated_input` re-validation, sandboxing, and the project trust confirmation.
- [ ] 8.4 Surface them: the `/skills`, `/hooks`, and `/commands` views, and `jamcli skill list`.

## Stage 9: Protocol adapters

- [ ] 9.1 The JSON-RPC layer with both framings. Files: `src/core/protocols/jsonrpc/`, property tests.
- [ ] 9.2 MCP v2. Add `@modelcontextprotocol/client` in its own commit, then:
  - negotiation, with the fallback path documented if needed;
  - OAuth with PKCE, the issuer check, and keychain tokens;
  - elicitation, prompts as commands, and resources as references;
  - tool search for large tool sets.
  - Conformance against reference servers.
- [ ] 9.3 ACP on the official SDK. Add `@agentclientprotocol/sdk` in its own commit, then:
  - `session/load`, `session/set_mode`, plans, available commands, and diffs;
  - the editor's file system and terminals when offered;
  - schema validation of every message in tests.
  - Move the ACP client to the SDK.
- [ ] 9.4 The LSP client. Files: `src/core/lsp/`, the `lsp` tool, tests against a scripted server, and a smoke test against `typescript-language-server` when present.
- [ ] 9.5 `docs/conformance.md` lists every standard with its status, its test, and the reason for any gap.

## Stage 10: Plugins

- [ ] 10.1 Add `semver` in its own commit. The manifest schema and validation (D18). Files: `src/core/plugins/manifest.ts`, tests.
- [ ] 10.2 Install, lockfile, integrity hash, and consent. Files: `src/core/plugins/install.ts`, `src/cli/plugin.ts`, tests with a local git fixture.
- [ ] 10.3 The lifecycle: `list`, `enable`, `disable`, `update` (with a permission difference), `remove`, and `verify`.
- [ ] 10.4 Contribution loading: commands, skills, hooks, and MCP servers, sandboxed with declared permissions.
- [ ] 10.5 Hostile plugin tests: a network attempt, an environment leak, a write outside the project, and a tampered file failing `verify`.

## Stage 11: Workflows

- [ ] 11.1 The workflow schema, graph validation, and expression grammar (D19). Files: `src/core/workflows/`, tests.
- [ ] 11.2 The engine: step states, concurrency cap, `continue_on_error`, the run log, and resume.
- [ ] 11.3 Step kinds: `agent`, `run`, `tool`, `approval`, `commit`, and `workflow`.
- [ ] 11.4 Triggers: `run`, `hook install`, and `schedule` for crontab, launchd, and Windows tasks, each tested by the file it writes.
- [ ] 11.5 Surface it: `/workflows`, approval prompts in the interface, and `jamcli workflow approve`.

## Stage 12: Hardening, documentation, release

- [ ] 12.1 Performance budgets enforced (D24).
- [ ] 12.2 Security review of the whole diff, with findings fixed or recorded.
- [ ] 12.3 CI on Linux, macOS, and Windows. The e2e, conformance, performance, and security jobs. Actions pinned by SHA.
- [ ] 12.4 Documentation. Files: `README.md` and `docs/`:
  - getting started, configuration, permissions and sandbox, tools, providers, sessions;
  - commands, skills, hooks, plugins, workflows;
  - protocols, headless use, the interface, security;
  - the feature matrix and conformance matrix brought to their final state.
- [ ] 12.5 `docs/migration.md` and `docs/CHANGELOG.md`.
- [ ] 12.6 The release workflow and `bun run compile`. Build every target here, record the checksums, and smoke-test the Linux binary.
- [ ] 12.7 The live local check: with the network disabled and Ollama as the only provider, confirm model listing, a tool-using turn, an edit with approval, and a command. Record where it was run.
- [ ] 12.8 Archive. Apply the deltas to `openspec/specs/jamcli/spec.md`, move the change to the archive, run `openspec validate --all --strict`, and update `SEQUENCE.md`.
