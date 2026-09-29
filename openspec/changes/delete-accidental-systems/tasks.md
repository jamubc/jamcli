# Tasks

Each deletion is its own commit, and the four gates pass at each.

## 1. Deletions

- [ ] 1.1 Harness search: `HarnessOverrides`, the `harness` runtime option, the knobs it
  threaded into the prompt, verification, steering, and the tool set, and
  `scripts/harness-search`.
- [ ] 1.2 M3, the repeated-read refusal, and the tree its handler was keyed on.
- [ ] 1.3 Research pipelines: `src/core/research/`, `/research`, and what names them.
- [ ] 1.4 `classifier/` out of the repository, its ignored data left in place and still
  ignored.
- [ ] 1.5 `jamcli audit` reports tool verdicts from the permission engine, with a test that
  fails on the old table; then `src/core/policy/` goes.
- [ ] 1.6 Legacy configuration: the MCP manager takes the configured servers, the ACP session
  and the audit read `loadConfig`, and `ConfigService` and `src/services/config/` go.
- [ ] 1.7 One configuration shape: `Config` derived from the schema that validates it.
- [ ] 1.8 The trust gate: out of the agent loop, the runtime, and the catalog; `trust.*`
  accepted and read by nothing; a configured `trust.model` told once.

## 2. Close

- [ ] 2.1 The docs that describe any of it say what is true now.
- [ ] 2.2 Record the unit in `SEQUENCE.md`, naming the last commit that holds `classifier/`.
