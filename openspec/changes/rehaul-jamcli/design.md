# Design: Rehaul JamCLI

## Context

JamCLI is about 18,000 lines of TypeScript in 121 files, run by Bun, with a core under
`src/core/` that imports no interface code. `audit.md` grades the 36 current requirements:
8 hold, 18 are partial, 6 are broken, 4 were not re-run. Every broken requirement fails in
the same place: each surface assembles its own agent, and each assembly differs in tools,
schemas, providers, rules, hooks, and history.

The owner's directive, recorded in `proposal.md`, adds the rest of the target:

- parity with current coding CLIs where it is justified;
- plugins, a git write path, workflows, and release binaries;
- standards adapters, each with a conformance matrix;
- an interface rebuilt on OpenTUI with a redesign.

Constraints that bound every decision here, from `project.md`:

- the three promises (an honest loop, local by default, consent before state changes);
- small enough to hold in your head;
- no memory or learning features;
- telemetry off by default;
- secrets never in the repository;
- the local path must work with Ollama and no network.

External facts this design depends on were checked on 2026-09-23:

| Fact | Consequence here |
|---|---|
| OpenTUI is 0.5.12. It ships a `./testing` export with mock keys, mock mouse, a manual clock, and a frame recorder. Native libraries come through optional dependencies for Linux, macOS, and Windows, including musl. | Pin exact versions. Snapshot tests are possible. Every target platform is covered. |
| `@agentclientprotocol/sdk` is 1.5.0. | ACP moves to the official SDK. |
| `@modelcontextprotocol/sdk` 1.30.1 speaks protocol 2025-11-25 at most. The 2026-07-28 protocol ships in the split v2 packages (`@modelcontextprotocol/client` 2.1.0). | The MCP client moves to the v2 packages. |
| MCP 2026-07-28 removes the initialize handshake and sessions and adds `server/discover`. It deprecates roots, sampling, and logging, and hardens OAuth (RFC 9207 issuer check, client metadata documents). | The client must negotiate down for older servers and follow the new OAuth rules. |
| bubblewrap 0.9 installs and runs in this container, and a sandboxed shell had no network. Seatbelt cannot be run here. | The Linux sandbox gets real tests. The Seatbelt profile is covered by unit tests and a live check on macOS. |
| ripgrep is on this container's PATH. It is not guaranteed on users' machines. | Search needs a JavaScript fallback. |

## Goals / Non-Goals

**Goals**

- One runtime that every surface drives, with identical tools and behavior except for
  rendering and who answers approvals.
- A transcript from which any run can be explained afterward.
- Consent that is fast to give well: modes, pattern rules, and remembered grants, with the
  rule behind every decision visible.
- A sandbox that makes "allow" safe enough to use.
- Transparency of model, context, cost, permissions, and sandbox at a glance.
- Extension through standard parts (commands, Agent Skills, hooks, MCP servers) bundled
  as plugins, and repeatable multi-step work through workflows.
- Protocol adapters that each carry a conformance suite.
- An interface that is keyboard-first, configurable, and accessible.
- Release binaries.

**Non-Goals**

- Memory, learning, preference models, or anything that writes durable facts about the
  user from sessions.
- Remote or hosted anything, and a background daemon.
- An npm release or a license file.
- Team mode or unbounded parallel agents.
- Loading third-party code into the JamCLI process.
- DAP and A2A support. See D20.

## Decisions

### D1. Rehaul in place, on Bun, in TypeScript

The core's module boundaries are kept and its internals are replaced where the audit
found defects. The interface is rebuilt on OpenTUI. Bun is the only runtime: OpenTUI
reaches its native library through `bun:ffi`, and `bun build --compile` produces the
release binaries.

**Why.** The audit found assembly and implementation defects, not a wrong architecture.
The registry, provider interface, policy resolver, rules, routing, anchors, and hook bus
are reused. Bun-only was already the default answer to the previous unit's first open
question.

**Alternatives.** A rewrite in Rust (Codex's choice) was rejected, as the previous unit
rejected it: it discards a tested core for startup time that lazy loading and compiled
binaries recover. Keeping a Node target was rejected, because OpenTUI does not run there.

### D2. One runtime, many surfaces

`src/core/runtime/` owns assembly. Every surface calls `createRuntime`:

```ts
export interface RuntimeOptions {
  projectRoot: string;
  cwd: string;
  surface: 'tui' | 'headless' | 'acp' | 'workflow' | 'child';
  sessionId?: string;               // resume
  model?: string;                   // "provider:model" override
  permissionMode?: PermissionMode;
  flags?: PermissionFlags;          // headless --allow-tool, --deny-tool, patterns
  signal?: AbortSignal;
}

export interface Runtime {
  readonly sessionId: string;
  readonly tools: ToolSummary[];    // what the model is offered, with schemas
  run(input: UserInput, onEvent?: (e: AgentEvent) => void): Promise<RunResult>;
  cancel(): void;
  setModel(ref: string): Promise<void>;
  setPermissionMode(mode: PermissionMode): void;
  compact(focus?: string): Promise<CompactionResult>;
  fork(atEvent?: number): Promise<string>;
  close(): Promise<void>;
}
```

The factory is the only place that constructs any of the following:

- the provider;
- the tool registry, with built-ins, MCP tools, skills, and plugin tools;
- the permission engine and the sandbox;
- rules, hooks, context management, and the trust gate;
- the transcript writer.

As built in 2.11, `run` takes the prompt text, and the runtime also exposes the resolved
model, the conversation, and the problems found while assembling (flags that name no tool,
MCP servers that did not connect). `setPermissionMode` arrives with the permission engine
(stage 3) and `compact` with context management (stage 4). The existing context manager
is not wired into the runtime: it can separate a tool call from its result (F20), and
wiring it into more surfaces before 4.3 makes it pair-safe would spread that defect.

A delegated run is a runtime too, with surface `child`, in the same process as its
parent. It decides with its parent's policy object, so neither its configuration nor any
flag can widen what the parent allows. A call the parent would ask about is asked of the
parent's surface, shown under the parent's `task` call as `<task id>/<child call id>`. A
background child cannot ask anyone, so such a call is not made and the child is told.
Its model comes from its category chain, its depth from its parent, and its session header
names the session that delegated to it. The earlier subprocess children are removed: they
could not ask, never learned their depth, and were never given the category table.

Surfaces differ in two ways only: how they render events, and how an `approval_request`
is answered. The interface asks the user. Headless answers from flags and policy. ACP
forwards the request to the editor. Workflows answer from the step's policy or pause.

**Why.** Every broken requirement in the audit traces to three assemblies drifting apart.
One factory makes "Share one core across consumers" true by construction. A conformance
test drives the same scripted session through each surface's assembly and asserts
identical tool lists, requests, and transcripts.

**Alternatives.** Keeping per-surface assembly and adding tests to keep it aligned was
rejected: three copies of the same wiring is the defect, and tests would only police it.

### D3. The turn engine

One user turn is a loop of steps. Each step:

1. Projects the transcript into provider messages. The system prompt comes first; the
   history follows in order (D4).
2. Streams the model's response. It emits text and reasoning deltas as they arrive, and a
   `tool_call` event as each call completes.
3. Records one assistant message holding the text, the reasoning blocks with any
   provider signature, and every tool call.
4. Executes the calls:
   - Each call is validated against its schema.
   - Each call is decided by the permission engine (D6). An `ask` emits `approval_request`
     and waits for the decision.
   - Each call runs with the run's abort signal and its timeout.
   - Consecutive read-only calls run concurrently. State-changing calls run one at a time,
     in order.
5. Records exactly one result per call. The status is one of `ok`, `error`, `denied`,
   `timeout`, or `cancelled`. A denial is a result the model sees ("Denied by the user:
   ..."), not a silent drop.
6. Ends the turn if the model made no tool calls. It also ends the turn if the user
   denied a call without giving feedback: the user takes back control, and the transcript
   shows why.

Cancellation aborts the stream and any running tool. Any call still unanswered gets a
`cancelled` result, so the transcript and the next request stay well formed.

The loop defaults are:

| Setting | Default | Notes |
|---|---|---|
| `max_steps` | 50 | In the interface, reaching the limit offers to continue. |
| `max_tool_calls_per_turn` | 0 (unlimited) | Kept, so a configuration can still cap it. |
| `tool_result_max_chars` | 30,000 | Truncation keeps the head and the tail, with a note stating how much was cut. |
| `command_timeout_ms` | 120,000 | |

Optional token and cost budgets stop a run when they are exceeded.

Retries live below the engine, in the provider layer (D8). A mid-stream failure after
output has begun is not retried: the partial output is recorded, and the error is reported.

**Why.** This removes F7 and F8 and keeps the transcript honest: what the model asked for,
what ran, and what was denied are all visible in order.

**Alternatives.**

- Aborting the whole batch when one call needs approval (today's behavior) was rejected:
  it silently discards the model's intent.
- Asking once for the whole batch was rejected: one decision would cover actions the user
  never saw individually.

### D4. The transcript is an append-only event log

Each session is one JSONL file at `.jamcli/history/<id>.jsonl`, the same location as
today. Version 2 lines carry `"v":2` and a type:

| Type | Records |
|---|---|
| `session` | id, creation time, project root, cwd, surface, parent (for forks), JamCLI version |
| `message` | one user, assistant, or tool message, exactly as later requests replay it (below) |
| `approval` | call id, allow or deny, who decided (user, policy, flag, mode, or hook), the surface, the rule, the scope of a grant, any feedback |
| `usage` | the tokens of one request, the model, and its cost once the ledger prices it |
| `compaction` | the summary, the number of messages it replaces, token counts before and after |
| `checkpoint` | git ref or backup id, files |
| `model` | a model switch |
| `notice` | anything else worth knowing, such as a trust gate removal |
| `end` | the status a turn ended with |

A user message holds the text with any expanded references. An assistant message holds
the model, provider family, text, reasoning blocks with their signatures, and every tool
call. A tool message holds the call id, the tool, its status, and the output the model
received, in which truncation is marked where it happened. One `message` type rather
than one type per role keeps the log and the provider projection the same shape, so
resume cannot drift from what was sent. Durations belong to traces (D13), not the log.

The `session` line is written with the first message, so a session that never gets one
leaves no file. The global index at `<state>/sessions.jsonl` is a cache of the files:
listings show only the current project's sessions, and the creation time is read from
the session file rather than kept from an earlier index entry.

Provider messages, interface rows, Markdown exports, and ACP `session/load` replays are
all projections of this log. Forking copies the events up to a point into a new file
whose `session` line names its parent. Rewinding forks at an earlier event and restores
the matching checkpoint (D15).

Version 1 files (one JSON line per turn, `{ id, timestamp, messages, usage }`) are read by
a separate reader and never rewritten. New turns on a resumed version 1 session are
appended as version 2 lines, and the reader handles mixed files.

Secret values from the environment are redacted from tool output before it reaches the
model or the log. Redaction applies to variables whose names match `*_KEY`, `*_TOKEN`,
`*_SECRET`, `*_PAT`, `*_CREDENTIALS`, `SECRET_*`, `*PASSWORD*`, and `*PASSWD*`, and to the
configured credentials, each replaced by `[redacted:<source>]`. Values shorter than eight
characters are left alone. It happens where a result is produced, in `executeBatch`, so
surfaces, the trust gate, the model, and the log all see the redacted text. Streamed
progress is redacted chunk by chunk, so a value split across two chunks can show in the
live view but never in the result.

**Why.** Promise three says an unwatched run must be explainable from its transcript. F17
shows text-only history cannot do that. Resume, fork, rewind, audit, export, and ACP
session loading all need the same record, and one record is simpler than five.

### D5. The tool set

One tool per job is advertised to the model:

| Tool | Class | Notes |
|---|---|---|
| `read_file` | read | Numbered lines with anchors. `offset` and `limit` in lines, default 2,000 lines. Long lines are cut at 2,000 characters. Binary files are refused with their size. |
| `write_file` | write | Fixed (F4). `overwrite` is still required when the file exists. |
| `edit` | write | Find and replace with a literal replacement (F5). `replace_all` added. Anchors stay optional. Line endings are preserved. |
| `apply_patch` | write | One patch that may touch several files: unified diff, validated before any file is written, applied all or nothing. |
| `glob` | read | Paths by pattern, newest first. |
| `grep` | read | Regular expression search. Output modes: content with context, files only, or counts. |
| `run_command` | execute | Described below. |
| `command_output`, `command_kill` | read, execute | For commands started in the background. |
| `todo_write`, `todo_read` | state | Unchanged. |
| `git_status`, `git_diff`, `git_log` | read | |
| `git_commit` | write | D15. |
| `task` and its status, result, and cancel tools | delegate | |
| `delegate` and its status, result, and cancel tools | delegate | |
| `web_fetch` | network | A URL to readable text. Asks by default. |
| `skill` | read | D16. |
| `lsp` | read | D20. |

`list_files` and `search_code` remain registered as aliases of `glob` and `grep`, so
existing permission entries and profiles keep working, but they are not advertised.

`run_command` is rebuilt on `spawn`:

- It runs through `/bin/sh -c`, inside the sandbox when one is active (D7), with the minimal
  environment.
- `timeout_ms` defaults to the loop setting.
- The result carries the exit code or signal, and stdout and stderr labeled when both are
  present. Output past the character limit is cut in the middle, keeping the head and the
  tail.
- It streams `tool_progress` events.
- It can start in the background and return a job id instead.

`grep` and `glob` use `rg` when it is on PATH (`rg --json`, `rg --files`). Otherwise they
use a JavaScript walk that honors `.gitignore`, `.ignore`, and the configured ignore
patterns through the `ignore` package. There is no silent file cap: if a time or match
limit is reached, the result says so and says how far the search got.

Path checks resolve symbolic links with `realpath` on the nearest existing ancestor
before comparing against the project root and any configured additional directories.

**Why.** F2 to F5, F11, F12, and F22. Two tools for the same job measurably confuse
models, so the duplicates become aliases.

### D6. The permission engine

**Modes.** A mode sets the default for each tool class:

| Mode | read | write | execute | network | delegate |
|---|---|---|---|---|---|
| `plan` | allow | deny | deny | ask | deny |
| `default` | allow | ask | ask | ask | ask |
| `accept-edits` | allow | allow inside the project | ask | ask | ask |
| `auto` | allow | allow inside the project | allow inside the sandbox | ask | allow |
| `bypass` | allow | allow | allow | allow | allow |

In `plan`, a denial is phrased so the model knows it is planning.

Two modes have preconditions:

- `auto` requires a working sandbox. Without one, JamCLI refuses to enter it and says why.
- `bypass` requires `--dangerously-bypass-permissions` or a confirmation in the interface.
  It is shown in red in the status line and recorded on the session line of the
  transcript.

**Rules.** Rules refine modes. A rule is `Tool` or `Tool(pattern)`:

| Tool kind | What the pattern matches | Example |
|---|---|---|
| Path tools (`read_file`, `write_file`, `edit`, `apply_patch`, `glob`, `grep`) | a glob against the project-relative path | `edit(src/**)` |
| `run_command` | a command prefix, where `*` matches any remainder | `run_command(npm test*)` |
| `web_fetch` | a domain | `web_fetch(domain:docs.python.org)` |
| MCP tools | the namespaced name, with wildcards | `github__*` |

Rules come in `deny`, `ask`, and `allow` lists. They are collected from several scopes:

- built-in defaults;
- user configuration;
- project configuration;
- project-local configuration;
- session grants;
- the run's flags.

**Deny wins over ask, and ask wins over allow, across all scopes.** A flag can allow a tool
that configuration asks about, but it can never allow a tool that any scope denies.

As built (3.1), that sentence is made exact: a deny from any scope wins; then a person's
own choices for this run, the flag and session scopes, decide with ask before allow; then
the configured scopes (built-in, user, project, project-local) decide with ask before
allow; then the mode. So `--allow-tool run_command` beats a configured ask (F10), a
session grant stops the prompts it was made for, and a project file cannot quietly widen
a user's ask.

Details settled in 3.1:

- In a command pattern, `*` matches any characters, and a trailing ` *` also matches the
  bare command, so `npm test *` covers `npm test` and `npm test --watch`.
- Splitting also covers `&`, subshells, `if`/`then` and loop keywords, comments, and
  here-documents, whose bodies are data unless an unquoted one substitutes.
- Besides substitution, `eval`, `source`, a shell run with `-c`, `xargs`, and `find -exec`
  always ask, because their real command is an argument no rule can see. Bypass mode
  allows even these; nothing else does.
- A path is judged by its project-relative form, its absolute form, and its real path, so
  a symbolic link cannot carry a call past a rule about where it points. Path rules
  ignore case on macOS and Windows.
- The built-in scope allows `cd` and `pwd`, so a granted command still runs after a
  change of directory.
- Legacy entries that only restate the defaults JamCLI wrote into `mcp.json` are not
  rules; otherwise every project's default `run_command` entry would outrank grants.
- The `state` class (the todo list) is allowed in every mode, and a tool with no class is
  treated as `execute`. `task_status` and `task_result` are `read`.

Wired into the runtime (3.2):

- A tool that a rule without a pattern denies, or that the mode denies by class, is not
  offered at all. In plan mode, the system prompt says why. A call that reaches a denial
  anyway is answered `Not run:` with the reason, and the rest of the step goes on.
- Only a person's denial takes back the rest of a step. A denial by a rule, the mode, or
  a headless surface answers that one call.
- A mode whose precondition fails at startup, such as `auto` without a sandbox or `bypass`
  written in a file, falls back to `default` with a notice naming the setting. `bypass`
  starts only from `--dangerously-bypass-permissions`.
- The session line records the starting mode, and a `permission_mode` event records each
  switch. Allowed changes are recorded with who allowed them and why; reads and the
  todo list are not.
- A delegated run decides with its parent's engine, so a session grant or a mode switch in
  the parent applies to it too.

Every decision returns the rule and scope that produced it. That provenance is shown in
the approval prompt and recorded in the transcript.

**Compound commands.** A command is split on `;`, `&&`, `||`, `|`, and newlines. Each part
must be allowed for the whole to be allowed. Command substitution, process substitution,
and redirection to paths outside the project always ask, regardless of rules.

**Grants.** The approval prompt offers four choices:

- allow once;
- allow a suggested pattern for the session;
- allow it for the project, which is written to `.jamcli/config.local.json`;
- deny, with or without feedback.

**Compatibility.** The legacy `tools` block in `.jamcli/mcp.json` maps onto rules:

| Legacy entry | Rule |
|---|---|
| `allowed: false` | deny |
| `require_approval: true` | ask |
| otherwise | allow |

`--allow-tool X` becomes an allow rule for `X` at flag scope, which fixes F10.
`--deny-tool X` becomes a deny rule. `--allowed-tools` and `--disallowed-tools` take the
pattern syntax, and `--permission-mode` selects a mode.

`--dry-run` is not plan mode, because plan mode hides the tools that change things, so
there would be nothing to report. A dry run offers every tool the mode offers and runs
the reads, and each call that would change anything is answered as not made and listed
in the report with the diff or command the approval prompt would have shown (3.8).

**Why.** F10, plus parity with Claude Code, Codex, and OpenCode, which all ship modes and
pattern rules. Precedence rules that let a single flag widen access past a deny are how
agents end up with credentials they should not have.

**Alternatives.** A policy language such as Rego or CEL was rejected, because it is too
much surface for a personal tool. Per-tool booleans alone, today's model, were rejected
because they force a choice between prompts on every command and allowing every command.

### D7. The command sandbox

`src/core/sandbox/` has three adapters behind one interface:

```ts
interface Sandbox {
  readonly kind: 'none' | 'bwrap' | 'seatbelt';
  wrap(command: string, opts: { cwd: string; env: Record<string, string>; network: boolean }): { file: string; args: string[] };
}
```

- **bwrap (Linux).** The root is bound read-only. The project, the extra writable
  directories, and a private `/tmp` are bound writable. `/dev` and `/proc` are fresh.
  Hidden paths are covered by empty tmpfs. The adapter also uses `--unshare-net` unless
  network is allowed, `--unshare-pid`, `--die-with-parent`, and `--new-session`.
- **Seatbelt (macOS).** `sandbox-exec` runs a generated profile that denies by default,
  allows reading, allows writing to the project and temporary directories, denies the
  network unless allowed, and denies reading hidden paths.
- **none.** Used on Windows or when the sandbox is disabled. The status line says
  "unsandboxed", and `auto` mode is unavailable.

As built (3.4), the sandbox is on by default wherever it starts, found by a probe that
really runs it, and `sandbox.enabled: false` turns it off. `/tmp` inside bubblewrap is a
private tmpfs, so writes there vanish with the command. A failed command that ran in a
sandbox says so in its result and names `sandbox.network` and `sandbox.writable`, the
settings that widen it. MCP servers the user configured are not sandboxed; plugin servers
are, with their declared permissions (D18). The Seatbelt profile allows reading, then
denies the hidden paths, because in a profile the last matching rule wins; it stays
unverified until 3.7 runs it on a Mac.

The escape suite (3.6) found that a read-only mount does not stop connecting to a Unix
socket, so a sandboxed command could reach the Docker daemon or an SSH agent. bubblewrap
now mounts an empty `/run`, which holds the Docker, containerd, podman, and user session
sockets. It also hides Docker Desktop's and 1Password's socket directories and the socket
`SSH_AUTH_SOCK` names, and Seatbelt allows no Unix sockets while the network is off.
Sockets elsewhere stay reachable under bubblewrap. Closing them all needs a seccomp
filter, which is recorded as a residual risk in `docs/security.md` (stage 12).

The hidden paths by default are `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.azure`,
`~/.config/gcloud`, `~/.config/gh`, `~/.docker/config.json`, `~/.kube`, `~/.netrc`, and
`~/.npmrc`. The list is configurable.

The same wrapping applies to user hooks, plugin hooks, plugin MCP servers, and the
language servers JamCLI starts, each with its own declared permissions (D17, D18).

**Environment.** Every subprocess JamCLI starts gets a minimal environment:

- `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `LANG`, `LC_*`, `TMPDIR`, `TZ`;
- `JAMCLI_*` context variables;
- names listed in `sandbox.env_passthrough` or declared by an MCP server entry or plugin.

Provider keys are never passed unless named explicitly. This applies inside and outside
the sandbox, which fixes F11's and F23's leak.

As built (3.5), that list is the `minimal` policy, and the default is `scrubbed`: every
variable passes except those whose names look like credentials (`KEY`, `SECRET`, `TOKEN`,
`PASSWORD`, `PASSWD`, `CREDENTIAL`, or a `_PAT` suffix) and each provider's configured
`key_env_var`. The minimal list strips `JAVA_HOME`, `GOPATH`, `SSH_AUTH_SOCK`, proxies,
and virtual environments, which real builds and pushes need, while credentials are what
the rule exists to stop; Codex makes the same choice. `sandbox.env: "minimal"` restores
the list. `sandbox.env_passthrough` names variables every process gets, and an MCP
server or external agent entry's `env_passthrough` names the ones it gets, so a key
never has to be written into a project file.

**Why.** "Trust on a machine that holds real credentials" needs more than prompts.
Codex's default workspace-write sandbox with network off, and Claude Code's sandbox, show
that sandboxing is what makes allowing commands reasonable.

### D8. Providers

The `ChatProvider` interface keeps its shape and gains:

- **Reasoning blocks.** `{ type: 'thinking', text, signature? }` and
  `{ type: 'redacted', data }`, carried on the assistant message together with the
  provider family that produced them. They are replayed only to the same family; for any
  other family they are dropped from the request, and the text stays in the transcript.
  This fixes F14's rejected replay.
- **Cache hints.** The Anthropic adapter places `cache_control` breakpoints on the system
  prompt, the tool definitions, and the last user turn, and reports cache reads and writes
  in usage.
- **Thinking.** It is enabled for Anthropic models whose catalog entry supports it, with a
  budget from the reasoning level. Ollama's `think` and OpenRouter's `include_reasoning`
  stay as they are.
- **Output limits.** `max_tokens` comes from the catalog (D9) instead of a fixed 4,096,
  and there is no hardcoded model default: an unset model is a configuration error that
  names the key to set.
- **Streamed usage.** OpenAI-compatible streams request usage with
  `stream_options.include_usage`, and endpoints that reject the field get one retry
  without it.
- **Ollama context.** Requests set `options.num_ctx` from the catalog or configuration,
  which fixes F19.

**Retries.** `withRetry` wraps every request:

- It makes up to four attempts, with exponential backoff and jitter capped at 20 seconds.
- It honors `Retry-After` and `retry-after-ms`.
- It retries network errors and HTTP 408, 409, 429, 500, 502, 503, 504, and 529. Nothing
  else is retried.
- Each retry emits a `retry` event carrying the reason.

**Errors.** `ProviderError` carries the provider, the status, the error text from the body
(capped, with keys scrubbed), whether it is retryable, and a hint:

| Condition | Hint |
|---|---|
| Ollama connection refused | start `ollama serve` or choose another provider |
| 401 | name the key variable to set |
| 404 on a model | run `/model` |
| context length exceeded | compact and retry once |

**Deferred inside this unit.** An OpenAI Responses API adapter is a stage 4 task marked
optional. If it does not land, it is recorded as a gap in the feature matrix.
Chat Completions remains fully supported for OpenAI models.

### D9. Model catalog and cost

`src/core/catalog/` resolves a `ModelInfo` for any `provider:model`:

- context window;
- maximum output;
- whether it supports tools, reasoning, and images;
- prices per million tokens for input, output, cache read, and cache write.

Sources, in priority order:

1. configuration (`models` block);
2. provider metadata: OpenRouter `/models` (context and pricing), Ollama `/api/show`
   (context length and capabilities), Anthropic and OpenAI `/models` where fields exist;
3. a bundled table for major Anthropic and OpenAI models;
4. conservative defaults: 8,192 tokens of context, no price.

Provider metadata is cached for a day under the cache directory.

The cost ledger multiplies usage by price per request and accumulates per session and per
model. A model with no known price shows "unpriced", never a guessed number. Local models
cost zero.

**Why.** Context budgets (D10), the status line, `/cost`, and headless JSON all need these
numbers, and guessing them is how compaction fires too late or never.

As built (4.1), each fact resolves on its own: the first source that knows it wins, and
`ModelInfo.sources` records which one did, so a limit from the provider and a price from
the table can meet in one entry.

- **The bundled table** holds the twelve current and legacy Claude models, with aliases
  for the dated ones. Every number was checked on 2026-09-24 against platform.claude.com:
  the models overview, each model's page, and the pricing page. A test holds the rows to
  the published multipliers: a five-minute cache write is 1.25 times input, and a cache
  read is a tenth of input, except 0.025 on Claude Fable 5.1 and 0.05 on Claude Opus 5.5.
- **OpenAI rows are absent.** This environment's network policy blocks openai.com and
  openrouter.ai, so no OpenAI number could be checked, and D9 forbids a guessed one.
  OpenAI's own `/models` route reports no limits or prices, so an OpenAI model is known
  only through the `models` block. Until then its window is the default, and the first
  turn names the setting that fixes it. This is a gap in the feature matrix, closed by
  adding rows once they can be checked.
- **Provider metadata.** Ollama's `/api/show` gives the context length and capabilities.
  An OpenAI-compatible `/models` entry gives OpenRouter's limits, prices, and
  capabilities, and the context window under the names other servers use
  (`context_window`, `max_context_length`, `max_model_len`). Anthropic's
  `GET /v1/models/{id}` gives `max_input_tokens`, `max_tokens`, and the thinking style.
  A request is made once, never retried, and abandoned after three seconds. Only answers
  are cached, for a day, keyed by provider, configured endpoint, and model, so a provider
  that was down is asked again next time.
- **Ollama.** Ollama allocates the whole window it is asked for, so the catalog's window
  is the `num_ctx` sent: the model's `models` entry, then `api_registry.ollama.num_ctx`,
  then the model's own limit capped at 16,384. Behind Ollama's `/v1` route the window
  cannot be requested, so it is not capped. Ollama models cost zero unless configured.
- **Gateways.** An endpoint that speaks the Anthropic dialect gets a bundled Claude row's
  limits but not its prices, because that endpoint sets its own.
- **Output requests** ask for the model's limit capped at `agent_loop.max_output_tokens`,
  32,000 by default. Every request reserves its output in the window (D10), and most
  replies need far less than 128,000. The cap is not about rate limits: Anthropic's
  rate-limit page says `max_tokens` does not count toward output tokens per minute. A
  model with no known limit sends none, so the server's default applies, and a reply cut
  off at the limit is reported with the limit and the setting.
- **Timing.** A session starts from what is known without the network, and each turn
  waits for the provider's answer, so the first request is sized from it. A switch
  resolves the new model the same way, and an answer about a model the session has
  already left is dropped.

### D10. Context management

Context management is on by default. The budget is the model's context window, minus the
output reserve, minus a 10 percent margin. It triggers at 85 percent of the budget.

Token counts are estimated from all message content, including tool call arguments and
reasoning, and are corrected per session by the ratio between the estimate and the
provider's reported prompt tokens.

Compaction summarizes older turns into a user message that opens "Summary of the earlier
conversation". It keeps the most recent turns verbatim, and it never separates an
assistant tool call from its results: the boundary moves to the nearest user message.
`/compact [focus]` forces it, and a focus steers the summary.

A failed summary falls back to dropping whole older turns, and the notice says so. The
`compaction` event carries token counts before and after, which fixes F20.

### D11. Layered configuration

Configuration is resolved from these layers, lowest to highest:

1. built-in defaults;
2. user (`~/.config/jamcli/config.json`, XDG aware);
3. project (`.jamcli/config.json`, plus the legacy `mcp.json` and `profiles/`);
4. project-local (`.jamcli/config.local.json`);
5. environment variables (`JAMCLI_MODEL`, `JAMCLI_PERMISSION_MODE`, `JAMCLI_CONFIG_DIR`,
   and similar);
6. flags.

Objects merge deeply. Permission rule lists concatenate across layers, and deny rules from
any layer apply. Every resolved value remembers its layer, so
`jamcli config list --show-origin` can print it.

Zod schemas are the source of truth. `z.toJSONSchema` generates `docs/config.schema.json`
for editor completion, and configuration errors name the file, the key, and the expected
shape.

Nothing is written on startup. `.jamcli/` is created the first time something must be
stored there (history, a project grant, `jamcli config set --scope project`), and it is
created with a `.gitignore` containing `*`, so it ignores itself in any repository. This
fixes F18.

**Migration.** Existing `.jamcli/config.json`, `mcp.json`, and profile files are read
as-is. `jamcli config migrate` is optional. It moves the legacy permission block into
`permissions` rules, keeping a backup, and never runs implicitly.

### D12. Credentials

Keys are resolved from these sources, in order:

1. the endpoint's `key_env_var`;
2. the provider's well-known environment variable;
3. the OS keychain: macOS `security`, or Linux `secret-tool` when libsecret is present;
4. a `0600` file in the user config directory, used only when no keychain exists, with a
   warning.

A key found in a project file still works, but `jamcli doctor` and `jamcli audit` report
it as a finding.

`jamcli auth set|get|remove <provider>` manages stored keys. `jamcli auth login openrouter`
runs OpenRouter's PKCE flow:

1. JamCLI starts a local callback server on a random port.
2. It opens the browser.
3. It exchanges the code for a user-controlled key.
4. It stores the key in the keychain.

No vendor subscription is driven through a third-party flow. The README warning from the
previous unit stands.

### D13. Observability

- **Logs.** Structured JSON lines go to `~/.local/state/jamcli/logs/`. `-v` adds info,
  `-vv` adds debug, `--log-file` redirects. Logs never contain keys, and prompts and
  outputs are included only at debug level.
- **Trace.** `--trace-file <path>` writes spans (session, turn, model request, tool call,
  hook, compaction) as JSON lines locally.
- **OpenTelemetry.** An opt-in exporter posts OTLP/HTTP JSON to a configured endpoint. It
  honors the standard `OTEL_EXPORTER_OTLP_*` variables and uses the GenAI semantic
  conventions: `gen_ai.provider.name`, `gen_ai.request.model`,
  `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, and tool names.
  - Prompt and output content are excluded unless `otel.include_content` is set.
  - The exporter is written in about 200 lines rather than taken from the OpenTelemetry
    SDK, because the SDK would roughly double the dependency tree for one exporter.
  - An in-memory collector in tests validates payload shape.
- **Default.** `telemetry` stays `false` and the exporter is off. Nothing leaves the
  machine unless configured.

### D14. The interface

**Stack.** `@opentui/core` and `@opentui/react` at exact versions, with React 19.2 and
Zustand for view state. The interface stays render-only: it subscribes to runtime events,
reduces them into view state with a pure reducer that is unit tested, and forwards input.

**Layout, top to bottom:**

1. **Header.** Project, git branch, and session title.
2. **Transcript.** A scroll box with windowed rendering.
   - User messages.
   - Assistant Markdown with highlighted code through OpenTUI's code renderable.
   - Collapsible tool blocks, each with an icon, the tool, a short argument summary,
     status, and duration.
   - Diffs for edits through the diff renderable.
   - Command output tails.
   - Notices.
3. **Permission prompt.** Replaces the composer while pending. It shows:
   - the action in one line;
   - a preview (diff, command, or arguments);
   - the rule or mode that asked;
   - the choices: 1 allow once, 2 allow the suggested pattern for the session, 3 allow for
     the project, 4 deny with feedback.
   Escape denies.
4. **Composer.** A multi-line text area.
   - `@` opens file completion; MCP resources appear there after stage 9.
   - `/` opens the command palette.
   - `!` runs a shell command through the same permission path.
   - `#` opens a note to `AGENTS.md`.
5. **Status line.** Permission mode, `provider:model`, context percentage, session cost,
   sandbox kind, MCP and LSP counts, and the owner's status indicator styles. The shimmer
   and spinner styles, and custom styles, are kept.

**Keys**, rebindable in `~/.config/jamcli/keybindings.json`:

| Key | Action |
|---|---|
| Enter | send |
| Shift+Enter or Ctrl+J | newline |
| Escape | interrupt, or close an overlay |
| Escape Escape | rewind menu |
| Shift+Tab | cycle permission mode |
| Ctrl+R | history search |
| Ctrl+O | tool detail |
| Ctrl+T | todo panel |
| Ctrl+L | redraw |
| Ctrl+C twice | exit |
| `?` | help |

**Themes and accessibility.**

- Themes: dark, light, high contrast, and a monochrome theme forced by `NO_COLOR`.
- Truecolor is used when the terminal reports it. No information is carried by color
  alone: every status has an icon and a word.
- `--screen-reader` (or `ui.screen_reader`) switches to a linear rendering: no animation,
  no box drawing, each event announced as a labeled line.
- `ui.reduced_motion` stops shimmer and spinners.

**Onboarding.** On first run with no user configuration, the interface:

1. checks Ollama and lists its tool-capable models;
2. offers to pull a recommended coding model;
3. detects provider keys in the environment;
4. explains the permission modes;
5. writes user configuration only.

`jamcli doctor` runs the same checks non-interactively.

**Tests.** Frame-text snapshots of key states through the OpenTUI test renderer, with
mock keys driving flows. Snapshots compare text, not escape codes. This amends the
testing strategy in `project.md`, per the owner's decision.

**Benchmark gate.** Before Ink is removed, a pseudo-terminal harness (Python's `pty`
module driving the real binary) loads a 1,000-message session and measures keystroke
echo latency and frame sizes. The same harness runs on OpenTUI. Both results are recorded
in `tasks.md`, and no performance claim is made without them.

### D15. Git workflows

**Checkpoints.** Before the first state-changing tool call of each step, in a git
repository, JamCLI:

1. builds a tree of the working copy through a temporary index
   (`GIT_INDEX_FILE=<tmp> git add -A`, then `git write-tree`), so ignored files stay out;
2. commits it with `git commit-tree` onto `refs/jamcli/checkpoints/<session>`.

This never touches the user's index, HEAD, branches, or stash. Outside a repository, the
files a write tool is about to change are copied into
`.jamcli/checkpoints/<session>/<n>/`.

**Undo and rewind.** `/undo` restores the previous checkpoint and `/rewind` picks one.

- Restoring writes blobs with `git cat-file`, and deletes files that were added since the
  checkpoint.
- Both show a diff preview and ask first.
- Rewinding can restore code, conversation, or both.

**Review.** `/diff` shows the working-tree diff by file and hunk. A hunk can be staged,
unstaged, or reverted through `git apply --cached` and `git apply -R`.

**Commit.** `git_commit` (model-facing) and `/commit` (user-facing) share one path:

1. Stage what the user chose.
2. Draft a conventional commit message from the staged diff.
3. Show the message, the files, and the diffstat in a dedicated approval prompt that no
   rule or mode can pre-approve, including `bypass` unless
   `git.allow_commit_in_bypass` is set.
4. Run `git commit` normally, so the repository's hooks run.

Attribution is off by default (`git.attribution`).

**Pull requests.** `/pr` pushes and opens a pull request through `gh`, when `gh` is
installed and authenticated. Push and pull request creation are each approved, and
JamCLI never handles GitHub tokens itself.

**Worktrees.** `--worktree <name>` and `task(isolation: "worktree")` run in
`git worktree add` directories, on `jamcli/<name>` branches.

**Why.** Authorized by the owner, and designed as the approval design `SEQUENCE.md` asked
for: commits and pushes are always explicit, and undo does not depend on the user's own
git state.

### D16. Commands and skills

**Commands** are Markdown files in `~/.config/jamcli/commands/` and
`.jamcli/commands/`.

- Optional YAML front matter sets `description`, `argument-hint`, `model`, and
  `allowed-tools`.
- The body supports `$ARGUMENTS`, `$1` to `$9`, and `@` references.
- A command becomes `/name`. Project commands shadow user commands, and the palette shows
  which source each command comes from.
- MCP prompts appear as `/server:prompt` after stage 9.

**Skills** follow the Agent Skills specification: a directory holding `SKILL.md` with
`name` and `description` front matter, plus optional files. Skills are discovered in
`~/.config/jamcli/skills/`, `.jamcli/skills/`, and `.agents/skills/`.

- The system prompt lists each skill's name and description. That is the first level of
  progressive disclosure.
- The `skill` tool returns the body and the list of bundled files.
- Bundled scripts run only through `run_command`, so the permission engine and the sandbox
  apply.
- `allowed-tools` in a skill narrows, and never widens, what runs while the skill is
  active.

**Why.** Both are plain files, so they are safe to share. The skills format is an open
standard that other CLIs read, so the owner's skills are portable in both directions.

### D17. User hooks

Configuration maps events to commands:

```json
"hooks": {
  "pre_tool": [{ "matcher": "run_command(git push*)", "command": "./scripts/guard.sh", "timeout_ms": 10000 }]
}
```

The events are `session_start`, `user_prompt_submit`, `pre_tool`, `post_tool`, `stop`,
`pre_compact`, `notification`, and `session_end`.

**Protocol.** A hook receives the event payload as JSON on stdin.

| Exit | Meaning |
|---|---|
| 0 | continue; stdout may return JSON |
| 2 | block; stderr is the reason, and it is given to the model or the user |
| anything else | a reported hook failure; the turn continues |

The JSON on stdout may contain:

- `decision`: `allow`, `deny`, or `ask`;
- `reason`;
- `additional_context`: text appended to what the model sees;
- `updated_input`: replacement arguments, which are re-validated against the tool schema.

A hook decision is one more rule source, with the same precedence (deny first).

Hooks run with the minimal environment inside the sandbox. Project hooks need a one-time
trust confirmation per project, because opening a repository must not run its code. A
failing hook becomes a `notice`, never assistant text (F25).

The in-process hook bus stays as the internal mechanism, and user hooks subscribe to it.

**Why.** The protocol mirrors Claude Code's and Codex's hook contracts closely enough that
existing guard scripts work with small changes, and it keeps JamCLI's own surface small.

### D18. Plugins

A plugin is a directory with `jamcli-plugin.json`:

```json
{
  "name": "acme-tools",
  "version": "1.2.0",
  "description": "...",
  "engines": { "jamcli": ">=2.0.0 <3" },
  "permissions": { "network": ["api.acme.dev"], "env": ["ACME_TOKEN"], "filesystem": "project" },
  "contributes": {
    "commands": "commands/",
    "skills": "skills/",
    "hooks": "hooks.json",
    "mcpServers": { "acme": { "command": "./bin/acme-mcp", "args": [] } }
  }
}
```

**Install.** `jamcli plugin install <path | git-url[#ref]> [--scope user|project]`:

1. copies the plugin, or clones it at the ref;
2. resolves the commit;
3. computes a SHA-256 over the sorted file list and contents;
4. checks `engines`;
5. shows the declared permissions and every contribution;
6. asks for consent.

The plugin is stored under `~/.local/share/jamcli/plugins/<name>/<version>/` and recorded
in `plugins.lock.json` at the chosen scope, with the source, commit, integrity hash,
permissions, and time of consent.

**Lifecycle.** `list`, `enable`, `disable`, `update`, `remove`, and `verify`.

- `update` shows the permission difference and asks again when it grows.
- `verify` re-hashes installed plugins against the lockfile. A mismatch disables the
  plugin until the user reinstalls or consents again.

**Isolation.** Plugin code never loads into the JamCLI process. It runs only as:

- MCP servers;
- hook commands;
- scripts invoked through `run_command`.

All three are sandboxed, with the plugin's declared network and environment and nothing
more. Plugin tools reach the model through MCP, so the plugin's tool interface is MCP and
there is no second plugin protocol.

**Versioning.** Semantic versions, `engines` ranges checked with the `semver` package, and
the lockfile pinning exact commits.

**Why.** The owner authorized plugins, and `SEQUENCE.md` asked that an extension point wait
until the registry and hook bus had shown what a stable one looks like. Bundling existing
standard parts is the stable extension point: every piece already has its own contract
and tests, and isolation is by process boundary rather than by a JavaScript sandbox,
which is the class of design `vm2` showed to be unfixable.

**Alternatives.**

- In-process JavaScript plugins with a capability API (OpenCode's model) were rejected:
  they cannot be isolated without a separate process, and they need a stable internal
  API, which this project is not ready to promise.
- WebAssembly plugins were rejected, because no tool ecosystem targets them yet.

### D19. Workflows

A workflow is a YAML or JSON file in `.jamcli/workflows/` or `~/.config/jamcli/workflows/`:

```yaml
name: fix-and-verify
inputs: { issue: { type: string, required: true } }
concurrency: 2
steps:
  - id: plan
    agent: { category: deep, mode: plan, prompt: "Plan a fix for {{ inputs.issue }}" }
  - id: implement
    needs: [plan]
    agent: { category: quick, mode: accept-edits, prompt: "Implement this plan:\n{{ steps.plan.output }}" }
  - id: test
    needs: [implement]
    run: npm test
  - id: gate
    needs: [test]
    approval: { message: "Tests finished with {{ steps.test.status }}. Commit?" }
  - id: commit
    needs: [gate]
    when: "steps.test.status == 'ok'"
    commit: { message: agent }
```

**Step kinds:**

| Kind | Runs |
|---|---|
| `agent` | a runtime turn with its own category, mode, and tool rules |
| `run` | a command, through the permission engine and the sandbox |
| `tool` | one registry tool |
| `approval` | a human gate |
| `commit` | the D15 commit path |
| `workflow` | a nested workflow |

Steps form a directed acyclic graph through `needs`, which is validated for cycles when
loaded. `when` conditions use a small, non-evaluating expression grammar: property paths,
comparisons, `and`, `or`, `not`, and string, number, and boolean literals. Templates use
`{{ path }}` only.

**Execution.** Each step moves through `pending`, `running`, and then one of `ok`,
`failed`, `skipped`, `waiting`, or `cancelled`. The run log at
`.jamcli/workflows/runs/<run-id>.jsonl` records every transition and output, so
`jamcli workflow resume <run-id>` restarts at the first step that is not finished.

- Steps whose `needs` are met run concurrently, up to `concurrency`, which defaults to 1
  and is capped at 4.
- A failed step fails its dependents unless they set `continue_on_error`.

**Approval steps.** In the interface they prompt. Headless, they pause the run in
`waiting`. `jamcli workflow approve <run-id> <step>` resumes it.

**Triggers.**

- Manual: `jamcli workflow run <name> --input issue=...`.
- Git hooks: `jamcli workflow hook install <git-hook> <name>` writes a small hook script.
- Schedules: `jamcli workflow schedule <name> --cron "<expr>"` writes a user crontab entry
  on Linux, a launchd agent on macOS, or a Windows scheduled task. `unschedule` and `list`
  manage them.

There is no daemon. A schedule is the operating system running
`jamcli workflow run --headless`.

**Why.** Authorized by the owner. The parallelism cap and the no-daemon rule keep it clear
of the rejected team-mode item and the local-first constraint.

### D20. Protocols

**JSON-RPC.** `src/core/protocols/jsonrpc/` holds one JSON-RPC 2.0 message layer with two
framings: newline-delimited (hand-rolled ACP until stage 9) and `Content-Length` (LSP).
Once ACP and MCP move to their official SDKs, LSP is the only user of the hand-rolled
layer, and ACP's hand-rolled framing is deleted.

**MCP.** The client moves to `@modelcontextprotocol/client` 2.x.

- **Negotiation.** It uses `server/discover` when a server offers it and falls back to
  2025-11-25 and older versions otherwise. If the v2 client cannot reach older servers, the
  1.x client is kept behind the same adapter for those servers only, and that is recorded
  as a delta.
- **OAuth.** Authorization code with PKCE, client metadata documents with dynamic
  registration as a fallback, and the RFC 9207 issuer check. Tokens are stored in the
  keychain (D12).
- **Elicitation.** Form requests become an interface prompt. URL requests open the
  browser after asking.
- **Prompts and resources.** Prompts become slash commands and resources become `@`
  references.
- **Environment.** Servers get the minimal environment plus their declared `env`.
- **Tool search.** When MCP tools exceed a configurable count, their schemas are deferred
  behind `search_tools`, replacing the regular expression gate.

**ACP.** The server moves to `@agentclientprotocol/sdk` and gains:

- `session/load` (a transcript replay);
- `session/set_mode` (permission modes);
- plans (from the todo tools) and available commands;
- tool call content with diffs;
- permission options that map onto grants (D6).

When the client advertises file system or terminal capabilities, reads and writes of open
files go through the editor, and commands can run in its terminals. The ACP client used
for delegation moves to the SDK's client connection.

**LSP.** `src/core/lsp/` starts configured language servers, and auto-detects
`typescript-language-server`, `pyright-langserver`, `gopls`, and `rust-analyzer` on PATH.
They run in the sandbox, one per language per project, started lazily.

- After `edit`, `write_file`, or `apply_patch`, JamCLI waits up to 1.5 seconds for
  diagnostics and appends errors in the changed files to the tool result.
- The `lsp` tool offers definition, references, hover, document symbols, and workspace
  symbols.

**Not implemented, with reasons, in `docs/conformance.md`:**

- **DAP.** No evidence yet that a debugger protocol helps an agent loop more than running
  tests, and no surveyed CLI ships it in its core loop.
- **A2A.** ACP already covers agent-to-agent delegation for this project's use.
- **An MCP server mode.** ACP is the surface for driving JamCLI.

**Conformance.** Each implemented protocol gets a suite that runs in CI:

| Protocol | How it is tested |
|---|---|
| MCP | the official reference servers over both transports, plus recorded fixtures |
| ACP | every message validated against the ACP schema, plus an SDK client driving the built binary |
| LSP | a scripted fake server, plus a smoke test against `typescript-language-server` when present |
| OTLP | payload validation |
| JSON-RPC | framing property tests |

### D21. The trust gate

Behavior is unchanged, with three repairs:

- Tool output in the classifier prompt is escaped and length-bounded.
- The gate runs on every surface through the runtime.
- Its availability is reported accurately in `/config` and `jamcli doctor`.

Whether low-relevance results should be dropped or only flagged is left as an open
question for the owner (see Open Questions). The default stays as the owner designed it.

### D22. Build, CI, and release

**Build.** `bun run build` becomes `bun build src/index.tsx --target bun --outdir dist`
with a `#!/usr/bin/env bun` banner, and `tsup` is removed. `bun run compile` produces
single-file binaries:

- `bun-linux-x64`
- `bun-linux-arm64`
- `bun-darwin-arm64`
- `bun-darwin-x64`
- `bun-windows-x64`

OpenTUI's native library is embedded per target. The bundled tree-sitter assets are
checked in a binary smoke test.

**Startup.** `src/index.tsx` imports nothing heavy. It dispatches on the arguments first
and dynamically imports the interface, the ACP server, or the headless runner.

**CI.** Pinned by commit SHA:

- **gates** on Linux, macOS, and Windows;
- **e2e**: headless, ACP, interface snapshots, and sandbox tests on Linux with bubblewrap
  installed;
- **conformance**;
- **performance**: startup and render budgets;
- **security**: secret scanning, dependency review, and `bun audit` when available.

**Release.** On a `v*` tag:

1. compile all targets;
2. write `SHA256SUMS`;
3. generate a CycloneDX SBOM;
4. attest build provenance with GitHub's attestation action;
5. create a draft GitHub Release with notes from `docs/CHANGELOG.md`.

There is no npm publish. Pushing a tag stays the owner's action.

### D23. Testing strategy

| Layer | What it covers |
|---|---|
| Unit | Pure modules, as today. |
| Integration | The runtime against the fake provider server (stage 1), with real tools in temporary directories. |
| Surface e2e | The built binary headless (`-p`, both JSON formats), ACP through the SDK client, and the interface through the OpenTUI test renderer and the pseudo-terminal harness. |
| Sandbox | A hostile fixture tries to read `~/.ssh`, write outside the project, reach the network, and read provider keys from the environment. Each attempt must fail under bubblewrap. |
| Plugin | A plugin whose MCP server tries the same things. A plugin with a tampered file must fail `verify`. |
| Conformance | D20. |
| Migration | Fixtures of version 1 history and legacy configuration must load, resume, and export. |
| Performance | D24. |

Every new test is shown able to fail by a mutation probe, as in the previous unit.

### D24. Performance budgets

Measured in CI from stage 5 onward, on Linux runners, as medians of five runs:

| Measure | Budget | At the start |
|---|---|---|
| `jamcli --version` | 60 ms | 350 to 560 ms |
| Headless overhead before the first provider byte, fake provider, no MCP | 150 ms | not measured |
| Interface first frame | 250 ms | not measured |
| Keystroke to frame, p95, 1,000-message transcript | 16 ms | measured in stage 6 |
| Idle interface resident memory | 150 MB | not measured |
| `grep` across 20,000 files with ripgrep present | 500 ms | not measured |

A budget miss fails the performance job. A budget may only move with a recorded
measurement and a reason in `tasks.md`.

## Risks / Trade-offs

- **Scope.** Twelve stages in one unit, and the project has stalled before. The stages are
  ordered so every checkpoint is usable, the stopped point is always the last checked
  task, and stage 2 alone restores the promises.
- **OpenTUI is pre-1.0.** Versions are pinned exactly. The interface talks to OpenTUI
  through a thin component layer, and the pure reducer keeps view logic testable without
  it.
- **The MCP v2 packages are new.** The client sits behind JamCLI's own `McpClient`
  interface, with a documented fallback (D20).
- **Seatbelt cannot be exercised here.** Its profile generator is unit tested, and live
  verification on macOS is an explicit task that stays unchecked until it has been run.
  Windows has no sandbox and says so.
- **Live local models cannot be run in this container.** The fake provider server covers
  the wire formats. A live Ollama run with no network is an explicit task for the owner's
  machine.
- **Sandboxing can break real commands.** Tools that need network access or write outside
  the project will fail inside the sandbox. The error names the sandbox and the setting
  that widens it, and `auto` mode asks instead of failing where it can predict the need.
- **More prompts could train users to click through.** Pattern suggestions and project
  grants exist so that the second identical prompt does not happen.
- **Egress limits here.** The OpenAI documentation and the MCP specification site are
  blocked from this container, so some feature matrix cells cite secondary sources until
  checked.
- **`master` has an unrelated history.** Merging is the owner's action and is out of scope
  for this unit.

## Migration Plan

- **History.** Version 1 files load through the version 1 reader, resume, and export.
  New writes are version 2. Nothing is rewritten.
- **Configuration.** All existing files load unchanged. New keys have defaults.
  `jamcli config migrate` is optional and keeps backups.
- **Command line.** Every existing flag and subcommand keeps working. `--allow-tool` now
  does what its help text says. Exit codes stay 0, 1, and 2, and 130 is added for an
  interrupted run.
- **Tools.** `list_files` and `search_code` remain as aliases.
- **Install.** `bun link` for development and release binaries for use. The `npm link` and
  `npm install -g .` instructions are replaced, because the bundle now needs Bun.
- **Rollback.** Stage 2 through stage 5 checkpoints keep the Ink interface. Stage 6
  removes it in its last commit, so reverting that commit restores it.
- `docs/migration.md` lists each change with its reason.

## Open Questions

Each carries the default that applies until the owner decides. None blocks work.

1. **Trust gate relevance filtering.** Keep dropping results a classifier scores as
   irrelevant, or only flag them and keep them in context? Default: keep dropping, as
   designed. Recommendation: flag, because withholding a result the model asked for is
   hard to square with "the loop is honest".
2. **History location.** Keep sessions under the project's `.jamcli/history/`, or move them
   under the user state directory keyed by project path so no project directory is
   created at all? Default: keep the project location, per the existing spec.
3. **Compatibility directories.** Should JamCLI also read `.claude/commands/`,
   `.claude/skills/`, and Claude Code plugin layouts? Default: read `.agents/skills/` (the
   cross-tool location) but not vendor-specific directories. The latter can be added by
   configuration.
4. **Recommended local model for onboarding.** Default: suggest the most capable
   tool-calling coding model in Ollama's library that fits the machine's memory, chosen
   at runtime rather than hardcoded.
