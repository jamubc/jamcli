# Tasks

## 1. The corpus

- [ ] 1.1 Twenty tasks under `evals/tasks/`, each with `task.json`, a `repo/` project, and for
  a change task a `solution.json`; fixture tests are named `*.check.ts` so the root suite
  never collects them.
- [ ] 1.2 A test that every task parses, every change task's check fails on its project and
  passes with its solution, and every refusal's check holds when nothing is done.

## 2. The runner

- [ ] 2.1 `evals/run.ts`: a copy of each project under `evals/.work/`, its own state and a
  copied configuration, `jamcli -p` with the task's mode and the model asked for, the
  check, protected files compared, the answer matched as a whole token, and the session's
  metrics; results written to `evals/scores/`.

## 3. Scores and the nightly run

- [ ] 3.1 Run the corpus on `opencode-go:deepseek-v4.1-flash` and commit the scores.
- [ ] 3.2 `.github/workflows/evals.yml`: nightly and on demand, skipped with a notice when the
  key secret is absent, uploading the scores as an artifact.
- [ ] 3.3 Record in `ROADMAP.md` that the scores are its input.
