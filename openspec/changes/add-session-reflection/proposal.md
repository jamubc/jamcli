# Change: Session reflection and self-authored skills

## Why

JamCLI is meant to be a bare core that a user grows. Today it grows only by hand: when a
session goes wrong, nothing records what went wrong, and turning that into a better skill
or rule is left entirely to the user.

This reopens a rejected candidate. `openspec/SEQUENCE.md` records that
`hermes-plasticity-plugin` ran 26 cycles, spent roughly 138,000 tokens, and committed zero
memories: "an LLM writing book reports about what another LLM had already done". The
causes are identifiable, and this change is shaped against each one:

- **It ran unprompted.** Here reflection runs only when the user asks for it.
- **It summarized instead of diagnosing.** Here every finding must cite recorded event
  IDs from deterministic capture, and code drops any that do not.
- **It restated what was known.** Here a novelty gate drops proposals already covered by
  loaded rules, skills, or `AGENTS.md`.
- **It rewrote wholesale.** Here the only output is a delta edit to one section of one
  file, following ACE (arXiv 2510.04618), which measured full rewrites collapsing context
  below a no-memory baseline.
- **It committed silently.** Here nothing is written without the user approving a diff.

Skill misevolution (arXiv 2608.12851) shows distilled skills can keep an unsafe procedure
after losing its trigger, so edits that touch a skill with scripts or `allowed-tools` carry
a safety warning.

## What Changes

- **Failure capture.** A pure function reads the session log and derives signals: tool
  errors, retries, denied approvals (with the user's feedback), cancellations, likely user
  corrections (marked low-confidence), and waste (token spikes, files read and never used).
  The log already records all of this, so nothing new is recorded or persisted, and no
  model is called. A signal's id is the index of the log event it came from, so a citation
  can always be checked against the log.
- **`/reflect`.** A command for the current session only. The main session reflects
  itself: it calls `session_signals`, and proposes each lesson through `propose_lesson`,
  which cites signal ids, adds lines under one heading of one markdown file (`AGENTS.md`, a
  rules file, a `SKILL.md`, or an agent file), always asks, and shows the diff. The
  existing approval diff is the review screen. A project or user skill named `reflect`
  replaces the built-in prompt, which is how the user customizes it.
- **Offered only when asked for.** The two tools register hidden. `/reflect` names them in
  `RunOptions.offer`, the gate hook exists only while that turn runs, and no other request
  carries their schemas or a hook per tool call.
- **No separate agent or view.** An earlier draft had a bundled `skill-author` agent and a
  `ReflectView` screen. Neither was needed: the session that saw the failures proposes
  the lessons, and the approval diff reviews them.
- **Hard rule change.** `AGENTS.md` and `SEQUENCE.md` move from "no learning" to "learning
  only as reviewable files, on demand, behind the gates", keeping the failure record.

## Not in this change

- Cross-session insights (a `/insights` over many sessions). Recorded as a candidate.
- Automatic or background learning of any kind.
- A user profile or fact memory.
- Self-modification of code or weights.

## Layout

Everything specific to learning lives in one place, so working on it means opening one
directory. Other modules get only the thin wiring that is theirs to own.

```
src/core/reflection/
  index.ts        public surface
  signals.ts      derives signals from a session's log events (no model calls)
  lesson.ts       citation and novelty gates, the section append, the skill warning
  tools.ts        session_signals and propose_lesson
  prompt.ts       the /reflect prompt, replaced by a skill named reflect
  __tests__/
src/tui/app/reflect.ts   the /reflect command
```

Wiring outside that directory, each a few lines in the module that owns it:

- `src/core/runtime/index.ts`: register the tools hidden, and subscribe the gate hook only
  for a turn that offers `propose_lesson`.
- `src/core/runtime/tools.ts`: `alsoOffer`, the hidden tools a turn asked for.
- `src/core/approval.ts`: the `propose_lesson` preview, its diff and warning.
- `src/tui/app/commands.ts`: register `/reflect`.

Signals read `src/core/transcript/` through `SessionLog`; nothing else in the core changes
for capture.

## Impact

- Specs: ADDED Failure Signals, Session Reflection.
- Depends on nothing else in flight. A lesson may target an agent file from `add-agents`.
- Code: see Layout.
- Evidence bar: `/reflect` run on at least 10 real sessions, with the count of approved,
  novel edits recorded in `SEQUENCE.md` against the 0 of 26 baseline.
