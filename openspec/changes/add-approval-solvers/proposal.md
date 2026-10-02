# Proposal

## Why

Auto mode still stops for the person on every call its mode asks about: a network tool
such as `web_fetch` or `web_search`, or a write outside the project. The owner asked on
2026-09-30 for that decision to be pluggable: each approver ("solver") one file in a
folder, every file there offered as a choice, so auto mode can run on TypeSafe's Jev or on
a solver the person wrote. Jev is used nowhere in JamCLI since the trust gate was removed
in `be5da36`: `trust.model` and the `typesafe` credentials are accepted and read by
nothing, and every launch of the owner's configuration prints a notice saying so.

This reverses a recorded position on purpose. `ROADMAP.md` names "a learned approval mode"
as something the review would not build, because the `classifier/` regression had no skill
(ROC AUC 0.51 on 252 decisions). A solver is not that regression: Jev is a judgment model
asked a typed question per call, a solver can only allow or step aside, and it is measured
before it is recommended, through the task corpus's runner: on prompts whose call is
warranted, for the approval prompts it saves, and on prompts built so the call is not, for
the calls it wrongly allows. A judge model's default failure is leniency, and the first set
alone cannot show it, since a solver that allows everything passes it. The site recommends
Jev only if it made no wrong allow and every prompt of the second set reached it, with the
number of those runs that reached it stated beside that zero (design D9).

## What Changes

- **Solvers.** A solver is one TypeScript file whose default export has a `describe` line
  and a `decide` function. `decide` receives the call, its tool class, why the mode asks,
  the turn's prompt, and the project root, and answers `allow` or `abstain`, with a reason.
  JamCLI finds solvers in three places: its own (`none`, `jev`), the person's
  (`~/.config/jamcli/solvers/`), and the project's (`.jamcli/solvers/`).
- **Where a solver decides.** Only in auto mode, and only a call the mode itself would ask
  about. A deny from any rule, a hook, plan mode, an ask rule, a pre_tool hook's ask, a tool
  that always asks (a commit), and a change to the project's `.git/` or `.jamcli/` are never
  put to a solver. `abstain`, an error, a malformed answer, or no answer within its time
  limit shows the person the prompt they would have seen, with what the solver said.
- **Selecting one.** `trust.solver` names the solver, read from the person's own
  configuration and the project-local file only. A value in the project's shared
  `.jamcli/config.json` is ignored with a notice, since a repository must not choose what
  approves calls in it. Absent or `none`, nothing changes from today.
- **Project solvers are code from the repository.** They load only after the person trusts
  them, as project hooks do, and trust lapses when any of their files change.
- **`/solver`.** Lists every solver found, where it came from, whether it is trusted, and
  which is selected; `/solver <name>` selects one; `/solver trust` trusts the project's.
  It is a command, so the interface, headless, and ACP all run it.
- **The Jev solver.** Asks Jev whether the call serves the turn's prompt without reaching
  beyond it, and allows at or above `trust.threshold` (0.9 when unset) on the Jev model
  `trust.model` names (`jev-latest` when unset). It reads the `typesafe` credentials again.
  Its requests are priced from the catalog and counted in `/cost`.
- **Every solver decision is recorded.** An allow is logged as an approval decided `by:
  solver`, naming the solver and its file and carrying its reason, so `jamcli audit ledger`
  lists it. An abstain is logged with the person's answer, the solver's reason attached.
- **The `trust.model` notice** now says what is true: that `trust.model` configures the
  Jev solver, and that no solver runs until `trust.solver` selects one.

## Not in this unit

- **Screening tool output**, what the removed gate did. The solver contract leaves room for
  it; nothing in this unit reads a result.
- **Solvers outside auto mode.** A solver in default or accept-edits mode would change what
  those modes promise.
- **A JamCLI SDK**, a typed client over ACP. It is the unit the owner queued after this one.

## Capabilities

### New Capabilities

None. JamCLI keeps one capability.

### Modified Capabilities

- `jamcli`: adds the Approval Solvers requirement.

## Impact

- Spec: Approval Solvers is added.
- Code: a new `src/core/solvers/` (contract, discovery, trust, `none`, `jev`), the dispatch
  step that turns an ask into a prompt, the runtime assembly and its notices, the `trust`
  block's schema descriptions and one new field, `solver`, and `/solver` in
  `src/commands/builtin/`.
- Docs: `docs/permissions.md` (solvers, writing one), `docs/configuration.md`, the site's
  auto mode page, and `ROADMAP.md`, whose "would not build" line is amended.
- Evals: `evals/solvers/`, the five positive and five negative tasks that measure Jev,
  and `evals/run.ts` taking that folder, serving a task's fixture pages on loopback, and
  passing a task's allow rules to the run.
- No dependency. One configuration field, `trust.solver`, inside a block that exists.
