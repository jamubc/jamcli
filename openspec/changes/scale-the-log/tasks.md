# Tasks

- [ ] 1.1 `SessionLog.events()` reads only what was appended, with frozen events, and a test
  that fails on a whole-file read.
- [ ] 1.2 The session index appended to, versioned, and rewritten only when stale lines
  outnumber sessions, with a test.
- [ ] 1.3 A lockfile from a newer JamCLI is neither read nor written, with a notice, and a test.
- [ ] 1.4 Measure the log read, a checkpoint, and both search backends at scale, and record
  the numbers in `SEQUENCE.md`.
