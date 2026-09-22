# Design: Agentic Harness Core

## Context

JamCLI is roughly 9,600 lines of TypeScript across 38 source files. The terminal
interface works and looks deliberate. The agent behavior underneath it does not match
it, for four measured reasons that are documented in the proposal: two tool protocols
disagree, the loop is trapped inside a 3,318-line component, one model serves the whole
session, and tool output reaches context unscreened.

There is also uncommitted work in the tree: `+1,577/−20` across `package.json`,
`package-lock.json`, `Layout.tsx`, `LLMProvider.ts`, `McpManager.ts`, `store/index.ts`,
`types/mcp.ts`, and `ActionModal.tsx`, dated 2026-09-21. It contains a partially wired
native tool-calling path. This design builds on that work rather than replacing it, and
the first task is to park it in a commit so nothing below is built on an unrecorded
tree.

Three external artifacts inform the decisions here, and none of them are copied
wholesale:

- `x5iu/claude-code-adapter`, an unmodified clone at `/Users/jam/Code/claude-code-adapter`,
  demonstrates Anthropic Messages to OpenAI Chat Completions transcoding at roughly
  6,400 lines of test coverage. It is the reference for the translation seam, subject
  to a license check before any code is taken.
- `jamubc/opencode-langsearch` already implements a batched, fail-open classifier gate
  over untrusted tool output, with local deduplication ahead of any paid call. It is
  the reference for the trust gate, and its core is host-neutral by construction.
- `devloop`'s `harness/` splits a loop into `agent.ts`, `run.ts`, `sensor.ts`,
  `state.ts`, and `types.ts`. Its runtime is a stub, so it is the reference for the
  module shape only, not for behavior.

Constraints that bound every decision: local-first must keep working with no network
and no account; human-in-the-loop remains the default posture; no memory or learning
features; no license file; and the harness must stay legible enough to review.

## Goals / Non-Goals

**Goals**

- One tool protocol, with a truthful transcript of what ran.
- A core that runs a turn with no UI loaded.
- Tools, providers, routing, and policy as registries and config, so extending the
  harness does not mean editing a component.
- Delegation that lets a cheap model do cheap work and a strong model do hard work,
  with each child resolving its own model.
- Screening of untrusted tool output before it reaches context.
- A test and type gate so future changes can be proven.

**Non-Goals**

- Preserving the fenced JSON action format in any form, including as a fallback.
- Behavior parity with OpenCode, Claude Code, Hermes, or Codex. Where parity would
  require reimplementation, JamCLI delegates over ACP instead.
- Memory, consolidation, or self-improvement. See `project.md` for the prior result.
- Multi-agent visualization, team modes, or parallel member orchestration.
- Any hosted component or remote session store.
- Redesigning the terminal interface's appearance.

## Decisions

### Decision: OpenTUI is the committed substrate, Ink is interim

Ink 7.1.1 remains the renderer until it is replaced. The committed
destination is OpenTUI, maintained by the OpenCode team with OpenCode
itself as the production consumer, high npm adoption, and releases
landing several times a week.

**Why capability, not speed.** OpenTUI brings mouse input, a scrollbox,
select, textarea, selection, diff and code renderables, markdown, and
image support. None of those are obtainable from Ink without hand-rolled
windowing and input math that this project would then own.

**Alternatives considered.** Staying on Ink was rejected: no mouse, no
scrollbox, no diff widgets, and manual windowing for transcript
scrollback. A rewrite in Rust or Go was rejected: a full language
change for capability the current stack already provides. Termcn
(shadcn-labs/termcn) stays an evaluation candidate for the port, not a
decision: it ships AI chat primitives on both Ink and OpenTUI and may
replace hand-rolled pieces, but it is not vendored blindly.

**Accepted risks.** OpenTUI is pre-1.0, so the port pins exact versions
and never adopts snapshots. Its native library changes packaging (tsup
now, `bun build --compile` later). If the port stalls, the adapter
boundary this change establishes keeps Ink reachable until parity. No
performance win is claimed without before and after numbers on input
latency and frame behavior over a long transcript.

**Consequence for this change.** The core decoupling is what makes the
swap cheap, so none of this work is redirected. For the rest of this
unit: parity only, no new Ink-specific features, no polishing of Ink
idioms that OpenTUI replaces beyond what the checks require. `react`
and `@types/react` move to ^19.2.0 now because both Ink 7 and
@opentui/react require it.

### Decision: Native tool calls become the only protocol

Remove `TOOL_INSTRUCTION_PROMPT` (`src/components/Layout.tsx:147`) and the
`ActionParser.parse` fallback (`src/components/Layout.tsx:2921`). Keep and finish the
native path already present at `src/components/Layout.tsx:2312` and `:2319`.

**Why.** The provider APIs define exactly one way for a model to request a tool. The
fenced format is a text convention that requires the harness to guess intent from
prose, which means an action can be described without being taken and an example can be
executed as a command. Two parsers over one output stream also make failure
unattributable: when the wrong thing runs, nothing in the transcript says which parser
won.

**Alternatives considered.** Keeping fences as a fallback for models without tool
support was rejected: the fallback is what makes the primary path unprovable, and every
provider JamCLI currently targets supports native tools. Keeping fences for local models
specifically was rejected for the same reason; Ollama supports tool definitions.

**Consequence accepted.** The transcript for any model that was emitting fences will
change shape. Existing sessions are unaffected because history stores messages, not
actions.

### Decision: The core is headless, event-emitting, and owns approval as a callback

`src/core/` imports neither Ink nor React. It exposes a session runner that emits typed
events and takes an approval decision callback.

```ts
export interface Agent {
  run(session: JamSession, prompt: string, onEvent: (e: AgentEvent) => void): Promise<RunResult>;
  cancel(sessionId: string): void;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'approval_request'; call: ToolCall; decide: (ok: boolean) => void };
```

**Why.** Approval is the clearest case. Today the loop imports `ActionModal`. If the
core imports a modal, only a TUI can ever run it, which is why JamCLI has no headless
mode, no subagents, and no ACP surface. Emitting an event with a callback lets three
consumers answer the same question in three ways: the TUI presents the modal, headless
resolves from policy flags, and the ACP server asks the client for permission.

**Alternatives considered.** A dependency-injected approval interface was considered and
rejected as equivalent but noisier: the callback travels with the event, so the
consumer's identity is explicit in the transcript.

**Module shape.** Following `devloop`'s decomposition, which separates the loop from
the state and the sensing:

```
src/core/
  agent.ts        turn loop, cancellation
  sensor.ts       intent classification and tool selection for a turn
  state.ts        session state, message list, usage
  types.ts        event and session contracts
  tools/          registry plus one module per tool
  providers/      registry, openai-compatible client, anthropic seam
  routing/        categories, capability normalization, resolution
  context/        budget and compaction
  policy/         permissions, audit
  hooks/          event bus
  session/        persistence, resume, export
  rules/          instruction file discovery and injection
```

### Decision: Providers are one compatible client plus one translation seam

Replace the per-provider class switch with a single OpenAI-compatible client, and add
one Anthropic-shaped translation seam. Keep `OllamaProvider` and `OpenRouterProvider`
behavior by expressing them as configurations of the compatible client.

**Why.** The current `LLMFactory` throws for `openai` and `anthropic` while both appear
as valid configuration. Declaring providers that cannot be served is worse than not
declaring them. The compatible client already exists in substance: `LLMProvider.ts`
parses content, reasoning deltas, tool calls, and usage for the OpenRouter shape, which
is the OpenAI shape.

**Alternatives considered.** Writing a provider class per vendor was rejected because
it multiplies the surface for the same wire format. Routing Anthropic traffic through an
external proxy was rejected because it adds a required local process for a feature that
is a pure function of the request body.

**Reference.** The translation seam is the one place where `claude-code-adapter` is
study material, specifically its handling of tool calls and encrypted reasoning
signatures across the format boundary, and its split between request and stream
adapters. Its license must be checked before any code is taken; the design is what is
being reused regardless.

### Decision: Routing is by category, and a child never inherits the parent's model

A `categories` block maps a kind of work to an ordered model chain. Resolution walks the
chain and skips models whose provider is not configured.

**Why.** The owner has 77 models behind one provider and 376 behind another, and the
profile type carries a single `preferred_model`. Sending the strongest available model
to list files is waste, and sending a fast model to an architecture question is worse.
Naming the kind of work instead of the model is the transferable idea from OmO, and it
is the part of that project worth having.

**Prior evidence.** `deepseek-claude-wrapper` documents the exact failure to avoid:
Claude Code set the session model globally, subagents inherited it, and the wrong model
was billed. That project's fix was to never set the model globally and to let the
subagent model resolve independently. This design encodes that as a rule rather than a
workaround: `task` resolves the child's model from the child's category, always.

**Alternatives considered.** Inheriting the parent model by default with per-call
overrides was rejected because it reproduces the bug above. A single mid-tier model for
everything was rejected because it discards the provider mix entirely.

**Capability normalization.** A requested reasoning level is normalized against the
target model rather than sent blindly, so an unsupported level is dropped or downgraded
instead of causing a provider rejection.

### Decision: Delegation spawns a headless child process, not an in-process subagent

`task` runs `jamcli -p` as a child process with `--output-format stream-json`, consumes
its event stream, and returns the final result.

**Why.** The headless surface already has to exist for scriptability, so delegation
reuses it instead of adding a second execution model. A separate process gives real
isolation: a child that crashes, hangs, or leaks state cannot take the parent down, and
cancellation is a process signal rather than cooperative unwinding. It also means the
child's permissions, model, and working directory are arguments rather than shared
mutable state, which is what makes the never-inherit rule enforceable.

**Alternatives considered.** In-process subagents are faster to start and share loaded
providers, but they cannot provide isolation, they make cancellation cooperative, and a
child's tool registry would share memory with the parent. That trade is not worth the
startup cost saved.

**Bounds.** Delegation depth is capped by configuration, a child cannot widen its own
permissions, and background tasks are addressable for retrieval and cancellation.

### Decision: The trust gate is batched, injection-first, and fails open

Tool results are screened in one batched classification request before entering context.
Results classified as injections are dropped before relevance filtering. On any failure
the unmodified results are kept.

**Why.** JamCLI reads untrusted files while holding write and execute tools, which
`meta-agent` classifies as the critical combination. This is not hypothetical in this
environment: while the research for this proposal was running, `~/Documents/AGENTS.md`
was injected into a subagent's context as instructions simply because the scan entered
that directory.

**Prior art.** `jamubc/opencode-langsearch` implements this pattern and its design
choices are adopted almost unchanged: batched classification, local deduplication ahead
of the paid call, injection drops taking precedence, fail-open on error, and a hard rule
that filtering never reintroduces an injection. Its threshold calibration (containment
of 0.8 sitting inside a measured gap between distinct and duplicate content) is the
reason deduplication happens locally before any model call.

**Alternatives considered.** Blocking the turn on a gate failure was rejected: a
classifier outage must not stop the user working. Per-result classification calls were
rejected on cost and latency; batching is roughly an order of magnitude cheaper and
faster by the measurements in that project.

**Cost acknowledgment.** The gate adds one model call per turn that produces tool
results. It is disableable, and when disabled that fact is visible in configuration.

### Decision: Edits are anchored to content the model actually read

`read_file` returns line anchors; `edit` accepts anchors and validates them before
applying. A mismatch rejects the edit and returns fresh anchors.

**Why.** The dominant edit failure in this class of tool is a stale line reference: the
model read a file, something changed it, and the model's edit lands on the wrong lines.
The current `applyUnifiedPatch` path (`FileSystemService.ts:33`) trusts the incoming
patch completely.

**Alternatives considered.** Full hash-anchored editing with content hashes per line, as
OmO does, was rejected as heavier than this codebase needs. Plain find-and-replace with
an occurrence index, which `FileSystemService.applyEdit` already supports, is kept as the
primitive; anchors are the validation layer on top of it.

### Decision: Hooks are a small typed bus, not a plugin system

A typed event bus covers session start, turn start, pre-tool, post-tool, compaction, and
session end. Hooks can be disabled by configuration. A throwing hook is reported and the
turn continues.

**Why.** Cross-cutting behavior currently lives inside components, which is how
`Layout.tsx` reached 3,318 lines. The categories worth extracting are named by OmO's own
taxonomy: context injection, quality and safety, recovery, truncation, notifications,
and continuation. That list is the checklist for which concerns belong on the bus.

**Alternatives considered.** A full plugin system with third-party loading was rejected
as a non-goal for this change and a security surface without a demonstrated need.

### Decision: Repository hygiene lands first, and dependency majors land separately

Stage 1 parks the working tree, adds `bun test`, records the `tsc --noEmit` error count
as the regression baseline, removes `vm2`, and fixes `.gitignore`. Each dependency major
(TypeScript, Ink, Zustand, Zod) is a separate commit, with Zod last and the type gate
run between each.

**Why.** `vm2` is installed and unused in `src/` while being abandoned upstream with
known sandbox escapes. `.gitignore` currently ignores `*.md` at every level, which is
why this repository has no docs and why the existing modernization plan lives outside
the tree, in `.hermes/plans/`. Dependency majors compound with a large refactor if they
land together; separating them keeps the type gate interpretable.

**Alternatives considered.** Bumping dependencies inside the core extraction commits was
rejected because a type error would then have two possible causes.

### Decision: Markdown is tracked only inside `openspec/` and `docs/`

`.gitignore` keeps a bare `*.md` rule and adds negations for `openspec/**` and `docs/**`.

**Why.** The intent of ignoring markdown was to keep scratch notes out of the
repository, not to make specifications invisible to it. A negation is narrower than
removing the rule, so stray notes elsewhere stay untracked.

## Risks / Trade-offs

- **The core extraction touches every file.** It cannot land half done, and it is the
  largest single risk in the change. Mitigation: extract in slices with one commit per
  slice, using the running TUI as the regression test after each slice, and record the
  `tsc --noEmit` count before and after every slice.
- **Removing the fenced protocol may regress a model that was relying on it.** The
  consequence is a turn that produces no tool call rather than a wrong one, which is the
  safer failure. Mitigation: any prompt, profile, or rules file that documents the fence
  format must be updated in the same change, and the task list calls this out
  explicitly.
- **Delegation can run away on cost.** Child processes spend real tokens. Mitigation:
  bounded depth, bounded per-run turns, a configurable maximum concurrent children, and
  background results that must be explicitly retrieved.
- **The trust gate adds a model call per turn.** Mitigation: one batched call, local
  deduplication ahead of it, disableable, and never on the critical path when it fails.
- **Dependency majors may break the TUI.** Ink 7 in particular. Mitigation: one major per
  commit, type gate between each, and the TUI booted manually after each bump.
- **ACP delegation to third-party agents carries account risk.** Driving a vendor's
  subscription through a third-party protocol client can violate that vendor's terms,
  and the `agy` bridge is a documented example. Mitigation: keep an API-key path for any
  agent that offers one, default to agents the user already runs, and state the risk in
  the README rather than discovering it.
- **Scope.** This change is large enough that stalling is a real outcome, and this
  project has stalled before. Mitigation: stages are independently revertable, stage 1
  alone fixes the protocol defect that causes most visible unreliability, and
  `SEQUENCE.md` defines what "done" means so a partial state is identifiable rather
  than ambiguous.

## Migration Plan

No user data migration is required. Session history is JSONL and its format does not
change. Configuration changes are additive: new keys gain defaults, and existing
`api_registry` entries keep working as configurations of the compatible client.

**Rollback boundaries.** Each stage is revertable on its own:

1. **Hygiene and protocol.** Reverting restores the fenced parser. Nothing else
   depends on it.
2. **Core extraction.** The commit that introduces `src/core/` is the point of no
   return in one direction: reverting after the TUI has been rewired means reverting
   the TUI as well. Every commit after it must keep the TUI bootable, which is the check
   that makes partial progress safe.
3. **Tool layer, providers, routing.** Additive. Registries can carry both old and new
   entries during the transition.
4. **Delegation and trust gate.** Additive and independently disableable.
5. **Rules, hooks, policy, sessions, ACP.** Additive.

**Ordering constraint.** Stages 1 and 2 gate everything else. Within stage 3 and later,
work may land in any order except that `task` delegation requires both the headless mode
and category routing.

**Prompt migration.** Any profile `system_prompt_override`, project rules file, or
documented prompt that describes the JSON action block must be rewritten in stage 1.
This is a required task, not an optional cleanup, because those instructions become
actively misleading the moment the parser is removed.

## Open Questions

Each carries the default that applies if the owner does not decide. None of them block
implementation.

1. **Does the core stay on Bun, or target Node for the bundle?** Default: keep Bun as the
   only runtime, and set the bundle target to Node only if a Node-only install is ever
   wanted. Single-runtime is a feature while the harness is being rebuilt.
2. **Is anchored editing the default, or opt-in?** Default: on, since the failure it
   prevents is silent file corruption. If it proves annoying in practice it becomes a
   per-tool setting rather than a rewrite.
3. **What is the delegation budget cap?** Default: depth of two and a bounded concurrent
   child count, both configurable. The owner should set these from observed use rather
   than from a guess.
4. **Which agent is the primary ACP delegation target?** Default: Hermes, because it is
   already installed and configured, with the rest configured but unused until needed.
5. **Does the trust gate run for local-only sessions?** Default: yes if any tool result
   is present and a cheap model is configured, otherwise the gate reports itself as
   unavailable rather than silently passing results through unscreened. This is the one
   default worth revisiting, because a local-only user may have no model cheap enough
   to make the gate free.
