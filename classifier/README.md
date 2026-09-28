# Learned approval mode

JamCLI asks the person before it runs a command, edits a file, or reaches the network. Every
answer is already in the session log. This folder turns those answers into a second,
optional approval mode that saves the prompts a person would have allowed anyway, and that
improves as more decisions are logged.

It is not the trust gate. `src/core/trust/` (TypeScript's Jev, or a chat model) screens tool
results for relevance and prompt injection. It never decides whether a command may run.
This is a different decision, at a different point, and the two do not share code.

## What it decides

The permission engine returns `allow`, `ask`, or `deny` for every call. This classifier sees
only the calls the engine would `ask` about, and answers one of two things:

| Answer | Meaning |
|---|---|
| `allow` | Save the prompt. The model is certified for this call. |
| `abstain` | Ask the person, as JamCLI does today. |

It never denies. A denial from a model with a handful of examples would be an opinion nobody
can check, and the person is always one prompt away.

## Safety contract

1. **The floor comes first.** `src/floor.ts` names what no model may ever allow: hidden code,
   redirects outside the project, `rm`, `git push`, `--force`, network egress, publishing,
   remote infrastructure, privilege escalation. It is deterministic and stricter than the
   engine. A person can still allow any of it.
2. **Unfamiliar means abstain.** A call with a program, host, agent, or file type the person
   has not decided on before scores near the base rate, which is high. The model checks that
   it has evidence about the call before it may allow it.
3. **Authority is certified, not assumed.** A model file says `authority: "none"` until
   `train` shows a threshold whose false-allow rate the data bounds under the budget (2% at
   95% confidence by default). The runtime may not grant more than the file says.
4. **Every weight is readable.** The model is a JSON object of named features. A person can
   open it, see why a command scores as it does, and delete it.

## Layout

```
classifier/
  cli.ts             audit, build, eval, train, predict
  src/extract.ts     session logs to labelled examples (redacted, joined, with history)
  src/floor.ts       what no model may allow
  src/features.ts    named binary features of a call and the person's own history
  src/model.ts       logistic regression, familiarity, regularization by held-out sessions
  src/split.ts       folds and time splits by whole session
  src/metrics.ts     AUC, calibration, exact bounds, the promotion gate
  src/evaluate.ts    baselines, out-of-fold scoring, temporal check
  src/audit.ts       what the logs can and cannot support
  src/decide.ts      the contract with a runtime: allow or abstain
  data/  models/     personal, gitignored
```

## Use

```bash
bun classifier/cli.ts audit                     # what the logs hold, and what they cannot support
bun classifier/cli.ts build                     # write classifier/data/examples.jsonl
bun classifier/cli.ts eval --strict             # baselines against the model, by held-out session
bun classifier/cli.ts train --name 2026-10      # fit, gate, and write classifier/models/<name>.json
bun classifier/cli.ts predict --model classifier/models/2026-10.json --command "git status"
```

Sessions are found through the session index, so every project the person has used is
read. Name folders with `--dirs a,b`, or limit surfaces with `--surfaces tui,acp,child`.

## Picking this up

Start with `HANDOFF.md`: what was asked, the frozen baselines in `baselines/`, what to do
first, and what not to repeat.

## Status

A pipeline and a first measurement, not a mode. On the first 252 human decisions the model
has no skill beyond the base rate and no gate passes, which is the correct outcome for that
data. `RESEARCH.md` gives the numbers, the reasons, and what to record so that later data can
train something. Nothing in `src/` calls this folder.
