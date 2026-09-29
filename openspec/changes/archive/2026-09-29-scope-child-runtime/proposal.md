# Change: A child decides with its own engine, and the runtime is split into owned pieces

## Why

R2 of the 2026-09-29 review (`openspec/reviews/2026-09-29-architecture-review.md`).
`createRuntime` (`src/core/runtime/index.ts`) is 1,545 lines: one closure with about 50
mutable bindings and 60 imports, returning about 50 methods. Nothing in it can be tested
short of the whole assembly, which is why the suite takes 159 s and 23,966 lines.

Children took the parent's `PermissionEngine` object by reference (`index.ts:587`). A
skill's `allowed-tools` narrows the engine it is given (`index.ts:469`), and only a run
with no parent let go of it (`index.ts:1435`). So a foreground child that loaded a narrowing
skill left the parent narrowed for the rest of its turn: the parent's next edit came back
"Not run: the skill read-only allows only read_file." A background child narrowed its
parent while it ran, and the parent's turn ending lifted the child's narrowing mid-skill.

## What Changes

- `PermissionEngine.derive()` returns the engine a delegated run decides with. It shares
  the parent's rules, grants, and mode by reference, is held by the parent's narrowing, and
  narrows on its own. Every run lets go of what it narrowed when its turn ends.
- `createRuntime` is split into pieces that each own their state and can be tested without
  the assembly, in refactor commits apart from behavior: checkpoints, hooks and their
  trust, permission rule editing, the handoff, elicitation, the tool offer, the tool
  sources, and the session's model. The suite's time and size are measured before and
  after.

## Impact

- Spec: `Delegated Task Execution` gains a scenario for a child's narrowing.
- Code: `src/core/permissions/engine.ts`, `src/core/runtime/` (new modules beside
  `index.ts`), `src/core/runtime/children.ts`.
