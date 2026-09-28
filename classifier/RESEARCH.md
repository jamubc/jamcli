# Research: can approval logs train a second auto mode?

Measured on this machine's session logs on 2026-09-28, by `bun classifier/cli.ts audit`
and `eval`. Every number below is reproducible from the commands in `README.md`.

## Verdict

The theory is sound and the data is not there yet. Approval logs can train a useful
classifier, but on 252 human decisions from one person over 2.6 days, with 14 denials in
scope, the model has no measurable skill (out-of-fold ROC AUC 0.51, 0.5 is chance) and no
threshold can be certified. Two free baselines already beat it. The work that pays now is
recording better labels, so the same pipeline can train something once the data exists.

## 1. The premise, checked against the code

"Auto mode classifier" is two things in this repository, and only one is a classifier.

- **Auto mode's approval is rule-based.** In `auto`, `run_command` is allowed when the
  command runs inside a sandbox (`src/core/permissions/modes.ts`). No model decides it.
- **The Jev classifier screens tool results.** `src/core/trust/` asks whether a result is
  relevant to the task and whether it carries an injection. It never sees a command's
  approval.

So a learned approval mode is a new decision point, not a replacement, and it can sit beside
Jev with no shared code. That is what this folder does.

## 2. Framing

The engine already sorts calls into allow, ask, and deny. What costs the person time is the
asks. The learned mode acts only on those:

- **Actions:** `allow` (save the prompt) or `abstain` (ask). Never deny in v1.
- **Target:** would this person allow this call?
- **Success metric:** prompts saved, at a false-allow rate the data bounds under a budget.
  Accuracy is the wrong metric. With 7% denials, "allow everything" is 93% accurate.
- **Cost asymmetry:** a false allow runs something the person would have refused. A false
  abstain costs one prompt. The threshold is set on the first, so the second absorbs error.

## 3. The data, audited

| Fact | Value |
|---|---|
| Session files, approval events | 136, 493 |
| Answered by a person | 252 (53%); the rest by mode 185, policy 26, flag 12 |
| Labels | allow 203, allow with a grant 27, deny 13, deny with steering 6, deny by stopping the turn 3 |
| In the model's domain (a person answered, beyond the floor) | 210: 196 allowed, 14 denied |
| Beyond the safety floor | 42 more decisions, kept out of training |
| Denial rate | 6.7% counting every denial, 4.9% counting only those about the call |
| Projects | one holds 81% of decisions |
| Span | 2.6 days |
| Repeated exactly | 7% of decisions |

### What the logs do not say

- **Who answered.** The log records `by: "user"` for any answer nobody labelled otherwise.
  An agent answering through `jamcli mcp serve` (`src/mcp/session.ts` calls
  `decide({ allow: true })`) and a scripted trial look the same as a person. Each label is
  an upper bound on how many were a person, and much of this data was produced while testing.
- **Why it asked.** The rule or mode that made the engine ask is not recorded, only the
  answer. Eligibility is reconstructed from the command.
- **What a denial meant.** Of 22 denials, 13 are bare, 3 are Escape stopping the turn, and 6
  are text typed to steer the model ("commands-only trial, wrapping up review here for time").
  Only the bare ones are about the call. Labels are typed so they can be weighted or dropped.
- **Anything about calls that were never asked.** A call the engine allowed or denied by rule
  has no human label. Every measurement here is conditional on the ask set, and that set
  changes with policy: a later change allows read-only commands without asking, which
  removes a whole class of examples from future data.

## 4. Label taxonomy

| Kind | From | Weight in training |
|---|---|---|
| `allow` | answer allow, scope once | 1 |
| `allow_grant` | allow with session or project scope | 1 |
| `deny_call` | deny with no message | 1 |
| `deny_steer` | deny with a typed message | 0.5 |
| `deny_stop` | deny from Escape ("the person stopped the turn") | 0.25 |
| `system` | mode, policy, hook, flag, or a surface that could not ask | 0, excluded |

`eval --strict` drops `deny_steer` and `deny_stop` entirely. The default counts them as
false allows, which is the conservative reading.

## 5. Mistakes the pipeline made and what fixed them

These are worth keeping because each is the kind that produces a confident wrong result.

1. **Pooled cross-validation inverted the ranking.** A first run reported ROC AUC 0.18, far
   below chance. The fold builder put every denial-free session into one fold (147 examples
   against 5 in another), so each fold's model had a different prior, and pooling their
   scores ranked backwards. Folds are now level in size and spread the denials, and the
   report gives the average of per-fold AUCs beside the pooled figure. A test pins it.
2. **Ignorance read as permission.** With 93% allows, a call with a program the model has
   never seen scores near 0.93, above any threshold. The model now records which programs,
   hosts, agents, and file types it has evidence about, and abstains on anything else, both
   in scoring and in the gate. A test pins it.
3. **Path normalization was half done.** `src/a.ts` and `lib/x.ts` normalized differently, so
   "the same call allowed before" missed repeats. Any token with a slash is now a path.
4. **A "no signal" fixture leaked its label through the command text.** It reported an AUC of
   1.0 for random labels. Fixtures for negative tests now keep the command independent of
   the answer.

## 6. Model choice

A logistic regression over named binary features. The reasons are the data, not fashion:

- Hundreds to low thousands of rows, one rare class. Anything with more capacity memorizes it.
- The artifact is a JSON object a person can read, which matches the repository's rule that
  learning happens only as reviewable files.
- It runs in the TypeScript runtime with no dependency, no network, and no native code.
- Regularization is chosen by held-out sessions, and the weights are the same on every run.

Features are the tool, the program and subcommand, flags, structure (pipes, redirects,
length), normalized tokens, host or file type, the mode and surface, and the person's own
history (the same normalized call allowed or denied before). The request text and typed
feedback are never features: they are high-dimensional, and feedback exists only after the
answer.

Revisit at about 5,000 labelled decisions from several people: gradient-boosted trees for
interactions, a text embedding of the request, or a small tuned model. Not before.

## 7. Results

Out of fold by whole session, lenient labels, 210 examples from 49 sessions.

| Policy | Prompts saved | False allows | Rate | 95% upper bound |
|---|---|---|---|---|
| Allow everything | 100% | 14 | 6.7% | 10.1% |
| Read-only commands (the engine's own rule) | 9% | 1 | 5.6% | 21.5% |
| The same call was allowed before | 44% | 3 | 3.3% | 7.9% |
| The model | no threshold certifies | | | |

The model's ROC AUC is 0.51 averaged over folds, its log loss 0.220 against 0.217 for the
prior alone, and the tuner picks the strongest regularization, so the weights collapse
toward zero. The top 25 ranked calls (12%) contain no denial, but a bound of 9.8% on that
says nothing.

Three things follow.

- **The data cannot certify this model.** A 2% false-allow bound at 95% confidence needs about
  149 auto-allowed decisions with none wrong, and 299 for 1%. This data could certify only a
  model that ranked 149 of its 196 allows above all 14 denials. This one does not rank at all.
- **A lookup beats the model.** "This call was allowed before" already saves 44% of prompts,
  which is what a session grant does. The nearest win is suggesting a grant sooner, not a
  model.
- **The gate is not vacuous.** Tests show it passes on a real signal with 700 decisions,
  fails on the same signal with 80, and fails on random labels at any size.

The readiness estimate in `audit` (about 17 days) extrapolates a burst of testing and is not
a forecast. Real use will be slower and more varied.

## 8. Promotion

A model climbs one rung at a time and is demoted on any failure.

| Stage | Authority | Exit |
|---|---|---|
| 0 Collect | none | Enough labelled decisions: about 100 denials about the call, from at least 3 projects |
| 1 Shadow | none, but scored beside every ask | Predictions logged with each ask; a false-allow rate measured on live traffic, not on history |
| 2 Assist | allow above a certified threshold, inside the floor | Gate passes on shadow data; a person opts in; any false allow in review drops it to shadow |
| 3 Re-certify | same | After a policy change, a new model, or every 500 decisions |

Denying stays out of scope until stage 3 has run for a season.

## 9. What to record so later data can train

In order of value. Each is a small change to `src/`, and none is made here.

1. **Who answered.** An `answeredBy` of `person`, `agent`, or `script` on the approval event.
   The MCP path and the trial driver are agents. Without it, contamination cannot be found
   after the fact.
2. **Why it asked.** The engine's verdict at ask time: who decided and the rule or reason.
   It makes eligibility exact and lets the model be trained on the calls it would see.
3. **Regret.** A `/undo` or `/rewind` shortly after an allow is a strong negative label for
   that allow, and the only signal about a call the person did allow and wished they had not.
4. **Latency.** Milliseconds from prompt shown to answer. A reflex answer and a long
   deliberation are different labels, and it is free.
5. **Shadow adjudication.** When a model exists, log its score and verdict beside every ask.
   It gives a true out-of-sample false-allow rate before the model has any authority.
6. **Policy version.** A hash of the rules and the engine's version, so a change of ask set
   is visible and old examples can be reweighted.
7. **Grant offered and chosen.** The patterns suggested and the one picked. A person
   narrowing or widening a grant is a rich label.

## 10. Governance

`AGENTS.md` allows learning only as reviewable files, on demand, behind gates, and rules out
background learning, hidden memory, and a user profile. A model of a person's approvals is
close to that last phrase, and this document does not claim otherwise. The design keeps to
the letter and states the tension so the owner can decide it.

- Offline and on demand: a person runs `train`, reads the result, and keeps or deletes the file.
- Reviewable: every weight is a named feature in a JSON file.
- Local: data and models are gitignored, redacted, and per person; a model is never shared.
- Bounded: it saves a prompt and cannot deny; the floor and the gate cap what it may do.
- Off by default and removable: nothing in `src/` calls it, and deleting `models/` turns it off.

Wiring it into the engine is a separate decision. It changes what a running session may do
without asking, so it should be its own reviewed change, after stage 1 has data.

## 11. Reproduce

```bash
bun classifier/cli.ts audit
bun classifier/cli.ts eval            # lenient
bun classifier/cli.ts eval --strict   # only denials about the call
npx tsc -p classifier --noEmit && bun test classifier
```
