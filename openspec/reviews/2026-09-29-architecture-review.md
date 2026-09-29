# Architecture review, 2026-09-29

A whole-tree review of `master` at `949f99c`, with the gates run and HEAD diffed against
the working copy. Kept verbatim as the source of units R1 to R12 in `openspec/ROADMAP.md`;
the only changes are the opening table, redrawn as Markdown, and its three section
titles marked as headings.

---

I read the whole tree, ran the gates, and diffed HEAD against the working copy. Here is the state I verified before forming a view.

| Measure | Value |
|---|---|
| Source lines / test lines | 37,158 / 23,966 |
| Commits total / in the last seven days | 594 / 590 |
| Tests at HEAD | 1,199 pass, 0 fail, 159 s |
| Tests in the working tree | 14 fail, all from the uncommitted TUI and wording diff |
| Type errors | 0 |
| Commits on master not pushed | 71 |
| Tools offered / built-in commands / spec requirements | 35 / 25 / 83 |
| Real human approval decisions in your logs | 252, over 2.6 days, 81% in one project |

Everything below is marked verified when I read it in code or measured it, and inferred when I am reasoning from what I read.

## What it is, and what it should be

Thesis, from the code. JamCLI is a full-parity coding agent harness built at roughly 590 commits a week by agents under a spec process. The code delivers four things the competitors do not verifiably deliver, and the feature matrix marks most competitor cells as not verified, so I am judging on what your code does:

- Every permission verdict names who decided, the rule, its scope, and its source, and the transcript records it. That is Verdict in src/core/permissions/engine.ts and the approval event in src/core/transcript/events.ts. Verified.
- One append-only event log is the only state. Resume, fork, export, cost, handoff, and scoring are projections of it. Verified in src/core/transcript/events.ts and src/core/eval/score.ts.
- One assembly point for every surface, held by a conformance test. Verified in src/core/runtime/__tests__/surfaces.test.ts.
- The product is testable by an agent the way a person uses it, through the real binary in a pseudo-terminal. Verified in src/mcp/terminal.ts and src/__tests__/exercise.test.ts.

The stated wedge is not true. "Small enough to hold in your head" is contradicted by a 1,545-line assembly file, a 1,264-line App component, and 61,000 lines written in a week. "Local by default" is the least exercised path: the base request was measured at 4,516 tokens against a 4,526-token compaction trigger on the default 8k window, every test fakes Ollama, and your own notes say live runs use opencode-go only. Tiers landed and helped, but nothing in CI runs a real small model.

The structural problem. The roadmap is parity-driven. docs/feature-matrix.md sets the agenda and the units follow it. One person plus agents chasing three funded teams on breadth produces a weaker copy by construction, however fast the commits land. The defensible wedge is already in the code and is nowhere in the positioning: the auditable harness. Every action explained by a rule, every run reconstructible from one log, every surface identical and driven through the real program, on open models. That is a trust product for people who run agents on machines that hold credentials. Nobody else's wedge is that. jamcli audit today is a config and secrets check, not a decision ledger. The distinguishing feature is invisible in the product.

## What holds the weight

Load-bearing decisions, ranked by how much depends on them.

1. Transcript as the source of truth. Right, deliberate, and expensive to reverse. The implementation is not ready for scale: SessionLog.events() re-reads and re-parses the whole file from disk on every call, and it is called from checkpoint listing, notes, handoff, the gate ledger, fork, and close. The global session index is one JSONL rewritten whole on every update in src/core/transcript/sessions.ts. Schema evolution inside v2 is already ad hoc: the compaction event says a field is "absent in logs written before 4.3". Verified.
2. createRuntime as the single assembly point. Right idea, accidental shape. It is a 1,200-line closure with about 50 mutable bindings and 60 imports, returning about 50 methods. Children share the parent's PermissionEngine and WorkTable by reference in src/core/runtime/children.ts. A skill activation calls permissions.narrow on that shared engine, and only the top-level run's finally clause clears it. Inferred and not reproduced: a background child that activates a skill narrows its parent, and a parent turn ending un-narrows the child mid-skill. Because nothing can be tested short of the whole assembly, the suite takes two and a half minutes and needs 24,000 lines.
3. Harness behavior as hook subscribers. Steering, verification, LSP diagnostics, family tools, and handoff are 14 internal hooks.on registrations across three files, ordered by registration, on the same bus as user and plugin hooks. Deliberate per docs/harness-spec.md. The cost is that agent.ts no longer tells you what happens on post_tool. This is the hardest to reverse because HarnessOverrides threads a search surface through RuntimeOptions into the prompt, verify, steer, and tool paths.
4. Bun only, OpenTUI 0.5.12 pinned pre-1.0, TypeScript 7. Deliberate. Windows was already lost on this bet. 19 files import OpenTUI and 4,000 lines of interface sit on a 0.5 API. The four frame snapshots are the flakiest tests in the suite and will churn on every OpenTUI upgrade.
5. Policy as mode table times class times pattern rules, plus a hand-rolled shell analyzer. Right and well made. It fails closed: hidden constructs ask. Verified.

Complexity budget. Essential: agent.ts, dispatch.ts, permissions, sandbox, transcript, providers, context, one interface, headless. Accidental, and what I would delete or move, in order:

- Two configuration systems and three shapes. src/services/ConfigService.ts is still imported by the core runtime and children beside src/core/config/load.ts. The hand-written Config interface in src/types/config.ts sits beside the Zod ConfigFile. Verified.
- Two policy systems. src/core/policy/ is the legacy per-tool table beside src/core/permissions/. Verified.
- classifier/. Research that reached AUC 0.51 on 252 decisions, with nothing in src/ calling it. Its own README says so. Move it out.
- HarnessOverrides and scripts/harness-search. An LLM prompt-search loop threaded into production code paths, expecting dev and held-out task splits that are not in the repository. Keep trials outside the product.
- Research pipelines, reflection, and eval. Features about the agent rather than for the user. Reflection was decommissioned at 0 of 26, reopened, and its own exit criterion, task 6.2, was never run per openspec/SEQUENCE.md.
- Parity items with one user. Workflows with triggers and schedules, plugins with a lockfile, ACP client, LSP tool, web search providers. Each is fine alone. Together they are why a sitting became a week.
- The trust gate. A relevance filter at threshold 0.3 doing duty as an injection defense, with a 62% false positive on your own skill per the failure register. Make it a measured classifier or remove it. The sandbox and network-off default are the real defenses.
- M3 repeated-read refusal. Keyed on the tree the last changing step left, so an edit the person makes in their editor between steps does not move the key. Inferred from src/core/runtime/steer.ts: a legitimate re-read gets refused with a stale first line.
- Documentation mass. 5,096 lines of docs, a 2,141-line spec, a 927-line harness spec, plus SEQUENCE and ROADMAP. The README lists 13 pages as not yet written that all exist in docs/. docs/architecture.md says children are jamcli -p processes; children.ts says they run in-process. The docs are diverging at one week old.

## What breaks, what you are not seeing, and the order

At 10x usage. Per-call log reparsing and the whole-file index rewrite. Approval volume: 58 prompts in four default-mode sessions per your own seed findings. Five in-process children at depth two share one Bun process, one engine, and one set of MCP connections, so one runaway child is the parent's memory. The suite doubles.

At 10x codebase. Inferred: custom grep and glob in a 548-line search.ts with ripgrep optional, and a git checkpoint on every changing step.

With five contributors. No lint, no formatter, no CODEOWNERS. The rules live in prose. "One unit in flight" is a one-person rule. History is linear with zero merges, so "units on branches" is a story the history does not tell. Master is 71 commits ahead of origin. CI marks macOS continue-on-error, so on the platform you develop on, red is invisible.

Trust and safety, weakest first.

1. macOS. The Seatbelt profile allows reading everywhere except the hidden list, an escape is accepted and documented, and CI does not gate macOS. Your daily platform is the least defended and least tested.
2. Auto mode's injection defense is the LLM gate above. Outside auto mode, web content reaches the model unscreened through web_fetch.
3. The shared mutable engine between parent and children.
4. The read-only allow list in src/core/tools/readonly.ts is the one place a parser miss becomes unprompted execution. It is conservative and I found no obvious hole. It has seven test cases and no property or fuzz test. A hand-rolled shell parser is a permanent attack surface.

Blind spots.

- Evals. No task corpus is checked in. The trials tooling lives in your gitignored skills. score.ts runs in CI nowhere. Behavior regression is caught by scripted fake-provider tests, which test the harness, not the model.
- Provider lock-in. The internal canonical is the OpenAI function-call shape. The Responses API is recorded as "will not do" because docs were blocked from the build environment. That is an agent's sandbox limitation written into the product record. Reverse it.
- Migration. One shim from v1 to v2 transcripts. No version field on config, the state index, the plugin lockfile, or checkpoint refs.
- Distribution. The release job with SBOM and provenance has never run per docs/conformance.md. No auto-update. No package manager path by choice.

Three months, in order.

1. Push master. Remove continue-on-error for macOS.
2. Split createRuntime into owned pieces, and give a child its own engine derived from the parent's rather than the parent's object.
3. Delete the legacy config and policy systems, classifier/, HarnessOverrides, and research pipelines. Freeze workflows and plugins.
4. Fix the README table and the architecture claim about children.
5. Check in twenty tasks with deterministic checks, run them nightly on a real open model, and commit the scores. Make this the roadmap input instead of the feature matrix.
6. Run the Seatbelt escape suite on a Mac. Fuzz the command analyzer.
7. Make Ollama on an 8k window a CI job with a real small model, or drop the claim.
8. Build the audit story: a command that answers what this agent changed, under which rule, from which source, across sessions. Ship that as the reason to use it.

I would refuse to build: a learned approval mode, since the data says no; more reflection or research features; Windows; any new tool, since each one costs the 8k path; and more interface polish, since the last 200 commits are interface work.

The question you are not asking. Who is this for besides you, and what will they run it on? Every real decision in the record is one person, one project, 2.6 days, on cloud models. Until a second person runs it on an open model for a week and you have their transcripts, the roadmap is guessing. The second question is what the process costs. The spec and sequence documents are half the size of the code, and the process is optimized for agents to keep landing units, not for a person to hold the system in their head, which was the stated goal.
