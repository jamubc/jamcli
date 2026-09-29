# Change: Make the docs say what is true, and hold them to it

## Why

R4 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). The docs
diverged from the code within a week. The README marks twelve pages "not yet written" that
all exist in `docs/`, and sends readers to `openspec/DEFERRED.md`, which does not exist.
`docs/architecture.md` says delegated children are `jamcli -p` processes; they run in the
JamCLI process as runtimes of their own. Nothing checks what the docs under `docs/` cite,
where the site's build checks every receipt.

## What Changes

- The README's table links every page that exists, and names where open work is recorded.
- `docs/architecture.md` says children run in-process, and cites the archived design.
- `docs/feature-matrix.md` cites the archived audit, and says it is a comparison, not the
  roadmap's input: after R5 the roadmap takes the task corpus's scores instead.
- A test fails when the README or a page under `docs/` names a file, by path or by link,
  that does not exist. The changelog and the harness specification, which record the past
  on purpose, are exempt.
- The documentation's mass: every page stays. The pages a reader of the product needs are
  the ones the README lists; the harness specification and the interface brief are
  engineering records, marked as such.

No spec deltas: this is documentation of the project, not behavior of JamCLI.

## Impact

- `README.md`, `docs/architecture.md`, `docs/feature-matrix.md`, `scripts/__tests__/docs.test.ts`.
