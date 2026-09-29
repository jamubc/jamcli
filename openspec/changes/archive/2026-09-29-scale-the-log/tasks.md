# Tasks

- [x] 1.1 `SessionLog.events()` reads only what was appended, with frozen events, and a test
  that fails on a whole-file read (`5217555`).
- [x] 1.2 The session index appended to, versioned, and rewritten only when stale lines
  outnumber sessions, with a test (`5fec7f9`).
- [x] 1.3 A lockfile from a newer JamCLI is neither read nor written, with a notice, and a test
  (`6ff7683`).
- [x] 1.4 Measure the log read, a checkpoint, and both search backends at scale, and record
  the numbers in `SEQUENCE.md`. Search and checkpoints are unchanged: the numbers did not ask
  for it.
