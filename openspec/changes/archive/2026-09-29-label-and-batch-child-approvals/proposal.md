# Proposal

## Why

While children run, the main conversation cannot be followed. A child's label is its agent
and the first 60 characters of its prompt (`labelFor`, `src/core/tools/task.ts:33`), so ten
children read alike. Its prompts say who asks only in a string glued onto the reason
(`watched`, `task.ts:40-54`). And every child floods the prompt queue. Grants are shared
across children through the derived engine, but an ask that is already waiting is never
decided again, so ten children asking `bun test` at once leave nine prompts after the
first is allowed for the session. Approval volume is already the top seed finding in
`openspec/ROADMAP.md` (58 prompts in four default-mode sessions). The report of
2026-09-29 chose pre-flight grants over a deny-without-asking mode for children: denying a
background child in silence breaks it, and the person learns why only from a failure
report.

## What Changes

- **A child has a title.** `task` takes a `title` of three to six words, required in the
  schema the model sees, and it labels the child on the board, the work table, `/jobs`, the
  transcript row, and every prompt the child raises. A caller that gives none still gets
  the agent and the start of the prompt.
- **A prompt names who asks, as data.** An approval request carries the child that asked:
  its task id, title, and agent. Every surface names the child from that field. The prefix
  glued onto the reason goes. The interface's prompt heading names the child and its agent,
  and a key opens that child's view, as Enter on the board does.
- **A grant settles what it now allows.** After a session or project grant, every ask
  still waiting is decided again by the engine that raised it. Each one now allowed is
  settled with a decision event naming the rule and where it came from, and every surface
  takes its prompt down.
- **One prompt for identical asks.** Waiting asks for the same call in the same tree are
  shown as one prompt that says how many agents ask. The person's answer applies to each of
  them, and each is recorded on its own.
- **A pre-flight before a fan-out.** `task` takes `needs`: permission rules the child
  expects to need. Before the children of one step start, JamCLI asks once about those
  rules that would still ask and that a grant would change. There are three answers: allow
  them for the session, allow them for the project, or ask as they go. A granted rule
  carries its source, so the ledger shows that each call it allowed was allowed before the
  fan-out started. Escape stops the turn before any child starts.

## Capabilities

### New Capabilities

None. Every behavior here extends requirements the `jamcli` spec already carries.

### Modified Capabilities

- `jamcli`: **Delegated Task Execution** gains a child's title and the pre-flight before a
  fan-out. **Delegated Approvals** gains who asks as data, a grant that settles waiting
  asks, and one prompt for identical asks. **Permission Prompt Presentation** gains the
  heading that names the child, the key that looks in, the count of agents asking, and the
  pre-flight's three answers. **Decision Ledger** gains the pre-flight's source on each call
  a pre-flight grant allowed.

## Impact

- `src/core/tools/task.ts`: the `title` and `needs` arguments, the label, and the asker as
  data.
- `src/core/types.ts`: `ApprovalRequest` gains `from`, `key`, and `grants`, and the
  `approval_request` event gains a signal for an ask that was settled without an answer.
- `src/core/tools/dispatch.ts`: waiting asks are decided again after a grant, an answer
  settles identical asks, and the pre-flight runs before a fan-out.
- `src/core/permissions/engine.ts`, `src/core/runtime/tools.ts`: the engine tells listeners
  when a rule is added, an identical grant is not added twice, and it can say which rules a
  grant would change.
- `src/core/runtime/children.ts`: a child's settled ask reaches the parent's prompt.
- `src/core/approval.ts`, `src/core/work.ts`: a task call is described by its title.
- Surfaces: `src/tui/` (prompt heading, look-in key, grouped prompt, pre-flight answers),
  `src/cli/run.ts` (headless names the asker), `src/acp/` (asker in the title, one request
  per identical ask, pre-flight options), `src/mcp/session.ts` (a settled ask is cleared).
- Docs: `docs/tools.md`, `docs/permissions.md`, `docs/interface.md`.
- No new dependency, no new configuration key.
