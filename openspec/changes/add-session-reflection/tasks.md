## 1. Signals

- [x] 1.1 `src/core/reflection/signals.ts`: `signalsOf(events)` over `TranscriptEvent[]`,
  each signal carrying the index of its source event as its id.
- [x] 1.2 `tool_error`, `denied` (with the approval's feedback), and `cancelled` from tool
  messages' `toolStatus`, approval events, and `end` events.
- [x] 1.3 `retry`: a tool call whose name and arguments repeat an earlier one in the session.
- [x] 1.4 `correction`: a user message right after a failure or cancellation, low-confidence.
- [x] 1.5 `waste`: a usage event far above the session's median, and a file read that no
  later message mentions.
- [x] 1.6 Tests over hand-built event lists: each kind is found at its index, a clean
  session yields none.

## 2. Rule

- [ ] 2.1 One `docs(openspec)` commit editing `AGENTS.md` and `SEQUENCE.md`: learning is
  permitted only as reviewable files, on demand, behind the gates. Keep the failure record.

## 3. Agents

- [ ] 3.1 Confirm `add-agents` loads a bundled agent root; if it does not, add the root there.

## 4. Reflect

- [ ] 4.1 Bundle a `reflect` skill and `/reflect` command. Leave a comment at the command
  definition naming cross-session insights as out of scope.
- [ ] 4.2 Gather facts in code: the session's events and the transcript slices they cite.
- [ ] 4.3 Citation gate in code: drop findings whose event ids are missing or unknown.
- [ ] 4.4 Novelty gate: drop proposals covered by loaded rules, skills, or `AGENTS.md`.
- [ ] 4.5 TUI: show findings with citations, each diff approve or reject, and an explicit
  "nothing survived" result.
- [ ] 4.6 Tests: an invented event id is dropped; a restatement of `AGENTS.md` is dropped;
  an approved edit changes only its target section.

## 5. Skill author

- [ ] 5.1 Bundle `agents/skill-author.md`, limited to reading and proposing edits.
- [ ] 5.2 Warn on any edit to a skill that bundles scripts or declares `allowed-tools`.
- [ ] 5.3 Direct use: "make a skill for X" drafts a new `SKILL.md` for approval.

## 6. Close

- [ ] 6.1 Run `/reflect` offline with Ollama.
- [ ] 6.2 Run `/reflect` on at least 10 real sessions; record approved novel edits in
  `SEQUENCE.md` against the 0 of 26 baseline.
- [ ] 6.3 Four gates, then archive.
