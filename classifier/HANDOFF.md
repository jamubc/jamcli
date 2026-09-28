# Handoff: the learned approval mode

Written 2026-09-28 at commit `d5249ea`, for whoever picks this up next, including the owner
after a gap. It tells you what was asked, what exists, what the baselines are, what not to
repeat, and what to do first. Read it top to bottom once, then use it as a checklist.

Read order: this file, `README.md` (the contract), `RESEARCH.md` (the evidence),
`baselines/2026-09-28.txt` (the numbers to beat).

## 1. The request

The owner's words:

> Research how we can actually use the logs and runs over time from a user using JamCLI, and
> structure and form this data into a way such that we can actually train a custom "auto
> mode" classifier. My theory is if we can observe enough data of users accepting or denying
> commands we could actually start doing some classifier training. Approach this like a
> machine learning engineer. Ensure that we create a separate folder in the repository for
> our custom classifier and that we do not replace the Jev auto mode classifier and instead
> this effort is towards having a "second" mode that we can slowly improve over time with
> more data.

Read as acceptance criteria, that is:

1. Research first: how the logs can become training data, before any model.
2. Engineer it like ML work: label definition, leakage, splits, baselines, calibration,
   evidence for or against the theory.
3. Everything lives in its own folder, `classifier/`.
4. Jev is untouched. This is a second mode that improves as data grows, not a replacement.

All four hold today. The theory is neither confirmed nor refuted: the pipeline works and the
data is too thin to train on (see section 4).

## 2. What exists

Nothing under `src/` calls this folder, and `src/core/trust/` is not imported by it.

| Piece | File | Job |
|---|---|---|
| Extraction | `src/extract.ts` | Session logs to labelled, redacted, joined examples with per-project history; `--until` freezes a dataset at a date; `fingerprint` proves two runs saw the same decisions |
| Labels | `src/types.ts`, `labelOf` | Six kinds and a training weight for each; see `RESEARCH.md` section 4 |
| Floor | `src/floor.ts` | What no model may ever allow; deterministic, stricter than the engine |
| Features | `src/features.ts` | Named binary features of a call and the person's own history; request text and typed feedback are never features |
| Model | `src/model.ts` | Logistic regression, familiarity check, regularization chosen by held-out sessions |
| Splits | `src/split.ts` | Folds and time splits by whole session, level in size |
| Metrics | `src/metrics.ts` | AUC, average precision, calibration, exact bounds, the promotion gate |
| Evaluation | `src/evaluate.ts` | Baselines, out-of-fold scoring, temporal check, `trainCertified` |
| Audit | `src/audit.ts` | What the logs can and cannot support, before training |
| Contract | `src/decide.ts` | `adjudicate(model, query)` returns `allow` or `abstain` |
| CLI | `cli.ts` | `audit`, `build`, `eval`, `train`, `predict` |

Verify a checkout in one minute:

```bash
npx tsc -p classifier --noEmit && bun test classifier          # 25 tests
bun classifier/cli.ts audit --until 2026-09-28T21:00:00Z       # fingerprint 496bdbd885c63808
```

If the fingerprint differs, the logs or the extractor changed. Find out why before comparing
anything to the baseline.

## 3. The baselines

Frozen in `baselines/2026-09-28.txt`, with the exact commands, the commit, and the blobs of
the two core files the features depend on. Data: 136 sessions, 252 human decisions, 210 in
the model's domain (196 allowed, 14 denied), 49 sessions, three days, one person.

| Policy | Prompts saved | False allows | Rate | 95% upper bound |
|---|---|---|---|---|
| Allow everything | 100% | 14 of 210 | 6.7% | 10.1% |
| Read-only commands (the engine's `readonly.ts` rule) | 9% | 1 of 18 | 5.6% | 21.5% |
| The same call was allowed before | 44% | 3 of 92 | 3.3% | 7.9% |
| Model (logistic regression) | none certifiable | | | |

The model, out of fold by session: ROC AUC 0.509 averaged over folds (chance is 0.5), log
loss 0.220 against 0.217 for the prior alone, calibration error 0.010 (because it predicts
the base rate). Strict labels, which drop denials that are not about the call: AUC 0.425.
Both are chance at this sample size. The gate does not pass.

**What "better than the baseline" means.** All three must hold, on data from at least three
projects:

1. Out-of-fold macro AUC above 0.65 with a bootstrap interval that excludes 0.5.
2. A certified threshold that saves more prompts than "the same call was allowed before"
   does at the same or a lower false-allow upper bound.
3. The temporal check has at least 5 denials in it and agrees in direction.

Beat the lookup, not just the prior. If the model cannot, ship the lookup: it is a grant
suggestion, needs no model, and is a better product than nothing.

**Tests that must keep passing** because each pins a mistake already made: the fold balance
test (`split.test.ts`), the unfamiliar-program test (`evaluate.test.ts`), the path
normalization test (`model.test.ts`), the negative-signal fixture that keeps the command
independent of the label (`evaluate.test.ts`).

## 4. What was learned

- **Jev is not a command classifier.** It screens tool results. Auto mode approves commands
  by sandbox rules. A learned approval mode is a new decision point.
- **The label is the hard part.** Of 22 denials, 13 are bare, 3 are Escape stopping the turn,
  6 are text typed to steer the model. Only the bare ones are about the call.
- **Provenance is unknown.** `by: "user"` covers a person, an agent answering through
  `jamcli mcp serve`, and a scripted trial. Much of this data was produced while testing.
- **Labels exist only for asked calls.** The ask set changes with policy, so measurements are
  conditional on it and shift when the engine changes what it asks.
- **Ignorance looks like permission.** With 93% allows, an unseen program scores high.
  Familiarity is required before a model may allow anything.
- **Pooled cross-validation lies on rare classes.** Uneven folds gave an AUC of 0.18. Report
  the per-fold average, keep folds level, never trust a pooled AUC alone.
- **A lookup already saves 44%.** That is the bar.

## 5. Decisions already made

Reopen one only with new evidence.

| Decision | Why |
|---|---|
| Allow or abstain, never deny | Denial data is the weakest and a wrong denial has no recourse |
| Logistic regression on named features | Hundreds of rows, one rare class, a readable artifact, no dependency, runs in the TypeScript runtime |
| Splits by whole session | Sessions repeat themselves; a random split would overstate skill |
| Lenient labels gate authority | Counting every denial as a false allow is the conservative reading |
| Certify, do not observe | Zero false allows in 12 calls proves nothing; the gate uses an upper bound |
| Offline, on demand, local | `AGENTS.md`: no background learning, no hidden memory |
| Not wired into `src/` | It changes what a session may do without asking; it needs data and its own review |

## 6. Open decisions for the owner

1. **The "user profile" tension.** `AGENTS.md` rules out a user profile. A model of one
   person's approvals is close to one. The design keeps to the letter (offline, reviewable,
   local, capped) and `RESEARCH.md` section 10 states the case. The owner decides whether
   that is enough before anything is wired.
2. **Whose model.** Per person, per project, or shared. Today: per person, never shared. A
   shared model would need consent and a much larger dataset.
3. **Opt in how.** The repository rejects new config keys. A learned mode probably needs a
   permission mode, which is a tool mode and not a key, but that is the owner's call.

## 7. What to do next, in order

Each item is small enough for one change, and each names where it goes.

### A. Record better labels (do this first; no model can outrun its data)

All in `src/`, all additive to the approval event in `src/core/transcript/events.ts` and
`src/core/transcript/recorder.ts`, then teach `classifier/src/extract.ts` to read them.

1. **`answeredBy`: person, agent, or script.** The MCP path sets none:
   `src/mcp/session.ts` calls `decide({ allow: true })`, and `readDecision` in
   `src/core/types.ts` defaults `by` to `user`. Add an `agent` origin there and in
   `src/cli/run.ts` for trials. Extraction should then drop anything not a person.
2. **Why it asked.** In `src/core/tools/dispatch.ts`, `settleDecision` already holds
   `verdict.by`, `verdict.rule`, and `verdict.reason` when it asks. Put them on the event.
3. **Latency.** Milliseconds from `approval_request` to the answer.
4. **Regret.** A `/undo` or `/rewind` soon after an allow (`restoreCheckpoint` in
   `src/core/runtime/index.ts`) is a negative label for that allow. Join on the checkpoint's
   turn. It is the only signal about a call the person allowed and wished they had not.
5. **Policy version.** A hash of the rules plus the JamCLI version, so a change in the ask
   set is visible. Note that `src/core/tools/readonly.ts` already changed what gets asked
   once during this work.
6. **Grant offered and chosen.** The patterns `suggestPatterns` in `src/core/approval.ts`
   offered and the one picked.

Acceptance: the audit's provenance warning becomes a count, not a caveat, and a fresh run of
`audit` reports how many decisions are from a person.

### B. Ship the lookup as a product change, with no model

"The same call was allowed before" saves 44% at a 7.9% upper bound. That is close to what a
session grant does, so the win is offering the grant sooner: after the second identical
approval, suggest the pattern. The code is `suggestPatterns` in `src/core/approval.ts` and
`callKey` in `classifier/src/features.ts`. This needs no gate because the person still
answers.

### C. Collect

`bun classifier/cli.ts audit` prints readiness. It extrapolates a burst of testing and is
not a forecast. The targets in `RESEARCH.md` section 8 stand: about 100 denials about the
call, from at least three projects, over several weeks. Rebuild the baseline snapshot
whenever the data doubles, under a new date in `baselines/`, never over the old one.

### D. Shadow mode (stage 1)

When a model exists, score every ask it would see and log the score beside the answer, with
no authority. This gives a false-allow rate on live traffic before any model may save a
prompt. Model it on `registerSteerMiddleware` in `src/core/runtime/steer.ts`: an internal
`pre_tool` handler that only records an `adjudication` event.

Layering: `src/` must not import `classifier/`. When this is wired, move the runtime pieces
(`floor.ts`, `decide.ts`, and the scoring and familiarity parts of `model.ts`) to
`src/core/adjudicate/`, and leave extraction, training, and evaluation here. The artifact
format is the seam, so keep `Model` stable and bump `version` on any change.

### E. Modelling, when the data allows

Not before roughly 5,000 labelled decisions from several people.

- Per-project and leave-one-project-out evaluation, once three projects each have enough.
- Bootstrap intervals on AUC and on prompts saved; the report has none today.
- Calibration (Platt or isotonic) if the threshold needs probabilities that mean something.
- Request text as a feature, embedded, and only after it beats the structural features.
- Gradient-boosted trees for interactions between program, flags, and history.
- A cost-sensitive threshold per tool class, and a drift check that demotes a model that
  starts to miss.

### F. Promotion

The ladder in `RESEARCH.md` section 8: collect, shadow, assist, re-certify. A model climbs
one rung at a time. Any false allow in review drops it to shadow. Denial stays out of scope
until assist has run for a season.

## 8. Resuming: a first hour

```bash
git log --oneline -5                       # what moved since d5249ea
git status --short                         # the working tree is shared; see section 9
npx tsc -p classifier --noEmit && bun test classifier
bun classifier/cli.ts audit --until 2026-09-28T21:00:00Z   # must print fingerprint 496bdbd885c63808
bun classifier/cli.ts audit                                 # today's data, for comparison
bun classifier/cli.ts eval --strict
```

Then compare today's `audit` with the snapshot: more denials, more projects, more days? If
`answeredBy` exists (section 7A), extract on it and re-run. If not, do 7A first.

## 9. Gotchas

- **The working tree is shared.** Another agent edits `src/` at the same time. Do not stash,
  reset, or commit hunks you did not write. A full `bun test` run once showed 23 failures
  that were the other agent mid-edit; they passed on a clean worktree of HEAD and on rerun.
  Test a clean `git worktree` before blaming yourself, and never stash to do it.
- **`readonly.ts` is not this folder's.** The `readonly` feature and the "read-only commands"
  baseline call `src/core/tools/readonly.ts`. When it changes, the baseline changes meaning.
  The snapshot records its blob hash for this reason.
- **Data and models are personal.** `data/` and `models/` are gitignored and hold real
  commands. Redaction removes credentials, not identity. Never commit, paste, or attach one.
- **Old models.** A model file written before `known` existed loads and abstains on
  everything, since it lists nothing as known. Retrain rather than editing one.
- **Repository rules.** No em dashes in anything authored here. No AI attribution in
  commits. Conventional commits, lowercase and imperative. One concern per commit. No new
  config keys. Gates: `npx tsc --noEmit`, `bun test`, `bun run build`, plus
  `npx tsc -p classifier --noEmit` for this folder.

## 10. Terms

- **Domain:** calls a person answered that are not beyond the floor. What a model may learn from.
- **Floor:** what no model may allow; `floor.ts`.
- **Familiar:** every program, host, agent, and file type in a call was decided on at least
  twice before.
- **Authority:** `none` (shadow only) or `assist` (may allow above a certified threshold).
- **Gate:** the test that certifies a threshold: the upper bound on its false-allow rate is
  under the budget, not merely its observed rate.
- **False allow:** a call the model would have allowed that the person did not.
- **Prompts saved:** the share of asked calls a policy would have allowed without asking.
