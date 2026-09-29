# Change: Gate on macOS, and put master on origin

## Why

R1 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). CI marks
the macOS gate `continue-on-error`, so on the platform JamCLI is developed on, red is
invisible. The comment that justifies it names known macOS failures; the last CI run on
`master` (run 36376982460) passed every macOS step, so the exemption hides nothing but
future regressions. `master` is 71 commits ahead of `origin`, which is the only copy off
this machine.

## What Changes

- `.github/workflows/ci.yml` drops `continue-on-error` from the gates job, so a macOS
  failure fails the run and every job that needs `gates`.
- `master` is pushed to `origin`, and the run that push starts is read to the end; what it
  turns up on macOS is fixed here.

No spec deltas: this is how the project is gated, not behavior of JamCLI.

## Impact

- `.github/workflows/ci.yml`
