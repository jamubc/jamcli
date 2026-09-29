# Change: A decision ledger, and the thesis moved onto it

## Why

R8 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). What
JamCLI does that the tools it is measured against do not verifiably do is already in the
code: every verdict names who decided and the rule behind it, and one append-only log is
the only state. But nothing showed it. `jamcli audit` was a configuration check, not a
record of decisions, and the approval event recorded the deciding rule but not the file it
came from. The review's recommendation: build the audit story, and ship it as the reason to
use JamCLI.

## What Changes

- The approval event records the deciding rule's source, carried from the engine's verdict
  through the dispatcher.
- `jamcli audit ledger` lists, across the project's sessions, every call that changed
  something or was refused: its target, whether it was allowed, who decided, the rule and
  its source, and the files it changed (for a command, what its step's checkpoint shows).
  `--session`, `--since`, `--refused`, and `--json` narrow and shape it.
- The thesis in `openspec/project.md` and the README lead with the auditable harness, say
  plainly that "small enough to hold in your head" is not yet true, and name the task
  corpus, not parity, as what decides what comes next.

## Impact

- Spec: `Decision Ledger` is added.
- Code: `src/core/audit/ledger.ts`, `src/cli/audit.ts`, `src/cli.ts`,
  `src/core/tools/dispatch.ts`, `src/core/runtime/tools.ts`, `src/core/types.ts`,
  `src/core/transcript/`.
