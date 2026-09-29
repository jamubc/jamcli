# Change: A checked-in task corpus, scored on a real open model

## Why

R5 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). No task
corpus is checked in, the trials tooling lives in the owner's gitignored skills, and
`src/core/eval/score.ts` runs in CI nowhere. Behavior regressions are caught by scripted
fake-provider tests, which test the harness, not the model. The roadmap has been set by the
feature matrix, which measures breadth against other tools rather than whether JamCLI does
the work.

## What Changes

- `evals/tasks/`: twenty tasks, each a small project, a prompt, and a deterministic check:
  changes checked by a test the task protects from edits, questions checked by the answer,
  and two refusals checked by what must still hold: a file outside the project, and no
  download.
- `evals/run.ts` runs each task through the real program, `jamcli -p`, in a copy of its
  project with its own state and a copied configuration, runs the check, and scores it with
  the session's trajectory metrics from `src/core/eval/score.ts`.
- A test proves every task can fail and can pass: each change task's check fails on its
  project as given and passes with its solution applied.
- Scores are committed under `evals/scores/` from local runs, under the owner's identity. A
  nightly workflow runs the corpus on `opencode-go:deepseek-v4.1-flash` and uploads the
  scores as an artifact: a job's own commit would carry an identity other than the owner's,
  which the repository's rules forbid.
- The scores are the roadmap's input in place of `docs/feature-matrix.md`.

No spec deltas: the corpus measures JamCLI; it is not behavior of JamCLI.

## Impact

- `evals/`, `.github/workflows/evals.yml`, `.gitignore` (the runner's work directory).
