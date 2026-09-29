# Change: Delete the systems that duplicate or sit beside the product

## Why

R3 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). Beside
what JamCLI needs sit a second configuration system and a third configuration shape, a
second policy system that `jamcli audit` still reports from, a research classifier nothing
calls, a prompt-search loop threaded through production paths, research pipelines, a trust
gate that was never measured as the defense it stood in for, and a steering handler that
refuses a legitimate re-read.

## What Changes

- **Legacy configuration.** `src/services/ConfigService.ts` and `src/services/config/` go.
  The MCP manager takes the servers the session's configuration already read; the ACP
  session and `jamcli audit` read configuration through `loadConfig`. The hand-written
  `Config` type is derived from the Zod schema that validates it, so there is one shape.
  The manager's `upsertServer` and `removeServer`, which nothing called, go with it.
- **Legacy policy.** `src/core/policy/` goes. `jamcli audit` reports each tool's verdict
  from the permission engine, in the configured mode, with the rule and file that decided
  it. R8 builds the decision ledger on that.
- **`classifier/`.** The approval-classifier research (AUC 0.51 on 252 decisions, imported
  by nothing in `src/`) leaves the repository; its ignored data stays where it is, still
  ignored, and the last commit that holds its code is named in `SEQUENCE.md`.
- **Harness search.** `HarnessOverrides`, the `harness` runtime option, and
  `scripts/harness-search` go. Trials stay outside the product.
- **Research pipelines.** `src/core/research/` and `/research` go.
- **The trust gate.** It goes: the classifier call, its TypeSafe client, its accounting,
  and its screening in the agent loop. `trust.*` stays accepted and read by nothing, and a
  configuration that names `trust.model` is told once.
- **M3.** The repeated-read refusal goes. It was keyed on the tree the last changing step
  left, so an edit in the person's editor between two reads did not move it.
- **Frozen.** Workflows and plugins stay as they are; no new work on either.

## Impact

- Spec: `Tool Output Trust Gate` is removed; `Session Runtime Assembly` no longer lists
  the gate; `Delegation Audit` gains a scenario for verdicts from the engine.
- Code: `src/services/`, `src/core/policy/`, `src/core/research/`, `src/core/trust/`,
  `src/core/runtime/`, `src/core/agent.ts`, `src/cli/audit.ts`, `src/acp/session.ts`,
  `classifier/`, `scripts/harness-search/`, and the docs that describe them.
