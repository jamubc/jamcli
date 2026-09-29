# Tasks

- [x] 1.1 `scripts/local-path.ts`: the turn, its hard checks, and its report.
- [x] 1.2 `.github/workflows/local.yml`: Ollama on the Linux runner, the model cached, the
  check at 8,192 tokens.
- [x] 1.3 Push, read the job's run to the end, and fix what it turns up. The first run
  printed FAIL and passed: the check was piped through `tee` without `pipefail`
  (`8cdc265`). What it printed was a real break: every turn on a model that cannot think
  was refused by Ollama (`38ab7bf`).
- [x] 1.4 Record the measurements in `SEQUENCE.md`.
