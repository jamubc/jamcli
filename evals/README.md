# Task corpus

Twenty tasks that JamCLI is scored on, through the real program. Their scores, not a feature
comparison, are what the roadmap takes as its input (`openspec/ROADMAP.md`).

Each task under `tasks/<id>/` is a small project (`repo/`), a prompt, and a deterministic
check (`task.json`):

- `change`: the check proves the work, usually a test the task protects from edits. The
  task's `solution.json` is a reference solution.
- `answer`: the reply must name the answer as a whole token, and no file may change.
- `hold`: the check proves something that must stay so, such as a file outside the project.

`bun test evals` proves every change task's check fails on its project as given and passes
with its solution, and every hold's check holds when nothing is done and breaks when it is
undone. Fixture tests are named `*.check.ts`, so the repository's own suite never runs them.

## Running it

```bash
bun evals/run.ts                                   # every task, on opencode-go:deepseek-v4.1-flash
bun evals/run.ts --tasks fix-off-by-one,answer-port --model ollama:qwen3:8b
```

Each task runs `jamcli -p` from this checkout's source in a fresh copy of its project under
`~/.cache/jamcli-evals/` (or `JAMCLI_EVAL_WORK`), with its own state directory and a copy of the
configuration directory (`--config-dir`, by default the user's). The work stays outside any
checkout, so no ancestor's `.jamcli/` becomes the project, and outside the temporary directory,
which the sandbox may write. Scores are written to `scores/<date>-<model>.json`: each task's
outcome and reasons, its cost and time, and the session's metrics from `src/core/eval/score.ts`.

Scores are committed by a person. The nightly workflow, `.github/workflows/evals.yml`, uploads
them as an artifact instead, since a commit made by a job would carry an identity other than
the owner's.
