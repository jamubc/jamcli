## 1. Fix

- [x] 1.1 Announce a child's answered prompt and forward its result to the delegating
  surface; test that two prompts in a row can each be answered.
- [x] 1.2 Wrap a command in the prompt and scroll it past its space; test a long line.
- [x] 1.3 Skip state tools in the trust gate; give a duplicate its twin's verdict; honor
  `trust.dedupe`; test each.
- [x] 1.4 Give a sandboxed language server no parent to watch; test both cases, and
  check `typescript-language-server` under Seatbelt stays up.
- [x] 1.5 Log failure reasons, prompt waits, and unanswered prompts; test at the default
  level.

## 2. Close

- [x] 2.1 Four gates on the branch head.
- [x] 2.2 `openspec validate --strict`, then archive and record in `SEQUENCE.md`.
