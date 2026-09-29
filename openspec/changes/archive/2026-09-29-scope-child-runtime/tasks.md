# Tasks

## 1. A child's engine

- [x] 1.1 A runtime test that fails today: a child loads a skill with `allowed-tools`, and the
  parent's next call after the child returns is refused; a command's narrowing on the
  parent's turn still holds the child.
- [x] 1.2 An engine test: a derived engine shares grants and the mode; its narrowing never
  reaches the parent, survives the parent letting go, and cannot lift the parent's.
- [x] 1.3 `PermissionEngine.derive()`, used for every child; every run lets go of what it
  narrowed. One behavior commit.

## 2. Owned pieces

Each extraction is its own refactor commit with a test that reaches the piece without
`createRuntime`, and the four gates pass at each.

- [x] 2.1 Measure the suite: wall time of `bun test`, and the lines of `index.ts` and of the
  runtime tests.
- [x] 2.2 Checkpoints: the store, the step's pending checkpoint, the last tree, whether the
  turn changed it, the list, restore, and `withCheckpoint`.
- [x] 2.3 Hooks: the configuration's and plugins' hooks on the bus, and the project's trust.
- [x] 2.4 Permission rule editing: add, remove, and a grant saved for the project.
- [x] 2.5 The handoff: written from the log, and the previous session's read with the first
  prompt.
- [x] 2.6 Elicitation: a server's request put to the person, and cancelled with the turn.
- [x] 2.7 The tool offer: what is held behind `search_tools`, the task family released
  after its first call, and the extended tier decided from the window.
- [x] 2.8 The tool sources: skills, reflection tools, plugins, MCP, language servers, and
  web search, registered into one registry.
- [x] 2.9 The session's model: the choice, the provider, what the catalog knows, switching,
  listing, and one request outside the conversation.
- [x] 2.10 The runtime's types in a module of their own, so `index.ts` is the assembly alone.
- [x] 2.11 Measure again and record both measurements in `SEQUENCE.md` at close.
