# Change: Hold the hard rules and unused code with tools, and name an owner for every path

## Why

R10 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). The
repository had no lint, no formatter, and no `CODEOWNERS`, and its rules lived in prose: no em
dashes, conventional lowercase commits, no AI attribution. Five contributors would each have to
read `AGENTS.md` and remember it.

## What Changes

- `scripts/check-rules.ts` holds the hard rules a tool can hold: no em dash in any tracked text
  file, and every commit a push or pull request adds is a conventional, lowercase commit with
  no em dash and no AI attribution. A `rules` job runs it on every push.
- The compiler refuses unused locals and parameters (`noUnusedLocals`, `noUnusedParameters`),
  so the type gate that already runs everywhere holds dead code at zero.
- `.github/CODEOWNERS` names the owner for every path.
- A linter and a formatter are measured, not added: both need a new dependency, which is the
  owner's to approve, and a formatter would rewrite most files at once. The numbers go in
  `SEQUENCE.md`.

No spec deltas: this is tooling, and no requirement describes it.

## Impact

- `scripts/check-rules.ts`, `.github/workflows/ci.yml`, `tsconfig.json`, `.github/CODEOWNERS`,
  and the files the compiler finds unused code in.
