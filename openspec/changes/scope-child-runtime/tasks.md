# Tasks

## 1. A child's engine

- [ ] 1.1 A runtime test that fails today: a child loads a skill with `allowed-tools`, and the
  parent's next call after the child returns is refused; a command's narrowing on the
  parent's turn still holds the child.
- [ ] 1.2 An engine test: a derived engine shares grants and the mode; its narrowing never
  reaches the parent, survives the parent letting go, and cannot lift the parent's.
- [ ] 1.3 `PermissionEngine.derive()`, used for every child; every run lets go of what it
  narrowed. One behavior commit.

## 2. Owned pieces

Each extraction is its own refactor commit with a test that reaches the piece without
`createRuntime`, and the four gates pass at each.

- [ ] 2.1 Measure the suite: wall time of `bun test`, and the lines of `index.ts` and of the
  runtime tests.
- [ ] 2.2 Checkpoints: the store, the step's pending checkpoint, the last tree, whether the
  turn changed it, the list, restore, and `withCheckpoint`.
- [ ] 2.3 Hooks: the configuration's and plugins' hooks on the bus, and the project's trust.
- [ ] 2.4 Permission rule editing: add, remove, and a grant saved for the project.
- [ ] 2.5 The handoff: written from the log, and the previous session's read with the first
  prompt.
- [ ] 2.6 Elicitation: a server's request put to the person, and cancelled with the turn.
- [ ] 2.7 The tool offer: what is held behind `search_tools`, the task family released
  after its first call, and the extended tier decided from the window.
- [ ] 2.8 The tool sources: skills, reflection tools, plugins, MCP, language servers, and
  web search, registered into one registry.
- [ ] 2.9 The session's model: the choice, the provider, what the catalog knows, switching,
  listing, and one request outside the conversation.
- [ ] 2.10 Measure again and record both measurements in `SEQUENCE.md` at close.
