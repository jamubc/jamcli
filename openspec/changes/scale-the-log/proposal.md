# Change: Read the session log incrementally, append to the index, and version what an older JamCLI could misread

## Why

R9 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`). The
transcript is the source of truth, and its implementation was not ready for a long session or
many of them: `SessionLog.events()` read and parsed the whole file on every call, from
checkpoint listing, notes, handoff, the gate ledger, fork, and close, and the global session
index was one JSONL rewritten whole on every update. The review also found no version field on
the state index or the plugin lockfile, so a file a newer JamCLI wrote would be misread by an
older one, and it named two costs at ten times the code: search with ripgrep optional, and a
git checkpoint on every changing step.

## What Changes

- `SessionLog.events()` parses only what was appended since its last read, whoever appended
  it; a line not yet finished waits for the next read, and a file that shrank or was replaced
  is read again whole. The events it returns are shared by every caller, so they are frozen.
- The session index is appended to, one line per update; a session's last line is its summary,
  and one session recorded under two spellings of its project is one entry. When stale lines
  outnumber the sessions, it is rewritten with the last lines only.
- Each index line carries `v: 1`, and a line from a newer version is skipped. The plugin
  lockfile's `version` is read: a lockfile a newer JamCLI wrote is neither read nor written,
  and the session says its plugins are off.
- The two ten-times costs are measured on a tree ten times this repository's source, and
  changed only if the numbers ask for it.

## Impact

- Spec: `Plugin Packaging and Installation` gains a scenario for a newer lockfile.
- Code: `src/core/transcript/log.ts`, `src/core/transcript/sessions.ts`,
  `src/core/plugins/lock.ts`, `src/core/runtime/sources.ts`.
