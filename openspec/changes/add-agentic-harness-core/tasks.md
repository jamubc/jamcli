# Tasks: Agentic Harness Core

Eleven stages. Stages 1 and 2 gate everything else. After stage 2, stages 3 through 10
are independent of each other except where a task names a dependency, and the only
ordering rule inside them is that `task` delegation requires both headless mode and
category routing.

Every stage ends with the same four commands, and none of them may regress:

```bash
bun install
npx tsc --noEmit
bun test
bun run build
```

Record the `tsc --noEmit` error count once, in stage 1, and carry it forward. A stage
that raises it is not done.

Paths in this file are relative to the repository root. Line references describe the
state of the tree when this change opened and are for locating code, not for editing by
number.

## Stage 1: Hygiene and protocol

Park the in-progress work first. Nothing below may be built on an unrecorded tree.

- [x] 1.1 Create the working branch for this change, then commit the pre-existing source changes as their own commit: `wip: native tool calling and mcp integration`. Files: none, git only. Scope that commit to the source changes only. Do not include `openspec/`, `AGENTS.md`, or `.gitignore`, which land in task 1.5. Verify `git status --short` no longer lists `src/` or `package.json`, and confirm with `git show --stat` that the commit contains only the pre-existing work. Do not discard or amend it: the native tool-calling path inside it is the foundation of task 1.8.
  - **Correction**: The tree was already committed before this run: `e0417f7` (`stage update docs`) swept the pre-existing source changes and the specification scaffolding into one commit on `master`, ahead of `origin/master`. Splitting it now would require rewriting `master` history, which is out of bounds, so `e0417f7` stands as the parking commit and this task is recorded as satisfied rather than redone. Preservation verified: the native tool-calling path is intact at `src/components/Layout.tsx:2312` and `src/services/LLMProvider.ts:320`, `git status --short` lists no `src/` or `package.json` changes, and `git show --stat` confirms the parked work matches the `+1,577/-20` source footprint recorded in `design.md`. The scoping rule that the source work and the specification not share a commit is why 1.5 carries its own correction.
- [x] 1.2 Add the test runner. Files: `package.json`, `src/services/__tests__/toolService.test.ts`. Add `"test": "bun test"`. Write one test that exercises `ToolService` against the repository itself and asserts a string result. Verify `bun test` reports 1 pass.
- [x] 1.3 Record the type baseline. Files: `openspec/changes/add-agentic-harness-core/tasks.md` (this file) and the eventual PR description. Run `npx tsc --noEmit`, count the errors, and write the number into the PR description as the regression baseline. Verify the number is recorded before any source file changes.
  - **Baseline recorded**: 35 errors from `npx tsc --noEmit` (TypeScript 5.9.3), measured on the tree as parked in `e0417f7` before any source file change: `ConfigMenuScreen.tsx` 21, `Layout.tsx` 11, `McpManager.ts` 4. This count is the regression baseline for the change and is carried in the PR description; a later stage that raises it is not done. Recorded before task 1.2 lands its test file because this task's verification requires the number before any source file changes.
- [x] 1.4 Clean up dependencies. Files: `package.json`, `package-lock.json`, `bun.lock`. Remove `vm2`, which is installed, unused anywhere in `src/`, and abandoned upstream with known sandbox escapes. Then consolidate the lockfiles: the repository carries both `bun.lock` and `package-lock.json` for one `package.json`, and they can drift into two different dependency trees. Bun is the runtime, so `bun.lock` is authoritative. Delete `package-lock.json`, add it to `.gitignore`, and commit the regenerated `bun.lock`. Verify `grep -rn "vm2" src/` returns nothing and `bun install --frozen-lockfile` succeeds.
- [x] 1.5 Land the specification scaffolding. Files: `.gitignore`, `AGENTS.md`, `openspec/`. The negation rules for `openspec/**`, `docs/**`, and `AGENTS.md` are already applied in the working tree and the OpenSpec tree already validates. Verify `git status --short` lists them as untracked rather than ignoring them, then commit `.gitignore`, `AGENTS.md`, and `openspec/` as one `docs` commit. Do not sweep this into the commit from task 1.1: the pre-existing source work and the specification are different concerns.
  - **Correction**: This landed inside `e0417f7` together with the pre-existing source work before this run, so the required separation from task 1.1 was not achievable without rewriting `master`. Substance verified: the `openspec/**`, `docs/**`, and `AGENTS.md` negations are in `.gitignore`, the tree is tracked rather than ignored, and `openspec validate --all --strict` reports 2 passed, 0 failed.
- [x] 1.6 Remove the system prompt's fenced action format. Files: `src/components/Layout.tsx`. Delete `TOOL_INSTRUCTION_PROMPT` (around line 147) and remove its interpolation in `buildSystemPrompt` (around line 316). Verify the built system prompt contains no JSON action block instruction.
- [x] 1.7 Remove the dual dispatch path. Files: `src/components/Layout.tsx`, `src/services/ActionParser.ts`. Remove the `ActionParser` import (around line 26) and the `ActionParser.parse` call (around line 2921). Delete `src/services/ActionParser.ts`. Verify no import of `ActionParser` remains and the project builds.
- [x] 1.8 Confirm the native tool path is complete. Files: `src/components/Layout.tsx`, `src/services/LLMProvider.ts`. Confirm the native path already present around lines 2312, 2319, and 2335 dispatches tools, appends tool results, and loops. Fill any gap left by the parked WIP. Verify a prompt requiring a tool produces a tool call and a tool result with no fenced JSON anywhere in the transcript.
  - **Verification**: `bun test src/services/__tests__/nativeToolPath.test.ts` (2 pass) drives a scripted model through the real provider and tool service: a tool-requiring prompt yields a native tool call, dispatch returns a string tool result, the appended `tool_calls` and `tool_call_id` survive into the second request, and the transcript contains no fenced JSON. Mutation check: removing `parseToolCalls` from `OllamaProvider.complete` makes the round-trip test fail with `Expected: "list_files", Received: undefined`. Gaps filled: `OllamaProvider.complete` now parses `tool_calls` and forwards `signal`, both providers preserve tool fields in message mapping, and `Layout.tsx` imports the `Action` and `McpToolDescriptor` types it used without importing. The in-component loop itself executes and is exercised for real in tasks 2.5 and 2.13 once it lives in the core.
- [x] 1.9 Update prompts that describe the removed format. Files: any profile under `.jamcli/profiles/`, `README.md`, and any project rules file. Rewrite anything that instructs the model to emit a JSON action block. This is required, not optional: after task 1.7 those instructions are actively misleading.
  - **Verification**: audited every prompt surface, and none instruct the model to emit a JSON action block, so nothing needed rewriting. `.jamcli/profiles/default.json` (the only profile) carries `system_prompt_override: "You are a helpful AI assistant."`; `grep -rn -i "fenced|json block|\"action\"|emit a|apply_patch|run_command|tool_result" .jamcli/profiles/` returns nothing; `README.md` documents only file names, not the format; the repository's `AGENTS.md` carries no model-facing tool instructions; and `grep -rn -i "json block|fenced|emit (a |an )?(json|action)|\"action\"" src/` returns nothing after task 1.6. Spec text describing the old protocol is corrected at archive time (task 11.6) per the OpenSpec rule that the spec updates only when the change is archived.
- [x] 1.10 Add CI. Files: `.github/workflows/ci.yml`. Install with a frozen lockfile, then run the type gate, the test runner, and the build. Verify the workflow goes green on the branch.
  - **Verification**: the type gate encodes the recorded baseline policy (`npx tsc --noEmit` may report at most 35 errors, the count is printed each run), since the baseline exists precisely to carry pre-existing errors. The workflow's exact steps pass locally in sequence: `bun install --frozen-lockfile` clean, `tsc --noEmit errors: 27 (baseline 35)`, `bun test` 3 pass, `bun run build` success. The Actions run triggered by pushing this branch is quoted in the stage report.

## Stage 2: Headless core

The point of no return in one direction. Extract in slices, one commit per slice, with
the TUI booted and exercised after each. The TUI is the regression test for this stage.

- [x] 2.1 Create the core contracts. Files: `src/core/types.ts`. Define `JamSession`, `AgentEvent` (text, reasoning, tool_call, tool_result, usage, approval_request), `ToolCall`, `ToolResult`, and `RunResult` per `design.md`. Keep `approval_request` carrying a decision callback and never a component reference.
- [x] 2.2 Create the session state module. Files: `src/core/state.ts`. Move message list, usage accumulation, and cancellation flags out of the Zustand store's chat slice. The store keeps UI state only.
- [x] 2.3 Create the loop skeleton. Files: `src/core/agent.ts`. Implement `run` and `cancel` with no tool dispatch and no provider call yet. Verify a caller can construct it and receive a text event.
- [x] 2.4 Extract the provider call. Files: `src/core/agent.ts`, `src/components/Layout.tsx`. Move the streaming call and reasoning-delta handling into the core, emitting text, reasoning, and usage events. Verify the TUI still streams replies.
- [x] 2.5 Extract tool dispatch. Files: `src/core/agent.ts`, `src/core/tools/dispatch.ts`, `src/components/Layout.tsx`. Move tool call handling, result formatting, and per-step bounds into the core, emitting tool_call and tool_result events. Verify a tool-using prompt works end to end.
  - **Verification**: `bun test` 11 pass, including a stubbed-provider dispatch sequence (tool_call, tool_result, text), a budget-exhaustion stop, and an unusable-tool-call error with the turn continuing. Live proof against local Ollama (`qwen3:4b`): `tool_call list_files`, `tool_result "1. package.json\n2. README.md"`, no fenced JSON in the transcript. The live run caught two real defects before this commit: provider-returned calls without `function.name` crashed the loop (now a reported tool error per the delta spec), and the services-layer flat call shape never matched the core wire shape (now normalized in the legacy adapter, pinned by `src/core/providers/__tests__/legacy.test.ts`). The TUI consumes the same path through an event-driven dispatcher with the modal approval behavior preserved; tmux interaction shows message rendering absent identically on the pre-slice baseline build, so that is a pre-existing presentation matter for the OpenTUI port, not a regression from this slice.
- [ ] 2.6 Extract approval as a callback. Files: `src/core/agent.ts`, `src/components/ActionModal.tsx`, `src/components/Layout.tsx`. The core emits `approval_request`; the TUI answers it from the modal. Verify patch approval and rejection both behave as before.
- [ ] 2.7 Extract system prompt composition. Files: `src/core/prompt.ts`, `src/components/Layout.tsx`. Move `buildSystemPrompt` (around line 300) and tool guidance out of the component. Verify the effective prompt is byte-identical for an unchanged profile.
- [ ] 2.8 Extract intent classification and tool selection. Files: `src/core/sensor.ts`, `src/components/Layout.tsx`. Move `detectIntent` (around line 345), `userQueryNeedsTools`, and `selectToolsForQuery` (around line 359) into the core. Verify tool selection is unchanged for representative prompts.
- [ ] 2.9 Extract context management. Files: `src/core/context/`, `src/services/ContextManager.ts`. Move `ContextManager` under the core unchanged, then delete the original. Verify `/compact` still works.
- [ ] 2.10 Extract the loop constants. Files: `src/core/`, `src/types/config.ts`. Move `MAX_AGENT_STEPS`, `MAX_TOOL_CALLS_PER_TURN`, and `TOOL_RESULT_MAX_CHARS` into configuration with the current values as defaults. Verify no constant remains in a component.
- [ ] 2.11 Rewire the TUI onto the core. Files: `src/components/Layout.tsx`, `src/tui/`. The TUI renders core events and forwards input. Verify every slash command still works.
- [ ] 2.12 Split `Layout.tsx`. Files: `src/tui/*.tsx`. Split the 3,318-line component into focused files, none over 400 lines, one commit per extraction, no behavior change. Verify the file no longer exists or is under 400 lines, and that the TUI boots after each commit.
- [ ] 2.13 Prove the core runs without the TUI. Files: `src/core/__tests__/agent.test.ts`. Run a turn against a stubbed provider and assert the event sequence. Verify the test passes with no Ink module imported.

## Stage 3: Tool layer

- [ ] 3.1 Build the tool registry. Files: `src/core/tools/registry.ts`, `src/types/tools.ts`. A tool declares name, description, JSON Schema, policy class, and runner. `types/tools.ts` becomes the registry's type module rather than a switch source.
- [ ] 3.2 Migrate the five existing tools. Files: `src/core/tools/`, `src/services/ToolService.ts`. Express `list_files`, `read_file`, `search_code`, `apply_patch`, and `run_command` as registry entries with real schemas. Delete the switch statement.
- [ ] 3.3 Replace permissive schemas. Files: `src/services/McpManager.ts`. Remove `buildBuiltinSchema` and read built-in schemas from the registry, so MCP discovery sees the real shapes instead of `additionalProperties: true`.
- [ ] 3.4 Add `glob`. Files: `src/core/tools/glob.ts`. Pattern-based path listing ordered by most recently modified, respecting ignore patterns.
- [ ] 3.5 Add `grep`. Files: `src/core/tools/grep.ts`. Pattern search with surrounding context, respecting ignore patterns.
- [ ] 3.6 Add `write_file`. Files: `src/core/tools/write_file.ts`. Creates files, refuses a silent overwrite, and refuses a path outside the project root.
- [ ] 3.7 Add anchored reads. Files: `src/core/tools/read_file.ts`. Return a stable anchor per line alongside the line number.
- [ ] 3.8 Add `edit` with stale-anchor rejection. Files: `src/core/tools/edit.ts`. Accept anchors, validate them against current content, and on mismatch reject the edit and return fresh anchors without touching the file.
- [ ] 3.9 Add `todo_write` and `todo_read`. Files: `src/core/tools/todo.ts`. Persist a per-session task list so long runs have visible state.
- [ ] 3.10 Add `git_status` and `git_diff`. Files: `src/core/tools/git.ts`. Read-only git inspection. These are the only git tools in this change; committing remains the user's action.
- [ ] 3.11 Test the registry and the edit path. Files: `src/core/tools/__tests__/`. Cover schema validation failure, path escape rejection, ambiguous find, and stale-anchor rejection.

## Stage 4: Providers

- [ ] 4.1 Build the compatible client. Files: `src/core/providers/openai-compat.ts`. One client handling streaming and non-streaming, content, reasoning deltas, tool calls, and usage. Reuse the parsing already in `src/services/LLMProvider.ts`.
- [ ] 4.2 Migrate Ollama and OpenRouter onto it. Files: `src/core/providers/`, `src/services/LLMProvider.ts`. Delete the per-provider classes once their behavior is expressed as configuration.
- [ ] 4.3 Add the Anthropic translation seam. Files: `src/core/providers/anthropic.ts`. Translate requests and streaming responses, preserving tool calls and reasoning blocks. Reference `design.md` for the study material and check its license before taking any code.
- [ ] 4.4 Add endpoint configuration. Files: `src/types/config.ts`, `src/services/ConfigService.ts`. An endpoint declares an identifier, base URL, optional key, optional key environment variable, and optional headers.
- [ ] 4.5 Read keys from the environment. Files: `src/core/providers/`. Prefer `key_env_var` over a stored value everywhere a provider supports it.
- [ ] 4.6 Discover models generically. Files: `src/services/ModelService.ts`. Query the models route for any configured endpoint and merge discovered models with configured ones, labeling the origin.
- [ ] 4.7 Remove unimplemented provider entries. Files: `src/types/config.ts`, `src/services/LLMFactory` callers. No provider may appear in configuration that JamCLI cannot serve.
- [ ] 4.8 Test translation. Files: `src/core/providers/__tests__/`. Cover request conversion, stream event ordering, tool call round-trip, and reasoning-delta handling for both shapes.

## Stage 5: Category routing

- [ ] 5.1 Define the category schema. Files: `src/core/routing/categories.ts`, `src/types/config.ts`. A category maps a name to an ordered list of model entries with optional reasoning levels.
- [ ] 5.2 Implement resolution. Files: `src/core/routing/resolve.ts`. Walk the chain, skip models whose provider is not configured, advance on failure, and report the resolved model and the category.
- [ ] 5.3 Normalize reasoning capability. Files: `src/core/routing/capabilities.ts`. Drop or downgrade a requested level that the target model cannot accept, and record what was changed.
- [ ] 5.4 Separate session model from routed model. Files: `src/core/agent.ts`. Routing applies only to delegated work. The session model stays whatever the user selected.
- [ ] 5.5 Surface the resolution. Files: `src/tui/`, config screen. Show the configured chains and, for a routed unit of work, which entry served it.
- [ ] 5.6 Test routing. Files: `src/core/routing/__tests__/`. Cover configured-first, skip-unconfigured, advance-on-failure, no-entry-available, and capability downgrade.

## Stage 6: Headless mode

- [ ] 6.1 Make the entry point a dispatcher. Files: `src/index.tsx`, `src/cli.ts`. No prompt flag renders the TUI as today; with one, run headless.
- [ ] 6.2 Add the prompt flag and output formats. Files: `src/cli.ts`. Support text, json, and stream-json. The json form carries session identifier, status, response, duration, turn count, and usage.
- [ ] 6.3 Add the exit code contract. Files: `src/cli.ts`. Zero on success, one on refusal or limit, two on a usage error.
- [ ] 6.4 Add tool policy flags. Files: `src/cli.ts`, `src/core/policy/`. `--allow-tool` and `--deny-tool` govern the run without prompting, and a denied tool cannot run under any combination.
- [ ] 6.5 Add run bounds. Files: `src/cli.ts`. Support `--cwd` and `--max-turns`.
- [ ] 6.6 Add session flags and subcommands. Files: `src/cli.ts`, `src/core/session/`. Support `--continue`, `--resume <id>`, and `jamcli sessions list|search|export`, reading the existing JSONL files without migration.
- [ ] 6.7 Add `/fork`. Files: `src/tui/`, `src/core/session/`. Creates a new session from the current transcript and leaves the original unchanged.
- [ ] 6.8 Prove it in a pipe. Files: `README.md`. Document a text invocation and a json invocation piped through `jq`. Verify both by running them.

## Stage 7: Delegation

Depends on stage 5 and stage 6.

- [ ] 7.1 Build the child runner. Files: `src/core/delegation/spawn.ts`. Start `jamcli -p` with stream-json output, consume events, and return the final result.
- [ ] 7.2 Resolve the child's model. Files: `src/core/delegation/`. The child's model comes from its category chain and never from the parent session. Add a test that fails if inheritance occurs.
- [ ] 7.3 Add the `task` tool. Files: `src/core/tools/task.ts`. Category, prompt, optional background flag, bounded by configuration.
- [ ] 7.4 Add background lifecycle tools. Files: `src/core/tools/task.ts`, `src/core/delegation/`. Retrieve a background result or its status, and cancel a running task.
- [ ] 7.5 Bound delegation. Files: `src/core/delegation/`, config. Cap depth, cap concurrent children, cap turns per child. Exceeding depth returns an error rather than spawning.
- [ ] 7.6 Constrain child permissions. Files: `src/core/policy/`. A child is governed by delegated-run policy and cannot widen its own permissions.
- [ ] 7.7 Record delegation in the transcript. Files: `src/core/`. Each delegation records the category, the resolved model, and the child session identifier.
- [ ] 7.8 Test delegation. Files: `src/core/delegation/__tests__/`. Cover model independence, depth bound refusal, cancellation, and background retrieval.

## Stage 8: Tool output trust gate

- [ ] 8.1 Port the screening pipeline. Files: `src/core/trust/`. Adapt the host-neutral core from `langsearch`: local deduplication, one batched classification request scoring relevance and injection, injection drops taking precedence, and fail-open on error.
- [ ] 8.2 Wire the gate into the turn. Files: `src/core/agent.ts`. Screen tool results before they are appended to context. The gate never reintroduces a result classified as an injection.
- [ ] 8.3 Make it configurable and visible. Files: `src/types/config.ts`, config screen. Off by default is not acceptable; the gate is on when a cheap model is configured. When it is unavailable or disabled, that state is visible rather than silent.
- [ ] 8.4 Record removals. Files: `src/core/trust/`, transcript rendering. A removed result is named in the transcript with its reason.
- [ ] 8.5 Test the gate. Files: `src/core/trust/__tests__/`. Cover injection precedence, dedupe before classification, fail-open on a throwing classifier, empty result after filtering, and the disabled path.

## Stage 9: Rules, hooks, policy, audit

- [ ] 9.1 Load the rules hierarchy. Files: `src/core/rules/`. Walk from the project root to the working directory, collect instruction files, and inject them outermost first.
- [ ] 9.2 Support conditional rules. Files: `src/core/rules/`. A declared condition on a path or pattern limits that section to matching work.
- [ ] 9.3 Report loaded rules. Files: config screen. List every instruction file loaded with its resolved path, and show the effective system prompt with the origin of each part.
- [ ] 9.4 Build the hook bus. Files: `src/core/hooks/`. Typed events for session start, turn start, pre-tool, post-tool, compaction, and session end. Disableable, and a throwing hook is reported without failing the turn.
- [ ] 9.5 Move cross-cutting behavior onto the bus. Files: `src/core/`. Relocate context injection, output truncation, and continuation logic out of any remaining component.
- [ ] 9.6 Extend the permission model. Files: `src/core/policy/`, `src/types/config.ts`. Each tool resolves to allow, ask, or deny, with state-changing tools defaulting to ask.
- [ ] 9.7 Build `jamcli audit`. Files: `src/cli/audit.ts`, `src/core/policy/audit.ts`. Scan instruction, agent, and skill definitions and report findings by severity using the five criteria from `meta-agent`: dangerous tool access, isolation of concerns, prompt injection surface, missing guardrails, and trigger breadth. Read-only.
- [ ] 9.8 Test the policy and audit. Files: `src/core/policy/__tests__/`. Cover default gating, deny overriding configuration, the read-plus-write combination flagged critical, and that the audit writes nothing.

## Stage 10: MCP and ACP

- [ ] 10.1 Add streamable HTTP transport. Files: `src/services/McpManager.ts`, `src/types/mcp.ts`. Support a URL and headers alongside stdio, with stdio remaining the default.
- [ ] 10.2 Add MCP subcommands. Files: `src/cli/mcp.ts`. `add`, `list`, `test`, and `remove`, preserving unrelated configuration in `.jamcli/mcp.json`. Reuse the existing `McpTestService`.
- [ ] 10.3 Add the ACP server. Files: `src/acp/server.ts`, `src/cli.ts`. Serve over stdio. Implement initialize with capabilities, session creation with model and profile options, prompt streaming, cancellation, and a permission mapping onto the approval event.
- [ ] 10.4 Add the ACP client. Files: `src/services/AcpClient.ts`, `.jamcli/agents.json`. Initialize, open a session in the project root, send a prompt, and stream the result back. Accept a Zed-compatible agent configuration.
- [ ] 10.5 Expose delegation as tools. Files: `src/core/tools/acp.ts`. A delegation tool and a status tool, with cancellation, driven by the local policy.
- [ ] 10.6 Verify against a real client. Files: `README.md`. Verify with the existing `~/.local/bin/acp-delegate` helper. Confirm capabilities print without spending a turn, then confirm one real prompt round-trips.
- [ ] 10.7 Document the third-party account risk. Files: `README.md`. State plainly that driving a vendor subscription through a third-party protocol client can violate that vendor's terms, and point at the API-key path where one exists.

## Stage 11: Verification and close-out

- [ ] 11.1 Run the full gate. Files: none. `bun install`, `npx tsc --noEmit`, `bun test`, `bun run build`. The type count must not exceed the stage 1 baseline.
- [ ] 11.2 Boot the TUI and exercise the surface. Files: none. Every slash command, one tool-using prompt, one approval, one rejection, `/resume`, and `/compact`.
- [ ] 11.3 Verify the no-account path. Files: none. With the network disabled and Ollama as the only provider, confirm model listing and a chat turn both work.
- [ ] 11.4 Verify no source file exceeds 400 lines. Files: none.
- [ ] 11.5 Rewrite the README around the three surfaces. Files: `README.md`. One copy-pasteable example each for the TUI, headless invocation, and ACP, plus the roadmap items this change completes.
- [ ] 11.6 Archive the change. Files: `openspec/`. Move the change to `openspec/changes/archive/`, apply the deltas into `openspec/specs/jamcli/spec.md`, and run `openspec validate --strict` to confirm.

## Explicitly deferred

Recorded so they are not silently absorbed into this change:

- Memory, consolidation, and any learning system. `hermes-plasticity-plugin` is the
  evidence against building this without a hard novelty gate, and that gate does not
  exist yet.
- Team mode, parallel member orchestration, and multi-agent visualization.
- A third-party plugin or extension API.
- npm publishing, licensing, and release automation.
- Single-binary distribution per platform.
- Committing on the user's behalf. `git_status` and `git_diff` are read-only by design.
- Automatic use of a vendor subscription through a third-party client.
