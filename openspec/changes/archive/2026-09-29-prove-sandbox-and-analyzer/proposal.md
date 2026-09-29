# Change: Prove the sandbox on macOS, and the command analyzer against a real shell

## Why

R6 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). macOS is
the platform JamCLI is developed on and the least tested: the escape suite runs only under
bubblewrap and skips on macOS, and `docs/security.md` lists the Seatbelt suite as owed. The
read-only allow list in `src/core/tools/readonly.ts` is the one place a parser miss becomes
unprompted execution, and it had seven test cases and no property or fuzz test.

Probing it by hand on 2026-09-29 found two ways to run a program without being asked:

- `rg --hostname-bin=<program>` passed as read-only, and ripgrep runs that program.
- In `accept-edits` mode the engine allowed an edit to `.git/config` or a write under
  `.git/hooks/` as a change inside the project, and the read-only steering then let
  `git status` run without asking, and git runs `core.fsmonitor` from that file. So a model
  could plant a command and have it run with no prompt at all.

## What Changes

- The escape suite runs under whichever sandbox the platform has: bubblewrap on Linux,
  Seatbelt on macOS, each attempt the same.
- The read-only list refuses `rg --hostname-bin`, `file -C` and `--compile`, and git's
  `--ext-diff` and `--textconv`, which ask a read to run a program.
- A change under the project's `.git/` or `.jamcli/` asks even where the mode would allow
  a change inside the project: those files decide what git and JamCLI run.
- A differential fuzz test: generated command lines, each one the analyzer calls read-only
  executed by `/bin/sh` with every program replaced by a stub that records it, must run
  only read-only programs and write nothing.

## Impact

- Spec: `Permission Modes` gains a scenario for the project's own machinery.
- Code: `src/core/tools/readonly.ts`, `src/core/permissions/engine.ts`, tests under
  `src/core/sandbox/__tests__/` and `src/core/tools/__tests__/`, `docs/security.md`.
