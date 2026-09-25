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

- [x] 3.1 The rule engine (D6). Files: `src/core/permissions/` (new), tests.
  - Pattern parsing and matching for path, command, domain, and MCP rules.
  - Compound command splitting, where substitution always asks.
  - Scopes and precedence, and provenance on every decision.
  - Legacy `mcp.json` mapping.
  - **Verification**: `src/core/permissions/` holds the engine and its parts:
    - `glob.ts`: standard globs, where `*` stays in a segment.
    - `command.ts`: splits commands on every operator and finds hidden code and redirections.
    - `rules.ts`: parses and matches rules.
    - `subjects.ts`: works out the paths, command parts, and domains a call touches.
    - `modes.ts`: the mode table and its preconditions.
    - `engine.ts`: decides.
    - `config.ts`: loads rules from every scope, with sources.
  - The precedence and the other details it settles are recorded under D6.
  - The todo list is now class `state` and starting or cancelling a task is `delegate`, per D5. Nothing uses the classes until 3.2 wires the engine in.
  - 18 tests cover:
    - precedence across scopes;
    - path rules with links and case;
    - prefixes and compound commands;
    - substitution and redirections;
    - every mode and its preconditions;
    - offering tools;
    - MCP wildcards, aliases, and patches;
    - unknown tools;
    - the loader across scopes with the legacy mapping and mode precedence;
    - flag lists.
  - 21 mutation probes each turn a test red. One, a flag outranked by the environment, first slipped through and got its own case.
- [x] 3.2 Modes. Files: `src/core/permissions/modes.ts`, runtime wiring, tests. `plan`, `default`, `accept-edits`, `auto` (refused without a sandbox), and `bypass` (flag or confirmation, recorded).
  - **Verification**: the runtime builds its tools and dispatcher on the engine (`src/core/runtime/permissions.ts`), and the stage 2 policy is removed. The dispatcher returns one verdict per call, with who decided and why, in place of three separate answers. `Runtime.setPermissionMode` switches modes and rebuilds what is offered and the prompt. The behavior is recorded under D6.
    - Mode reasons name the mode and what the tools do, such as `default mode asks before tools that change files`, and flag rules keep their text (`edit`) with the source in the reason.
    - A test preload gives every run its own user configuration and state directories.
    - 5 runtime tests:
      - plan mode offers only reads and the plan, and says why;
      - a switch changes what is offered and asked, and is recorded;
      - `auto` needs a sandbox;
      - `bypass` starts only from the flag and is recorded;
      - a session grant stops its prompts.
    - 3 batch tests: a policy denial goes on with the step, only a person's denial stops it, and only changes are recorded.
    - Mutation probes, each turning a test red:
      - no plan note;
      - keeping the old tools after a switch;
      - not recording the switch;
      - keeping an unmet mode;
      - `bypass` from a file;
      - ignoring grants;
      - a policy denial stopping the step;
      - any denial stopping it;
      - recording the plan;
      - leaving the mode off the session line;
      - children deciding alone.
- [x] 3.3 Grants. Files: runtime, `src/core/permissions/grants.ts`. Session grants and project grants written to `.jamcli/config.local.json`, with suggested patterns derived from the call.
  - **Verification**: suggested patterns (`suggestPatterns` in `src/core/approval.ts`) are written in the engine's rule syntax:
    - A compound command gets a rule for each part, joined into one grantable list.
    - The prefix forms end in ` *`, so they also match the bare command.
    - A command with hidden code gets no suggestion, since it always asks.
    - A patch gets rules for its files and directories.
  - A session grant adds rules to the engine. A project grant also writes them to `.jamcli/config.local.json` under `permissions.allow`, keeping the rest of the file, with the directory created ignoring itself. If the file cannot be written, the grant still holds for the session and a notice says why.
  - 4 tests:
    - the suggestions for commands, patches, paths, and MCP tools;
    - every suggestion, once granted, allows its own call;
    - a project grant is saved, holds for the rest of the session, and holds in the next one;
    - an unsaveable grant holds for the session with a notice.
  - Mutation probes, each turning a test red:
    - suggesting the whole command;
    - suggesting for hidden code;
    - not writing the grant;
    - not applying it at once, which first slipped through and got its own case;
    - losing the file's other settings;
    - not splitting lists;
    - forgetting an unsaveable grant.
- [x] 3.4 The sandbox adapters (D7). Files: `src/core/sandbox/` (new).
  - bubblewrap with a read-only root, writable project and temporary directory, hidden credential paths, and network off by default.
  - A Seatbelt profile generator, and `none`.
  - Detection and the reported kind.
  - **Verification**: `src/core/sandbox/` holds the adapters and detection:
    - `bwrap.ts`: bubblewrap arguments.
    - `seatbelt.ts`: the Seatbelt profile.
    - `detect.ts`: a probe that really starts the sandbox, cached, with the reason for `none`.
    - `paths.ts`: the hidden paths.
  - The runtime detects the sandbox, or takes one it is given. It reports it as `Runtime.sandbox`, wraps every command in it, and tells the permission engine whether `auto` can apply. The behavior is recorded under D7.
  - 4 adapter tests:
    - the bubblewrap mounts and their order;
    - the Seatbelt profile, with quoting and rule order;
    - detection outcomes;
    - a real sandboxed command that writes the project, whose `/tmp` writes never reach the real file system, and whose write to the home directory fails with the sandbox named.
  - 1 runtime test: commands run in the detected sandbox.
  - Mutation probes, each turning a test red:
    - a writable root;
    - hidden mounts before the writable binds;
    - the network always off;
    - credentials not hidden;
    - Seatbelt denies before its allows;
    - unquoted Seatbelt paths;
    - the Seatbelt network always on;
    - ignoring `sandbox.enabled`;
    - the runtime not wrapping;
    - no note on failure;
    - the engine never sandboxed.
  - The first mount-order probe was built wrong and slipped through; it was redone as a real swap.
- [x] 3.5 The minimal environment for every subprocess (commands, hooks, MCP servers, language servers). Files: `src/core/sandbox/env.ts`, `src/services/McpManager.ts`. Verify a provider key in the parent environment is absent in a spawned command and an MCP server.
  - **Verification**: `subprocessEnv` in `src/core/sandbox/env.ts` builds the environment for:
    - the runtime's commands;
    - MCP stdio servers, with their entry's `env` and `env_passthrough`;
    - external ACP agents, with the same two fields.
  - Hooks and language servers do not start processes yet; stages 8 and 9 use the same function. The default policy and its reason are recorded under D7.
  - Inside bubblewrap, commands get `TMPDIR=/tmp`, since the sandbox's `/tmp` is its own.
  - 5 tests:
    - the default and minimal policies;
    - named and declared variables;
    - a real stdio MCP server that sees no provider key unless its entry names it;
    - a command run through the runtime that sees no key, even one named by a custom `key_env_var`, but keeps `JAVA_HOME` and a passthrough.
  - An external agent is checked the same way through the fake agent.
  - Mutation probes, each turning a test red:
    - passing credentials;
    - ignoring withheld names;
    - ignoring passthrough;
    - dropping declared values;
    - MCP servers, agents, or commands getting everything;
    - not withholding the configured key variables.
  - F23 is live.
- [x] 3.6 Sandbox escape tests. Files: `src/core/sandbox/__tests__/escape.test.ts`. Under bubblewrap, reading `~/.ssh`, writing outside the project, network access, and reading a provider key all fail. Skipped with a stated reason when bubblewrap is absent.
  - **Verification**: a hostile command plants credentials in a fake home, serves a TCP port on the host loopback, and listens on Unix sockets outside `/tmp`. It then tries to:
    - read `~/.ssh`, `~/.aws`, and `~/.netrc`;
    - write to the home directory, `/var/tmp`, and `/etc`;
    - reach the loopback port;
    - read a key from the parent environment;
    - reach an SSH agent and a hidden daemon socket.
  - All five fail under bubblewrap here, and the project stays writable. Without bubblewrap the suite is one skipped test whose name gives the reason.
  - The suite found that Unix sockets were reachable through the read-only root. The fix is recorded under D7, and the PID namespace is now asserted in the adapter test.
  - The first socket probe misread a connection the server reset as blocked, so it passed even without the fix. It now counts a connection or a reset as reached.
  - Mutation probes, each turning a test red:
    - visible credentials;
    - a writable root;
    - the network on;
    - an unscrubbed environment;
    - a reachable agent socket;
    - a shared process tree;
    - `/run` left in place.
- [ ] 3.7 Seatbelt live check on macOS. Stays unchecked until run on a Mac: run the escape suite there and record the output here.
- [x] 3.8 Headless flags. Files: `src/cli.ts`. Add `--permission-mode`, `--allowed-tools`, `--disallowed-tools`, `--dangerously-bypass-permissions`, and `--dry-run` (plan mode plus a report of what would have changed).
  - **Verification**: the flags reach the runtime. `--dry-run` works as recorded under D6: each call that would change something is answered as not made and reported with its preview, after the answer in text, or under `dry_run` in JSON.
  - The JSON result adds `permission_mode` and `sandbox`, and the entry point treats every new flag as a command-line intent. The README describes the flags, modes, dry runs, the sandbox, and the scrubbed environment.
  - 4 end-to-end tests:
    - a dry run leaves the file and the file system untouched, still runs the read, and reports the edit's diff and the command;
    - a dry run in text prints its report;
    - plan mode hides `edit`, and a disallowed rule denies inside an allowed one;
    - bypass edits without asking, and an unknown mode is reported with the valid ones.
  - Mutation probes, each turning a test red:
    - ignoring `--dry-run`;
    - a dry run that stops reads;
    - no preview;
    - no text report;
    - dropping the mode, the disallowed rules, or the bypass flag.

## Stage 4: Models, cost, and context

- [x] 4.1 The model catalog (D9). Files: `src/core/catalog/` (new), `catalog.json`, tests. Sources are configuration, provider metadata (OpenRouter, Ollama `/api/show`, Anthropic, and OpenAI), the bundled table, and defaults. Metadata is cached for a day.
  - **Verification**: the catalog is built as recorded under D9. Each provider describes one model from its own route against the fake server:
    - Ollama's context length and capabilities;
    - an OpenRouter entry's limits, capabilities, and prices, with free kept as a price and a varying price left out;
    - the context window under Groq's, Mistral's, and vLLM's names;
    - Anthropic's limits and thinking style, with a zero limit read as unknown;
    - one attempt only, even for a failure a chat request would retry.
  - The catalog tests cover:
    - the order of sources for each fact, and the source recorded;
    - the bundled row applying whole, an alias reaching its dated row, and a gateway getting limits without prices;
    - the default window and an unpriced model;
    - Ollama's window from each setting, the cap, and zero cost;
    - the day-long cache across sessions, per endpoint, with failures never kept;
    - an unreadable cache, a provider that does not answer in time, and every mistake in the `models` block reported by name;
    - the bundled table against the published price multipliers.
  - Through the runtime:
    - Anthropic requests carry `max_tokens` from the model's metadata, capped by `agent_loop.max_output_tokens`;
    - Ollama requests carry the catalog's `num_ctx`, from a model entry or `api_registry.ollama.num_ctx`;
    - an unknown window is named once, with its setting, except for Ollama;
    - a switch sizes the next request, and a late answer about the previous model is dropped;
    - a reply cut off at the output limit is reported in all three wire formats.
  - Found and fixed on the way: `cancel()` reached the current agent, so after a mid-turn switch rebuilt it, the running turn could not be cancelled. A test now cancels after a mode switch.
  - OpenAI rows are absent because this environment blocks openai.com, as recorded under D9. The gap is recorded in `docs/feature-matrix.md`.
  - 62 mutation probes, each turning a test red, across the provider parsers, the catalog, the runtime wiring, the notice, and the cancel fix.
- [x] 4.2 The cost ledger. Files: `src/core/catalog/cost.ts`, runtime, transcript. Cost per request, per session, and per model. Unknown prices are reported as unpriced.
  - **Verification**: built as recorded under D9. Pricing is tested for fresh input, cache reads, cache writes, and output, in both the Anthropic and the OpenAI accounting, with a missing cache price charged as input.
  - The ledger tests cover:
    - each model kept apart, in the order used;
    - unpriced requests counted apart;
    - delegated spend visible;
    - a summary that is a copy;
    - a rebuild from a log, priced as it was.
  - Through the runtime:
    - a request's cost is on its usage event and in the log;
    - a continued session keeps what it spent although the price changed since;
    - an Ollama model costs zero, an unknown price is counted apart, and each model keeps its own;
    - the trust gate's requests count under the classifier's model, in the log as well;
    - a child's, a grandchild's, and a background child's requests reach the delegating session under the session that made them, and stay out of its own token totals.
  - Headless JSON carries `total_cost_usd`, `unpriced_requests`, `model_usage`, and `delegated`, with `null` for a cost none of whose requests had a price. Stream `usage` events carry `model` and `cost_usd`, and an export states the cost and marks each request.
  - The fake server now reports cache reads and writes the way each API does, and serves a scripted turn to one model only, so sessions running at once each get their own turns.
  - 41 mutation probes, each turning a test red, across pricing, the ledger, the runtime, delegation, the log, headless JSON, and exports.
- [x] 4.3 Context management v2 (D10; F20). Files: `src/core/context/`, tests. On by default, budgets from the catalog, estimates corrected by reported usage, pair-safe compaction, `/compact [focus]`, and a fallback that is reported.
  - **Verification**: built as recorded under D10, including the unknown-window decision. The module tests cover:
    - the estimate over text, reasoning, tool calls, the system prompt, and the tool definitions;
    - a correction learned within its range;
    - the budget arithmetic;
    - where a cut falls;
    - 200 random conversations cut at five sizes, with no tool result ever parted from its call;
    - a summary with its focus and bounded tool output;
    - the fallback, an empty summary, a request kept verbatim and carried over, cancellation, and the words providers use to refuse a request.
  - Through the runtime:
    - a turn that outgrows the window is summarized between steps, the next request starts from the summary with no orphaned result, the log rebuilds the same conversation, and the summary request is counted;
    - a failed summary leaves the older steps out and says so;
    - `compact(focus)` sends the focus, keeps the latest turn, and refuses while a turn runs;
    - a model with a guessed window is compacted only when refused, and retried once, not twice;
    - a context that compaction cannot bring under the threshold is reported once;
    - `auto_compact: false` compacts nothing;
    - the estimate learns from OpenAI's counts and not from Ollama's.
  - F20 is live: an agent turn compacts mid-turn, and every request, the summary's included, carries each result with its call. The legacy interface's manager was fixed the same way; its two new tests fail without the fix.
  - 35 mutation probes, each turning a test red, across the estimate, the budget, the cut, the summary, the agent loop, the log, and the runtime.
- [x] 4.4 Anthropic caching and thinking (D8). Files: `src/core/providers/anthropic.ts`, tests. Load the `claude-api` skill before editing for current model identifiers, caching rules, and thinking signatures.
  - **Verification**: built as recorded under D8. The `claude-api` skill was not available when the work began, so the edits followed Anthropic's documentation read the same day. The skill, loaded afterwards, agrees on every rule used, and it named one more gap, refusals, which is now covered.
  - Tests:
    - a temperature is sent only to a budget-style model that is not thinking, and the default profile's 0.7 no longer reaches a current model;
    - thinking for each style and level, including the models that reject turning it off;
    - the three cache breakpoints, never on thinking or empty text;
    - the one retry without `cache_control`;
    - signed thinking replayed within a turn and dropped after a mode switch, a continued session, a requested compaction, a rebuilt agent, and a compaction in the middle of a turn;
    - a declined reply is reported.
  - The temperature and refusal tests fail with their changes reverted. 24 mutation probes, each turning a test red, across thinking, caching, and replay.
- [x] 4.5 Optional: an OpenAI Responses API adapter. If it does not land, record the gap in `docs/feature-matrix.md`.
  - **Verification**: it did not land, because OpenAI's documentation is blocked from this environment, as recorded under D8. The gap is recorded in `docs/feature-matrix.md`.

## Stage 5: Configuration, credentials, observability, command line

- [x] 5.1 Layered configuration (D11). Files: `src/core/config/` (new), `src/services/ConfigService.ts`, tests. Layers and provenance; Zod schemas with generated `docs/config.schema.json`; lazy `.jamcli/` creation with a self-ignoring `.gitignore` (F18); `jamcli config get|set|list|migrate`.
  - **Verification**: built as recorded under D11.
  - Tests:
    - the checked-in JSON schema matches the one generated, and a configuration using every section is accepted as written;
    - a value that does not fit is named by file, key, and shape, never by its value, and the rest of the file still applies;
    - each layer overrides the ones below with its origin recorded, objects merge, the permission lists add up, and other lists replace;
    - the permission engine reads the same layers, and a deny in the user's configuration holds in every project;
    - profiles merge across the user's and the project's files, and a missing one is named;
    - loading writes nothing, and neither does starting a session;
    - through the runtime, the user's configuration serves a project with none, and `--model` beats `JAMCLI_MODEL`, which beats the files;
    - `jamcli config`: scopes, JSON values, refusals that change nothing, the precedence warning, hidden keys, unset, a file that cannot be parsed never overwritten, and a migration whose rules decide every call as the legacy block did.
  - F18 is live: in a git repository, starting a session writes nothing, the first stored file creates `.jamcli/` ignoring itself, `git status` stays clean, and a directory an earlier version created without the file gets it. The todo tool, `jamcli mcp`, and the legacy writers each have a test that fails without the change.
  - 35 mutation probes, each turning a test red, across the validator, the loader, the writers, the runtime wiring, and the command.
  - Found along the way: a reply dated in the millisecond of a prefix change lost its signed thinking, which failed a stage 4 test about one run in ten. Fixed, with a test that fails without the fix, as recorded under D8.
- [x] 5.2 Credentials (D12). Files: `src/core/config/credentials.ts`, `src/cli/auth.ts`, tests. Keychain adapters, a `0600` file fallback, `jamcli auth`, and OpenRouter PKCE login tested against a fake authorization server.
  - **Verification**: built as recorded under D12.
  - Tests:
    - the file store's modes, and the keychain and Secret Service adapters run through fake `security` and `secret-tool` executables, with no key ever in an argument;
    - a keyring that cannot be reached is reported, not taken for an empty one;
    - which store each platform gets, and the variable that chooses one;
    - the order of the four sources, and a key stored while a session runs;
    - through the runtime, a stored key authenticates the request and is redacted from a tool result;
    - `jamcli auth`: set, masked get, `--reveal`, remove, list, the warning when another source wins, and refused keys;
    - the sign-in against a fake authorization server: the challenge checked against the verifier, the key stored, `--no-browser`, a callback at any other path turned away, a refused exchange, and a timeout.
  - 16 mutation probes, each turning a test red, across the stores, the order, redaction, and the sign-in.
  - Found along the way: a key not found was remembered as absent for the life of the process. Fixed, with a test.
  - Owed: a sign-in against OpenRouter itself, which this environment cannot reach.
- [x] 5.3 Logs and traces (D13). Files: `src/core/observe/` (new), `src/cli.ts`. Structured logs, `-v` and `-vv`, `--log-file`, and `--trace-file`.
  - **Verification**: built as recorded under D13, including the conflict over `-v`.
  - Tests:
    - levels, lazy files, redaction of every line and span, and the readable echo;
    - spans with their trace, parent, attributes, and time, and a model request's span however its reading ends;
    - each hook run timed, and old logs removed while nothing else is;
    - through the runtime, a turn traced as a session, a turn, two model requests, and a tool call, each under the right parent;
    - prompts and outputs logged only at debug, redacted; a compaction's span; a delegated run inside its parent's trace;
    - end to end through the entry point, `-v` and `-vv` on standard error, the day's log file, and `--trace-file`.
  - 18 mutation probes, each turning a test red but one: removing the entry point's check for a lone `-v` changes nothing, because the command line gives the same answer; it stays as the path that loads less.
- [x] 5.4 The OpenTelemetry exporter. Files: `src/core/observe/otlp.ts`, tests with an in-memory collector. GenAI attributes, content excluded by default, off by default.
  - **Verification**: built as recorded under D13, in about 160 lines, without the OpenTelemetry SDK.
  - Tests, against an in-memory collector:
    - the export request's shape: hex ids, nanosecond times as strings, typed attributes, span kinds, status codes, and the resource from `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`;
    - the endpoint and headers from configuration, then the standard variables;
    - batching, the final flush, and a failing collector reported once;
    - nothing sent unless turned on, even with a collector in the environment;
    - a session's spans with their GenAI attributes and no content, and with `include_content`, content redacted.
  - 12 mutation probes, each turning a test red.
- [x] 5.5 `jamcli doctor`. Files: `src/cli/doctor.ts`. Checks provider reachability, models, ripgrep, sandbox kind, git, `gh`, MCP servers, language servers, keychain, and configuration errors, each with a fix.
  - **Verification**: built as recorded under D14's onboarding note.
  - Tests, with a fake Ollama and a PATH holding only fake programs:
    - a working local setup passes and names what it found;
    - a missing model, an unconfigured provider, a value that does not fit, a key in a project file, missing ripgrep and git, no sandbox, an unreachable collector, and a `.jamcli/` without its `.gitignore`, each with its fix, and the key never shown;
    - an Ollama that is not running, a key the provider refuses, and a credentials file others can read;
    - a collector judged by its answer; MCP servers that start, fail, or are turned off.
  - 12 mutation probes, each turning a test red.
  - Found along the way: Ollama and the Anthropic API answer a missing model with 404, which the providers threw as a failure to ask, against their own contract. Fixed, with the stage 4 tests that pinned the old behavior corrected, as recorded under D9.
- [x] 5.6 Performance measurement in CI (D24). Files: `.github/workflows/ci.yml`, `scripts/bench/`. Record startup and headless overhead. Budgets that cannot pass before stage 6's build change are recorded but not enforced yet.
  - **Verification**: built as recorded under D24. `bun run bench -- --enforce` passes: `--version` about 46 ms against 60, grep about 45 ms against 500. Headless overhead is recorded, not enforced: about 320 ms at first and about 240 ms once the MCP client loads only for a configured server, against 150.
  - Tests: the median, and each verdict (within, over, recorded, not measured), with a miss failing the job only for an enforced budget; the budgets are held to D24's. A session with a configured MCP server still starts it and offers its tools, and one with none makes no client.
  - 3 mutation probes, each turning a test red.
  - **Staged, like 1.1**: the performance job is in `openspec/changes/rehaul-jamcli/workflows/ci.yml`, because workflows cannot be pushed from here.

## Stage 6: The interface on OpenTUI

- [x] 6.1 Benchmark before. Files: `scripts/bench/pty-latency.py`, this file. Record keystroke echo latency and frame sizes for the Ink interface on a 1,000-message session.
  - **Verification**: `python3 scripts/bench/pty-latency.py` writes a 1,000-message session with `scripts/bench/make-session.ts`, opens the built interface in a 120 by 40 pseudo-terminal, resumes the session through `/resume` and the picker, and types 30 keys one at a time, each timed to its first output byte and sized until the screen is quiet for 250 ms. The Ink interface, on Node 22, 2026-09-24:

    | View | First output | Resume | Echo median | Echo p95 | Bytes per key |
    |---|---|---|---|---|---|
    | Latest messages (Ink shows 5 of 1,001) | 636 ms | 1,082 ms | 15.5 ms | 23.1 ms | 16,564 |
    | Full history (Ctrl+R) | 630 ms | 1,097 ms | 14.0 ms | 19.7 ms | 6,810 |

    A run without the session echoed in 11.3 ms at the median, 16.8 ms at p95, with 5,535 bytes a key. The first output is the Ink bundle loading; the p95 misses D24's 16 ms budget in both views.
- [x] 6.2 Add `@opentui/core` and `@opentui/react` at exact versions, in their own commit. Run `npx skills add anomalyco/opentui --skill opentui` for reference material, and do not commit what it installs unless it belongs in the repository.
  - **Verification**: both are pinned at 0.5.12 in a commit of their own. The skill was installed outside the repository and read there; none of it is committed, since it is reference material and not part of JamCLI.
- [x] 6.3 The view reducer. Files: `src/tui/state/` (new), tests. Runtime events reduce to view state (transcript rows, tool blocks, pending approval, status line data) as a pure function.
  - **Verification**: `reduceView` folds each runtime event, and the interface's own actions (send, resume, status, notice, toggle, clear), into rows of five kinds (the person's words, the assistant's reply with its reasoning, tool blocks, notices, and compactions), the queue of pending approvals, and the status line's data. A resumed session's messages rebuild the same rows, each call settled by its result.
  - Tests (8): streaming into one reply that a tool call closes; approvals queued and settled; tokens and cost, with unpriced requests kept apart and a retry shown and then cleared; notices, compactions, and a turn cut short; a resumed conversation; blocks toggling and output held to its last 40 lines and 4,000 characters, streamed or final; an edit's proposed diff and then the one it made; and the reducer never changing the state it was given.
  - 15 mutation probes, each turning a test red. One survived at first, streamed output growing without bound, and got its test.
- [x] 6.4 The app shell. Files: `src/tui/app/` (new). Header, transcript scroll box with windowing, composer, and status line, all driven by the runtime.
  - **Verification**: the header shows the project, the branch, and the session. The transcript is a scroll box that keeps to the bottom and draws only what is in view. The composer sends with Enter and adds a line with Shift+Enter. The status line shows the mode, the model, context use, cost, tokens, the sandbox, MCP servers, and the phase. Every state is a word as well as a color. Ctrl+C stops a running turn, and pressed twice leaves. Escape stops a turn. Shift+Tab moves through the modes available here and never reaches bypass. Ctrl+O opens or closes the last tool block, and Ctrl+L redraws.
  - Tests (5, through OpenTUI's test renderer with the real runtime and the fake provider): a message sent, answered, and counted in the status line; the prompt shown and Escape denying; 1 allowing once, Shift+Tab, and Ctrl+C twice; Markdown and diffs; and Escape stopping a running turn with a notice saying so.
- [x] 6.5 Tool blocks, diffs, Markdown, and code highlighting.
  - **Verification**: a tool block is one line when closed: a mark and a word for its state, what it did, lines added and removed for an edit, how long it took, and who decided when a person did. Open, it shows the diff or the output's tail. Replies render as Markdown with the markers hidden and code highlighted. Diffs render with line numbers, highlighted as the file they change. An edit's diff shows in the prompt before it runs, and in its block, open, after.
  - Tests (3 on the text itself, plus the interface tests above): the tool line in each state, the diff count leaving out file headers, and the status line's parts.
  - 15 mutation probes across 6.4 and 6.5, each turning a test red. One survived at first, a stopped turn ending without a word, and got its test.
- [x] 6.6 The permission prompt with grants (D6), and the bypass confirmation.
  - **Verification**: the prompt offers D6's four choices. 1 allows once. 2 allows the chosen pattern for the session. 3 saves it for the project in `.jamcli/config.local.json`. 4 opens a line for feedback that the model reads with the denial. Up and Down move between the suggested patterns, and Escape denies. `/mode` switches the mode and says why one is refused. Bypass asks the person to type yes, and the status line then shows BYPASS in the error color.
  - Tests (4): a session grant, chosen with Up and Down, that lets the next matching call run unasked, with the moves and the grant pressed together; a project grant written to the local file; feedback reaching the model as the denial; and bypass turned on only by yes, with plan chosen and auto refused for want of a sandbox.
  - 14 mutation probes, each turning a test red.
  - Found along the way: a key pressed as the prompt appeared could be undone by the effect that reset the prompt. Fixed as recorded under D14.
- [x] 6.7 Slash commands and the command palette. Every command in the current surface works, plus the ones added by D5, D6, D9, D10, and D15.
  - **Verification**: typing `/` opens a palette of the commands a prefix could mean: names that start with it first, then names that contain it, aliases included. Up and Down choose, Tab completes, Enter runs the choice, and Escape closes the palette. Every Ink command works here (`/model`, `/profile`, `/resume`, `/tools`, `/categories`, `/config`, `/copy`, `/clear`, `/help`, `/exit`, `/compact`, `/fork`, `/mcp`), with `/mode` and `/permissions` (D6), `/cost` (D9), `/context` and `/compact [focus]` (D10), `/doctor`, and `/export`. D15's `/undo`, `/rewind`, `/diff`, `/commit`, and `/pr` need stage 7's checkpoints and git layer, and stage 8, 10, and 11 add `/skills`, `/hooks`, `/plugins`, and `/workflows`. Until then, typing one says it is not available yet. A command never reaches the model.
  - The runtime gained what `/permissions` stands on: it lists every rule with its scope and source, adds one for the session or to the user, project, or project-local file, and removes one wherever a person can edit it, keeping built-in rules, flags, and the legacy `.jamcli/mcp.json` block and naming them. `/config` and `/mcp` run the same code as `jamcli config` and `jamcli mcp`.
  - Tests: 8 on the rule API, 3 on rule files, 10 on the command text and reports, 9 through the interface (the palette; `/cost`, `/context`, and `/model`; `/permissions`; `/clear`, `/resume`, and `/fork`; waiting for a running turn; `/compact`; `/export` and `/copy`; `/tools`, `/mcp`, `/categories`, `/doctor`, and `/config`; `/profile`), and 1 more on the reducer.
  - 34 mutation probes on the rule API and the commands, each turning a test red but one. Two survived at first and got tests: a rule file rewritten when nothing changed, and the CLI's messages naming `jamcli mcp` where `/mcp` was typed. The last survivor is equivalent: the palette keeps Up and Down from the composer, but on a one-line draft the composer does nothing with them.
- [x] 6.8 Overlays: model picker (with catalog data), session picker, help, configuration, and themes.
  - **Verification**: an overlay opens over the composer with a list the person narrows by typing. It opens on the choice in use. Up, Down, Page Up, and Page Down move; Enter chooses; Escape closes. The composer keeps its draft underneath, and typing never reaches it while the overlay is open.
    - `/model`: every model the configured providers offer, asked all at once with a time limit each, with the catalog's window, tool support, and price as far as they are known. A provider that cannot be asked is named with why.
    - `/resume`: this project's sessions, latest first.
    - `/help` and `?` on an empty composer: the commands and the keys.
    - `/config`: each setting with the file it comes from, through the same code as `jamcli config list`.
    - `/theme`: dark, light, high-contrast, or monochrome, applied at once and saved as `ui.theme` in the user configuration.
    - `NO_COLOR` keeps the interface monochrome, in which every color is the terminal's own.
  - The runtime gained `listModels`, and the configuration gained the `ui` block (`theme`, `screen_reader`, `reduced_motion`) with its JSON schema.
  - Tests: 2 on listing models (four providers' worth with one unreachable, and one that never answers), 1 on the `ui` block, and 6 through the interface: the model picker switching, the session picker opening, help from `?`, the settings list starting a `/config set`, a theme changing the colors and saving, and monochrome drawing every state in one color.
  - 18 mutation probes, each turning a test red. Two survived at first and got tests: the list not opening on the choice in use, and a theme test that compared the colors against the table it was meant to check.
- [x] 6.9 Keybindings file, themes, `NO_COLOR`, screen reader mode, and reduced motion.
  - **Verification**: `keybindings.json` rebinds any of send, newline, interrupt, cycle mode, history, tool detail, todos, redraw, exit, and help. What does not fit is named in the transcript, and the default stands. Ctrl+R searches what was sent before, newest first, this session and then the project's latest 20, and puts the choice in the composer. Ctrl+T shows the todo list the model last wrote. `--screen-reader` or `ui.screen_reader` draws labeled lines with no boxes, marks, or scroll bar, checked in a real pseudo-terminal. `NO_COLOR` means monochrome, and a diff draws in the theme's colors, or none in monochrome. `ui.reduced_motion` is carried to the interface; 6.11's spinner is the part that honors it.
  - Tests: 5 on keys, 3 on themes, 1 on the reducer, 5 through the interface (screen reader mode through a turn, an approval, a denial, and a command; a keybindings file; Ctrl+R across sessions; Ctrl+T; diff colors by theme), and 1 booting the real entry point in a pseudo-terminal with and without `--screen-reader`.
  - 20 mutation probes, each turning a test red. Two survived at first and got tests: a partly bad key list replacing the default, and the flag not reaching the interface.
  - Found along the way: after choosing from an overlay, the next key was lost, because focus came back only when React drew again. Focus now moves at once, and the overlay keeps the Enter that closed it from reaching the composer.
- [x] 6.10 Onboarding on first run.
  - **Verification**: with no user configuration and no model chosen anywhere, the interface opens `/setup`. It lists Ollama's models that call tools, with their window, and says how many cannot call tools. It offers to download the tool-calling coding model that suits the machine's memory, with progress at each quarter, and lists each hosted provider whose key is already set, naming where the key is without showing it. The choice is used at once and saved as `model` in the user configuration only, and the permission modes are explained. With Ollama down, setup says how to start it or which keys to set. Not now saves nothing, and `/setup` opens it again. `jamcli doctor` points to it when no model is chosen.
  - Found along the way: a provider with only an environment key was left out of model listing, and the status line read `ollama:` and a context share when no model was chosen. Both are fixed.
  - Tests: 5 on the survey, the suggestion, the first-run rule, and the pull; 1 on listing a keyed provider; 6 through the interface (choosing a local model, downloading the suggested one, a hosted provider's models, Ollama down, Not now with the status line, and a suggested model already installed). A real first run was booted in a pseudo-terminal with no Ollama.
  - 20 mutation probes, each turning a test red. Two survived at first and got tests: the hosted list not limited to its provider, and the setup note cut to one line.
  - Unverified: the list of models to suggest is from Ollama's library as known when written. ollama.com is not reachable from this environment, so the names and sizes are checked with the live Ollama run owed under 12.7.
- [x] 6.11 Status indicator styles ported: built-in and custom styles keep working.
  - **Verification**: while a turn works, the status line leads with the style's spinner and the phase's words in its colors, and it stops when the turn ends or waits on the person. The five word styles, the six spinners, and custom style files all work, set in `ui.status_text_style`, `ui.status_spinner_style`, and `ui.custom_status_styles` (a relative path is read from the user configuration directory). A style saved by the Ink interface in `~/.jamubc/ui.json` is read, never written, and carries over until the ui block names another. `/style` lists them and saves a choice for every project. Reduced motion and screen reader mode draw no spinner; monochrome keeps the motion without the colors.
  - Tests: 4 on resolving a style (the default, the Ink file carried over and overridden, a custom file and one that cannot be read, a tall spinner's row) and 3 through the interface (the spinner moving in the style's colors and stopping, reduced motion, screen reader mode, and monochrome, and `/style`).
  - 16 mutation probes, each turning a test red. One survived at first and got a test: a tall frame drawn from its first row. Another showed a redundant condition, since screen reader mode already implies reduced motion; it was removed.
- [x] 6.12 Snapshot tests. Files: `src/tui/__tests__/`. Frame text of the empty session, a streaming reply, a tool block, a diff, the permission prompt, screen reader mode, and `NO_COLOR`.
  - **Verification**: `src/tui/__tests__/frames.test.tsx` records the frame text of each named state, plus an overlay, through the OpenTUI test renderer. What changes from run to run (the session id, times, the context share, the spinner frame) is replaced with a stand-in first. The streaming frame is taken while the fake provider holds the stream part-way. The `NO_COLOR` snapshot also records every color on screen, which must be the terminal's own and nothing else, and a further test checks that the light and dark themes draw no text in plain white.
  - Found along the way: OpenTUI draws text given no color in plain white, which a light terminal hides, and a diff's line numbers were a fixed gray. Every theme now has a text color, the terminal's own foreground, used wherever no role color applies. Fixed before the snapshots were recorded.
  - 12 mutation probes, each turning a test red. Two survived at first and got coverage: a white border in monochrome, which the prompt's frame hid, and a list drawn in white, which no frame showed until the overlay was added.
- [x] 6.13 Build change. Files: `package.json`, `scripts/`. `bun build` replaces `tsup`, with a `bun` banner. Remove `tsup` in its own commit.
  - **Verification**: `bun run build` runs `scripts/build.ts`, which bundles JamCLI's code into `dist/index.js` and 17 chunks with dependencies left in `node_modules`. Each lazily loaded part is a chunk of its own, so the entry still reads its arguments before loading anything. The entry alone starts with `#!/usr/bin/env bun`: Bun's own banner option put it on every chunk, where it is a syntax error. Both interfaces boot from `dist/` in a pseudo-terminal, and `doctor` and `--version` run from it. `tsup` and its configuration are removed in a commit of their own.
  - Tests: 1 building into a scratch directory and checking the shebang, the chunks, the entry's lazy loading, dependencies left external, and `--version` from the result.
  - The headless overhead fell from about 240 ms to about 135 ms against its 150 ms budget, which is now enforced as D24 planned. The margin is narrow; a slower CI runner could miss it, and that would show in the performance job.
- [x] 6.14 Benchmark after. Run the same harness on OpenTUI and record the numbers here next to 6.1's.
  - **Verification**: the same harness, `scripts/bench/pty-latency.py`, on the built command at 120 by 40, medians of five runs, 2026-09-24. It now also records the first frame (until the status line reads `ready`) and the resident memory. "Resume" includes the harness's one second of quiet, as it did for 6.1.

    | Interface | First output | First frame | Resume | Echo median | Echo p95 | Bytes per key | Idle memory |
    |---|---|---|---|---|---|---|---|
    | Ink on Node 22 (6.1), latest 5 of 1,001 | 636 ms | not measured | 1,082 ms | 15.5 ms | 23.1 ms | 16,564 | not measured |
    | Ink on Node 22 (6.1), full history | 630 ms | not measured | 1,097 ms | 14.0 ms | 19.7 ms | 6,810 | not measured |
    | OpenTUI on Bun, 1,000 messages | 192 ms | 237 ms | 1,304 ms | 2.3 ms | 6.8 ms | 63 | 143 MB |
    | OpenTUI on Bun, empty session | 192 ms | 240 ms | none | 3.2 ms | 6.1 ms | 53 | 78 MB |

    Keystroke p95 went from 23.1 ms to 6.8 ms against a 16 ms budget, and each key writes 63 bytes rather than 16,564.
  - The first measurement missed two budgets: the first frame at 320 ms (250) and memory at 187 MB (150). What was changed to meet them, each measured:
    - `/mcp` and `/doctor` loaded the MCP SDK into every start; they now load it when they run.
    - fs-extra, about 30 ms to load, is replaced by Node's own fs; fs-extra and the unused fast-glob are removed.
    - The legacy configuration service is off the start path.
    - The session opens while the terminal is set up.
    - A long session draws its latest 200 rows, and Page Up at the top draws more. The transcript had no keyboard scrolling at all; Page Up and Page Down now scroll it.
  - `bun run bench` now runs the harness and enforces all six D24 budgets. The last run: `--version` 20.5 ms (60), headless 120.9 ms (150), grep 40.9 ms (500), first frame 245.3 ms (250), keystroke p95 6.1 ms (16), memory 145 MB (150).
  - Risk: the first frame's margin is 2 to 5 ms, and memory's about 5 MB. About 90 ms of the frame is OpenTUI's own loading, which JamCLI cannot shorten. A slower CI runner could miss either budget, and the performance job would say so.
  - Tests: the transcript window (the latest rows, paging to the top, the earlier rows drawn in place, Page Down, another session at the bottom), the ignore patterns, the fs helpers, and the budget judge. 14 mutation probes, each turning a test red. The first run of the window test found that `/resume` while scrolled up opened the new session at the old position; it now opens at the bottom.
- [x] 6.15 Remove Ink. Delete the Ink interface, `ink`, `ink-text-input`, `src/services/LLMProvider.ts`, the sensor's tool gate, and every remaining legacy path. Record the type error count, which is expected to reach 0.
  - **Verification**: `jamcli` opens the OpenTUI interface, with no switch. Deleted: the Ink interface (54 files under `src/tui/`), `src/core/sensor.ts`, and every module an import graph from `src/index.tsx` no longer reached: `LLMProvider`, the legacy provider adapter, `ModelService`, `ToolService`, `HistoryService`, `FileSystemService`, `ExecutionService`, the zustand store, the old context manager and token estimate, and the old prompt builder, with their tests. About 9,500 lines. `ink` and `ink-text-input` are removed in commits of their own; zustand, clipboardy, string-width, uuid, dotenv, and tsx, which nothing imported, in another. The dependencies went from 17 to 8.
  - **Type errors: 0**, from the unit's baseline of 22. The gates now hold it at 0, and the staged CI workflow's baseline is 0.
  - Kept: `src/tui/runtime.ts`, the interface's assembly call, which the OpenTUI start now uses and the surfaces test checks, and the configuration service, which the MCP manager and the ACP client still read through.
  - Found along the way, and fixed first in its own commit: with the Bun shebang from 6.13, Bun read a `.env` and a `bunfig.toml` from the working directory, so a hostile repository could run its own code through a bunfig preload before JamCLI's, or change JamCLI's settings through its `.env`. The shebang now passes `--no-env-file` and `--config=/dev/null`, and the build's test runs the command in such a directory. The release binaries of stage 12 need `--no-compile-autoload-dotenv` and `--no-compile-autoload-bunfig` for the same reason.
- [x] 6.16 Boot and exercise. Run the interface in a pseudo-terminal, exercise every slash command, one approval, one rejection, `/resume`, `/compact`, `/undo` after stage 7, and a mode switch, and record the result.
  - **Verification**: `src/__tests__/exercise.test.ts` runs the entry point in a pseudo-terminal, read through a headless terminal emulator (`@xterm/headless`), against a fake Ollama, as a person would meet it. One session: a reply drawn from Markdown; an approval (the prompt, then 1); a rejection (Escape); a mode switch by Shift+Tab and back by `/mode`; every slash command (`/help`, `/setup`, `/model`, `/style`, `/theme`, `/config`, `/permissions`, `/context`, `/cost`, `/tools`, `/mcp`, `/categories`, `/profile`, `/doctor`, `/export`, `/copy`, `/compact`, `/fork`, `/clear`, `/resume` through its picker, and `/exit`, which leaves with code 0). `/undo` answers that it is not available yet; stage 7 adds it, and 7.2 extends this exercise. It passed four runs in a row, in about 11 seconds each.
  - Found by it, each fixed in its own commit with a test that fails without the fix:
    - A request whose server reports no token counts was not counted, so `/cost` said none had been made. It is counted now, unreported, at no cost for a free model and at an unknown cost otherwise.
    - With that, a free local model showed `$0.00` in the status line, which pushed the phase off an 80-column line. A cost of nothing takes no room now.
    - A compaction showed twice, as its row and as the notice meant for text surfaces.
    - `/profile` named `~/.config/jamcli/profiles/` whatever directory was in use.
    - The first frame's status line read "no model" and "no sandbox" until an effect refreshed it.

## Stage 7: Git workflows

- [x] 7.1 Checkpoints (D15). Files: `src/core/git/checkpoints.ts`, tests. Temporary-index tree snapshots on a private ref, and file backups outside git. Verify the user's index, HEAD, and stash are untouched.
  - **Verification**: before a step's first call that may change something (anything but a read, the agent's own plan, or a network fetch), and again once the step is done, the working copy is committed to `refs/jamcli/checkpoints/<session>` through a temporary index seeded from a copy of the person's. Tests check the person's HEAD, branches, staged changes, stash, and status are exactly as before, that ignored files stay out, and that a subdirectory project names its own paths. Outside a repository, the files an edit or a patch names are copied under `.jamcli/checkpoints/<session>/<n>/`, with a note of those that did not exist. The session log records each checkpoint with both ends and the index of the turn's opening message.
  - Tests: 5 on the store (the person's state untouched, a subdirectory, backups outside git, a call's files, a change only git's racy-file check sees, and a step scoped away from the person's own changes) and 2 through the runtime (in and outside a repository).
  - Found along the way: the index copy got a fresh time, which defeated git's check for a file changed in the same second as its index entry, so a same-size edit went unseen. The copy keeps the original's times, and a test builds that case on purpose.
- [x] 7.2 `/undo` and `/rewind`, with a preview and restore choices for code, conversation, or both.
  - **Verification**: `/undo` shows the diff restoring the model's last change would make, as a diff in the transcript, and restores the files only when asked; Escape leaves everything. A second `/undo` looks at the model's change again rather than redoing. `/rewind` lists the checkpoints with the time and the turn's words, and offers the files, the files and the conversation, or the conversation only. The conversation goes back by forking the session at the turn's opening message, which waits in the composer; the previous session stays in `/resume`. A restore is checkpointed like a step, so `/rewind` can undo it.
  - Tests: 2 through the interface and the end-to-end exercise, which now edits a file in a repository and undoes it. 25 mutation probes across 7.1 and 7.2, each turning a test red. Five survived at first and got tests: the index copy's time, a read or a plan step taking a checkpoint, `/undo` picking a restore's own checkpoint, and two in the racy-file test's order.
  - Found by the exercise: restoring the whole working copy also reverted what the person had done since, deleting a file `/export` had just written. A restore now touches only the paths its step changed, and a step that changed nothing leaves no checkpoint.
- [x] 7.3 `/diff` with hunk stage, unstage, and revert.
  - **Verification**: `/diff` shows the staged and unstaged changes in the transcript, with the untracked files named, and lists them by hunk. An unstaged hunk can be staged or reverted, a staged one unstaged, and an untracked or binary file staged or reverted whole. Each hunk applies alone through `git apply`, which refuses one that no longer fits. A revert is checkpointed, so `/rewind` takes it back. Paths are from the repository's top, also for a project in a subdirectory.
  - Tests: 3 on the core (two hunks acted on one at a time, whole files, a hunk that no longer fits, outside git, a subdirectory), 1 on a checkpointed change before the first message, and 2 through the interface.
  - 9 mutation probes, each turning a test red. One survived at first and got a test: a staged hunk offered a revert.
  - Found along the way: the list reopened a moment after an action, and keys typed in between reached the composer. It now reopens at once and fills in when the change is done. And a checkpoint recorded before a session's first message was held back and lost; recording one now starts the log.
- [x] 7.4 The commit path: `git_commit` and `/commit`, the dedicated approval, and attribution off by default.
  - **Verification**: `git_commit` (the model's) and `/commit` (the person's) share one path: stage the paths chosen, then `git commit` with the message, so the repository's hooks run and the commit carries the person's git identity. A failing hook stops it with the hook's words; nothing staged or an empty message is refused. The model's call always asks, in every mode, even with an allow rule: the prompt shows the message, the files, and the diffstat, worked out in a temporary index so nothing is staged before the answer, and offers no grant. A deny rule and plan mode still stop it; bypass mode asks too unless `git.allow_commit_in_bypass` is set. No trailer is added unless `git.attribution` names one. `/commit` offers to stage everything or to choose with `/diff` when nothing is staged, drafts a conventional message with the session's model unless one is given, and commits only when chosen; the message can go back to the composer.
  - Tests: 5 on the core, 3 through the runtime (asking despite a rule and the mode, bypass with and without the setting, a deny rule, a trailer), and 2 through the interface. 12 mutation probes, each turning a test red.
- [x] 7.5 `/pr` through `gh`, with push and creation approved separately.
  - **Verification**: `/pr` refuses on the base branch, outside a repository, and without a remote, and says how to install or sign in to `gh` when it is missing or signed out. Pushing is its own approval, naming the commits not yet on the upstream or the base, and uses the person's own git credentials. Opening the pull request is a second approval that shows the title and the body, drafted by the session's model from the branch's commits and diffstat unless a title is given, and offers to open it, open it as a draft, or send the title back to the composer. The body goes to `gh pr create` on standard input. JamCLI reads, stores, and passes no GitHub token: `gh` signs in on its own.
  - Tests: 4 on the core against a bare remote and a stand-in `gh` (the branch's state before and after a push, `gh` missing and signed out, the request `gh` receives, the drafted text split) and 2 through the interface (push then open, and each refusal). 9 mutation probes, each turning a test red, among them opening without asking and pushing without asking.
  - Found along the way: the second overlay opened a moment after the push was chosen, so keys typed in between reached the composer. It opens at once and fills in when the push is done.
- [x] 7.6 Worktrees: `--worktree` and `task(isolation: "worktree")`.
  - **Verification**: `jamcli --worktree <name>` and `jamcli -p ... --worktree <name>` make `.jamcli/worktrees/<name>` from HEAD on a `jamcli/<name>` branch, or open it again, and work there. Tools, rules, `@` references, checkpoints, the header's branch, `/diff`, `/commit`, and `/pr` use the worktree; configuration, grants, and the session log stay with the project, so the project's settings apply and `/resume` finds the session. Permission rules are judged from the worktree, and the person's working copy is out of the tools' reach. `task` takes `isolation: "worktree"`: the child works in a worktree of its own, and the result says where its changes are, on which branch, and how to merge or remove them. A child that changed nothing leaves no worktree or branch. Git ignores the directories through `.jamcli/.gitignore`, so the person's status is unchanged. A project in a subdirectory works in the same subdirectory of its worktree.
  - Tests: 5 on the core (made, reopened, counted, removed, a subdirectory, a branch left from before, a directory deleted by hand, refused names and places), 5 through the runtime and the command line, and 1 through the interface. 22 mutation probes, each turning a test red. Two survived at first and got tests: a name with `..` inside it, and a branch left from before being moved rather than checked out.
  - Found along the way: the header read the branch from the nearest `.git/HEAD`, which inside a worktree is the main repository's, so it named the wrong branch. A worktree's `.git` file is followed now.

## Stage 8: Commands, skills, and hooks

- [x] 8.1 Add `yaml` in its own commit. Custom commands (D16). Files: `src/core/ext/commands.ts`, tests.
  - **Verification**: Markdown files in `~/.config/jamcli/commands/` and `.jamcli/commands/` become `/name`, or `/dir:name` from a subdirectory, in the interface and in `jamcli -p "/name args"`. Front matter sets `description`, `argument-hint`, `model`, and `allowed-tools`; the body takes `$ARGUMENTS` and `$1` to `$9`, and arguments a body does not place are added after it. `@` references expand when the prompt is sent. A project command shadows a user command, a built-in keeps its name, and a file that cannot be read is reported by name while the rest load. The palette shows each custom command's source, and the transcript shows the line typed. `model` runs the turn on that model and returns to the session's after it; `allowed-tools` narrows the turn to the tools it names, which are then the only ones offered and the only ones that run. Other agents' tool names, such as `Bash(git diff:*)`, are read as JamCLI's.
  - Tests: 5 on the core, 4 through the runtime and the command line, and 1 through the interface. 20 mutation probes, each turning a test red.
  - Delta from Claude Code, recorded: `allowed-tools` narrows and never allows. A project's command file cannot grant itself a permission, as D16 already says of skills.
- [x] 8.2 Agent Skills. Files: `src/core/ext/skills.ts`, the `skill` tool, tests against the specification's examples.
  - **Verification**: skills are found in `.jamcli/skills/`, `.agents/skills/`, and `~/.config/jamcli/skills/`, in that order of precedence. `SKILL.md` is checked against the specification: a name of lowercase letters, digits, and single hyphens, at most 64 characters, matching its directory; a description of at most 1024 characters; `compatibility` at most 500. `license`, `metadata`, and `allowed-tools` are read. The system prompt lists each skill's name and description and nothing more; the `skill` tool, offered only when there are skills, returns the instructions and the bundled files, or reads one bundled file from inside the skill's directory, refusing a path or a link that leaves it. A bundled script runs only through `run_command`, where the permission engine and the sandbox apply. `allowed-tools` narrows the rest of the turn; inside a command that narrows too, only what both allow runs.
  - Tests: 4 on the core, using the specification's minimal and full examples and its invalid names, and 4 through the runtime. 19 mutation probes, each turning a test red.
- [x] 8.3 User hooks (D17). Files: `src/core/hooks/commands.ts`, tests. The protocol, decisions, `updated_input` re-validation, sandboxing, and the project trust confirmation.
  - **Verification**: `hooks` in any configuration layer maps the eight events to commands, each with an optional matcher (a rule, for the tool events), a timeout, and `enabled`. A hook reads the event as JSON on standard input. Exit 2 blocks with standard error as the reason: a call is denied with it, a prompt is not sent, a stop becomes a request to carry on, and after a call it reaches the model. A JSON verdict may allow, deny, or ask, add context, or replace a call's arguments, which are checked against the tool's schema before the call runs. A hook's decision is one more rule source, deny first: a deny rule beats a hook's allow, and a hook's allow answers only what the mode alone would have asked. Any other exit, a timeout (the hook and its children are killed), or output that is not a verdict is a notice, and the turn goes on. Hooks run with the session's minimal environment, which withholds credentials, inside its sandbox. A project's hooks run only once trusted; the trust is kept in the state directory, for the hooks as they are, and lapses when they change. The hooks subscribe to the in-process hook bus, whose handlers now return verdicts.
  - Tests: 5 on the hook runner and the bus, and 9 through the runtime, one of them inside bubblewrap. 29 mutation probes, each turning a test red. Two survived at first and got tests: a timed-out hook's children left running, and a matcher's pattern ignored.
  - Found along the way: a killed hook's orphaned child lingers as a zombie in a container whose first process does not reap, and a liveness check must not count it.
- [x] 8.4 Surface them: the `/skills`, `/hooks`, and `/commands` views, and `jamcli skill list`.
  - **Verification**: `/skills`, `/commands`, and `/hooks` in the interface, and `jamcli skill list` and `jamcli hooks [list|trust]` on the command line, print the same reports: each entry with its source, what narrows it, and what could not be read. When a project's hooks are not trusted, the interface asks once at the start, showing each hook's command; "Not now" leaves them off, and `/hooks trust` or `jamcli hooks trust` turns them on. Headless runs never ask, and say how to trust them.
  - Tests: 3 on the command line and 2 through the interface. 11 mutation probes, each turning a test red.

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
