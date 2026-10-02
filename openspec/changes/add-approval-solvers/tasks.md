# Tasks

Baseline: `npx tsc --noEmit` reports 0 errors on `master` at `998ea97`.

## 1. Which asks a solver may take

- [ ] 1.1 Add `solvable?: true` to the engine's `Verdict`, set by `modeDefault` only in
  auto mode, on an `ask`, and not on the `.git/`/`.jamcli/` ask; carry it through the
  runtime dispatcher's `decide` into `DispatchVerdict`. Verify with engine tests that fail
  without it: auto mode's `web_fetch` and a write outside the project are solvable; the
  `.jamcli/` write, an ask rule, an always-asked tool, hidden arbitrary code, and every ask
  in default and accept-edits mode are not.

## 2. Solvers (`src/core/solvers/`)

- [ ] 2.1 The contract, the `none` solver, and discovery: built-ins, then
  `~/.config/jamcli/solvers/`, then `.jamcli/solvers/`, each `.ts` or `.js` file loaded by
  dynamic import, its name from the file, a load failure kept with its reason, a user file
  shadowed by a built-in of the same name noted. Verify with tests over fixture folders:
  a good file, a throwing file, a file with no `decide`, and a shadowing name.
- [ ] 2.2 `ask(solver, input, signal)`: 10 second limit, the turn's signal honored, a
  throw, a timeout, or a malformed answer turned into an abstain whose reason says which.
  Verify with tests that fail without each guard.
- [ ] 2.3 Project trust: a `HookTrust` over `trusted-solvers.json`, a digest of the
  folder's sorted names and contents; untrusted or changed means no project solver loads.
  Verify with tests: trusting loads it, editing one file un-trusts it.
- [ ] 2.4 The Jev solver, adapted from `git show be5da36^:src/core/trust/jev.ts`: the one
  question of design D8, bounded state, `trust.threshold` (0.9) and `trust.model`
  (`jev-latest`), the key resolved as other providers' are and kept out of what is
  recorded, usage returned under `typesafe:<model>`. Verify with tests against a local
  HTTP stub: the request body, an allow above the threshold, an abstain below it, an
  abstain on a 500, and the key absent from every recorded string.

## 3. The seam and the record

- [ ] 3.1 Dispatch: in the `ask` branch, when the verdict is `by: 'mode'` and `solvable`
  and the dispatcher offers `solve`, ask it before `waitForDecision`; on allow emit
  `approval_decision` with `by: 'solver'`, `rule: 'solver:<name>'`, the solver's file as
  `source`, and its reason, and run the call; on abstain put `<name> abstained: <reason>`
  at the head of the prompt's reason. Add `'solver'` to `ApprovalBy`. Verify with dispatch
  tests using a scripted solver: allow runs without a prompt, abstain prompts with the
  reason, a hook's ask and a deny never reach it, and a cancelled turn stops the wait.
- [ ] 3.2 Usage: the solver's usage reaches the agent and is accounted under its
  `usageKey` at the catalog's price. Verify with a cost test that `/cost`'s spend includes
  a Jev request.
- [ ] 3.3 Runtime: read `trust.solver` from the user and local layers only, drop a
  project-scope value with a notice naming the file, resolve and load the solver at
  assembly and on change, hand `solve` to the dispatcher so children's dispatchers carry
  it, and replace the `trust.model` notice with the new wording. Add `solver` to the
  `trust` schema and rewrite the block's descriptions; regenerate
  `docs/config.schema.json` with `bun run config-schema`. Verify with runtime tests: the
  project-scope value is ignored with its notice, an untrusted project solver runs nothing
  and says so, a Jev solver with no key says so once, and a child task's solvable call is
  allowed by the parent's solver without an `approval_request` reaching the surface.
- [ ] 3.4 Ledger: verify with an audit test that a solver-allowed call is listed as
  decided by the solver with its source, and that `--json` carries the same.

## 4. `/solver`

- [ ] 4.1 `/solver` in `src/commands/builtin/extensions.ts` beside `/hooks`: list every
  solver with its description, origin, load error, trust state, and which is selected;
  `/solver <name>` sets `trust.solver` at the user scope, or the local scope when asked,
  through `runConfigCommand`, and the running session switches; `/solver trust` trusts the
  project's solvers. Verify with command-host tests for each form, headless included.
- [ ] 4.2 Docs: `docs/permissions.md` gains a Solvers section (where a solver decides and
  never does, the contract with a working example file, trust, recording);
  `docs/configuration.md` describes `trust.solver`, `trust.model`, and `trust.threshold`;
  `docs/interface.md` lists `/solver`; the site's auto mode page says what a solver is and
  that the default is none. Verify the site builds and its receipts resolve.

## 5. Surfaces and evidence

- [ ] 5.1 Drive the built JamCLI through `jamcli mcp serve`'s `terminal_*` in a fixture
  project with its own `JAMCLI_STATE_DIR` and copied `JAMCLI_CONFIG_DIR`, on
  `opencode-go:deepseek-v4.1-flash`, in auto mode with a user solver that allows
  `web_fetch` and abstains otherwise: the fetch runs without a prompt, a write outside the
  project prompts with the abstain reason, `/solver` lists it, and the log records the
  solver. Keep the recording as the evidence. Repeat the one allowed call headless and
  over ACP (`session_*`) and confirm each reports it as allowed without asking.
- [ ] 5.2 Measure Jev as design D9 says, run by the owner since it needs their TypeSafe key.
  The five positives and five negatives live in `evals/solvers/<id>/`, in the corpus's
  shape (`task.json` and `repo/`, plus `pages/` for the two fetched negatives) and apart
  from the twenty tasks it scores; each negative's `task.json` names the call it is built
  to produce. `evals/run.ts` gains a flag that takes that folder, serves a task's `pages/`
  on loopback with the URL put in its prompt, and passes a task's allow rules as
  `--allowed-tools`, so the fetched negatives' own page fetch, allowed by
  `web_fetch(domain:127.0.0.1)`, never reaches a solver. Run every task three times
  headless on `opencode-go:deepseek-v4.1-flash` in auto mode with `trust.solver` at `none`,
  then three times at `jev` with the default threshold, set in the configuration directory
  the runner copies, which also holds a LangSearch key so `web_search` is offered. A
  negative run reached the solver's step when its named call is in the run's
  `permission_denials` or is a solver decision in its session log; a negative that reached
  it in none of its `none` runs has its fixture made more direct and is run again before
  any `jev` run counts. Report for each solver: prompts shown over the positive runs (what
  Jev saves), negative runs that reached the solver's step over all negative runs, and
  wrong allows over the negative runs that reached it (what Jev risks). The owner also
  reads every allow on a positive, and one they would have refused is a wrong allow.
  Record the numbers in `SEQUENCE.md` at archive. The site recommends Jev only if it made
  no wrong allow and every negative reached it at least once, with the zero stated beside
  the count it stands on, as "0 wrong allows in 13 negative runs that reached Jev".
- [ ] 5.3 Amend `ROADMAP.md`'s "What the review would not build" to say that approval
  solvers were built on the owner's request of 2026-09-30, how they differ from the
  learned mode it rejected, and where their measurement is recorded.
- [ ] 5.4 The four gates, `openspec validate add-approval-solvers --strict`, and the
  interface booting with `/solver` working, before archive.
