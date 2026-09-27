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

- [x] 2.1 One `docs(openspec)` commit editing `AGENTS.md` and `SEQUENCE.md`: learning is
  permitted only as reviewable files, on demand, behind the gates. Keep the failure record.
  Done: `576093f`.

## 3. Agents

- [x] 3.1 Not needed: no bundled agent. The main session proposes lessons itself.

## 4. Reflect

- [x] 4.1 `/reflect`, with a built-in prompt a skill named `reflect` replaces. The
  cross-session TODO is in `prompt.ts`. Done: `933ceb0`.
- [x] 4.2 Facts in code: `session_signals` lists each signal with its id and what the model
  had said just before. Done: `ec35f94`.
- [x] 4.3 Citation gate: a lesson citing no signal, or an unknown id, is denied before any
  approval is asked. Done: `8d06286`, `ec35f94`.
- [x] 4.4 Novelty gate: a lesson a rule, a skill, or the target file already says is denied.
  Done: `8d06286`.
- [x] 4.5 Review: the approval diff, with the finding and any skill warning, approved or
  declined per lesson; the prompt ends with what was proposed, refused, or not needed.
  Offered only on the `/reflect` turn. Done: `ec35f94`.
- [x] 4.6 Tests: an invented id is denied unasked; a restatement is denied; an approved edit
  changes only its section; a declined one writes nothing; an ordinary turn is not
  offered the tools. Done: `8d06286`, `ec35f94`.

## 5. Skill author

- [x] 5.1 Dropped: no bundled agent; the main session proposes through `propose_lesson`.
- [x] 5.2 Warn on any edit to a skill that bundles scripts or declares `allowed-tools`.
  Done: `8d06286`.
- [x] 5.3 Dropped: a new skill is drafted by asking the session for one, as any file is.

## 6. Close

- [ ] 6.1 Run `/reflect` end to end against a real provider. The owner directed that
  tests use OpenCode Go (`opencode-go:deepseek-v4.1-flash`), not Ollama.
- [ ] 6.2 Run `/reflect` on at least 10 real sessions; record approved novel edits in
  `SEQUENCE.md` against the 0 of 26 baseline.
- [ ] 6.3 Four gates, then archive.
