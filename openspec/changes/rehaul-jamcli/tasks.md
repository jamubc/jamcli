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
- [ ] 1.2 Build the fake provider server. Files: `src/testing/fakeProvider.ts`, `src/testing/__tests__/fakeProvider.test.ts`.
  - It serves OpenAI chat completions (SSE and JSON), Anthropic messages (SSE and JSON), and Ollama `/api/chat` (NDJSON), plus `/models` and `/api/tags`.
  - Each response comes from a queue of scripted turns (text, reasoning, tool calls, usage, errors, delays, status codes). Every request body is captured for assertions.
  - Verify: the existing providers round-trip a scripted tool call through each dialect against it.
- [ ] 1.3 Add surface-level regression tests for the audit's critical findings, marked as the acceptance checks for stage 2. Files: `src/core/__tests__/audit.test.ts`. Tests that pass only after stage 2 are written with `test.todo` so every checkpoint stays green, and each is converted to `test` in the task that fixes it.

## Stage 2: One honest runtime

- [ ] 2.1 Extend the core contracts. Files: `src/core/types.ts`.
  - Add `ToolResult.callId` and `ToolResult.status`.
  - Add reasoning blocks with the producing provider family.
  - Add the events `turn_start`, `step_start`, `tool_progress`, `retry`, `compaction`, and `turn_end`, and a `notice` level.
  - Add an `ApprovalRequest` with a preview, a reason, and suggestions. `decide` accepts a boolean or an `ApprovalDecision`.
  - Additive only, so the Ink interface still compiles.
- [ ] 2.2 Fix `write_file` (F4). Files: `src/core/tools/write_file.ts`, `src/core/tools/__tests__/writeFile.test.ts`. Verify create, refuse to overwrite, overwrite, refuse a directory, and refuse an escape.
- [ ] 2.3 Make replacements literal and add `replace_all` (F5). Files: `src/services/FileSystemService.ts`, `src/core/tools/edit.ts`, tests. Verify `$$`, `$&`, `` $` ``, and `$'` survive, and CRLF files keep CRLF.
- [ ] 2.4 Resolve symbolic links in path checks (F22). Files: `src/core/tools/paths.ts`, tests. Verify a link inside the project that points outside is refused for reads and writes.
- [ ] 2.5 Rebuild `run_command` (F11). Files: `src/core/tools/command.ts` (new), `src/core/tools/builtins.ts`, `src/services/ExecutionService.ts` (removed), tests.
  - Spawn, timeout, exit code or signal, and labeled streams.
  - Head and tail truncation with a note, and `tool_progress` events.
  - The abort signal kills the process group.
  - Background jobs with `command_output` and `command_kill`.
- [ ] 2.6 Rebuild search (F12). Files: `src/core/tools/search.ts` (new), `glob.ts`, `grep.ts`, tests.
  - Use ripgrep when present, otherwise a JavaScript walk honoring `.gitignore`, `.ignore`, and configured patterns through `ignore`. Add `ignore` in its own commit first.
  - No silent cap: limits are reported in the output.
  - Verify a match in file 401 of a 1,000-file tree is found by both implementations, and ignored files are skipped by both.
- [ ] 2.7 Rationalize the tool set (D5). Files: `src/core/tools/builtins.ts`, `src/core/tools/registry.ts`, `src/types/tools.ts`.
  - Add `hidden` and `aliasOf` to registered tools. `list_files` and `search_code` become hidden aliases.
  - `read_file` gains line windows, a long-line cut, and binary refusal.
  - `apply_patch` takes a multi-file unified diff applied all or nothing.
  - Add `git_log`.
  - Remove the five-name `ToolName` union as a source of truth; it stays only as a legacy type.
- [ ] 2.8 Provider hardening (F13, F14, F15, F19). Files: `src/core/providers/*.ts`, tests against the fake server.
  - Add `withRetry`, and `ProviderError` with body text and hints.
  - Add `stream_options.include_usage`.
  - Set Ollama `num_ctx` from configuration or the model's reported context length.
  - Replay reasoning only to the producing family.
  - Remove hardcoded model defaults.
  - Verify: a scripted 429 with `Retry-After: 1` retries once and succeeds; a 400 body appears in the error message; switching from an OpenRouter reasoning model to Anthropic sends no `thinking` block.
- [ ] 2.9 Build the turn engine (D3; F7, F8, F9). Files: `src/core/agent.ts`, `src/core/tools/dispatch.ts`, `src/types/config.ts` (new loop defaults), tests.
  - Streams every step, with the system prompt first.
  - One assistant message holds the text, reasoning, and all calls.
  - One result per call, including denied and cancelled. Per-call approvals.
  - Concurrent read-only calls; cancellation through a per-run controller.
  - Returns the updated session.
  - Convert the F7 and F8 checks in `audit.test.ts` to live tests.
- [ ] 2.10 Build the transcript event log (D4; F17). Files: `src/core/transcript/` (new), `src/services/HistoryService.ts` (reader and index only), tests.
  - Version 2 writer, version 1 reader, a mixed-file reader, and projections to provider messages and Markdown.
  - Secret redaction.
  - Verify a version 1 fixture resumes, and a version 2 session with tool calls resumes with the calls in the next request.
- [ ] 2.11 Build `createRuntime` (D2). Files: `src/core/runtime/` (new), tests.
  - It is the one place that builds the provider, the full registry (built-ins plus MCP), policy (legacy semantics with F10 fixed), rules, hooks, context management, the trust gate (D21 repairs), and the transcript.
  - `@` references expand in the runtime, not in a surface (F24).
- [ ] 2.12 Move headless onto the runtime. Files: `src/cli/run.ts`, `src/cli.ts`, tests.
  - JSON carries `error`, `model`, `provider`, and `permission_denials`.
  - `stream-json` carries tool output and notices.
  - `--allow-tool` allows (F10). Exit code 130 on interrupt.
  - Verify with the fake server: `jamcli -p` edits a file with `--allow-tool edit`, runs a command with `--allow-tool run_command`, and resumes with the tool calls intact.
- [ ] 2.13 Move ACP onto the runtime (F6). Files: `src/acp/session.ts`, `src/acp/server.ts`, tests. Verify the second prompt of an ACP session reaches the provider with the first exchange in context, the session persists to history, and write tools are offered.
- [ ] 2.14 Move delegation children onto the runtime. Files: `src/core/tools/task.ts`, `src/core/delegation/`. Verify a child can edit under the delegated policy and cannot widen it.
- [ ] 2.15 Lazy entry point. Files: `src/index.tsx`. Dispatch on arguments before importing the interface. Verify `--version` median at or under 120 ms here (the 60 ms budget is enforced after stage 6's build change).
- [ ] 2.16 The conformance test for one runtime. Files: `src/core/runtime/__tests__/surfaces.test.ts`. Drive the same scripted session through the headless and ACP assemblies and the interface's runtime factory call, and assert identical tool lists, provider requests, and transcripts.

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
