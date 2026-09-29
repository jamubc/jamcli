# Design

## Context

A child's ask travels up a chain, and every link is an `executeBatch`. The child's own
batch decides the call with the child's engine and, on `ask`, emits `approval_request` with
a `decide` callback (`waitForDecision`, `src/core/tools/dispatch.ts`). `childLauncher`
(`src/core/runtime/children.ts:126-145`) forwards it to the `requestApproval` the `task`
call was given. That is the parent batch's nested wrapper (`dispatch.ts:167-174`), which
waits again under a scoped id `parentCallId/childCallId` and emits the request on the
parent's stream. At the top of the chain, the surface holds `decide`: the interface's
controller keeps it in a map by call id (`src/tui/app/controller.ts:165`), ACP sends
`requestPermission`, headless denies, and the MCP session keeps the latest one.

Every engine in the tree shares one rules object (`PermissionEngine.derive`,
`src/core/permissions/engine.ts:107`). A grant made anywhere is seen by every later
decision, but nothing re-runs a decision that already asked. Each child also narrows only
its own engine, so only the engine that raised an ask may decide it again.

## Goals / Non-Goals

**Goals:**
- Settle a waiting ask the moment a grant allows it, at the level that raised it, and take
  its prompt down on every surface.
- Put identical waiting asks to the person once, and record each answer per call.
- Ask once, before a fan-out, about the rules its children say they need.

**Non-Goals:**
- A grant scoped to one fan-out's children. The owner deferred it until the ledger shows
  the need.
- A mode that denies a child's asks without asking. Refused in the report.
- Cancelling an ACP editor's open permission request. ACP has no call for it; see Risks.
- Settling a waiting ask that a new deny rule now refuses. Only allowed asks are settled; a
  denied one stays in front of the person, who can still deny it.

## Decisions

### 1. `title` is required on the wire, optional in validation

`task` gets a `wireSchema` that requires `title`, the pattern `read_file`, `edit`, and
`grep` already use (`RegisteredTool.wireSchema`, `src/core/runtime/tools.ts:153`). The
`inputSchema` that validates calls keeps it optional. A small local model that drops a
required field then still starts its child, labeled by the prompt slice, rather than
spending a turn on a validation error. That keeps the local-first path working.

The label becomes the title alone, or the prompt slice, with no `agent:` prefix, because
`WorkItem.agent` already carries the agent. This lets the board drop its
`label.replace(/^[^:]*:\s*/, '')` workaround (`src/tui/app/App.tsx:221`, `:332`).
`describeCall` names a `task` call by its title, so the transcript row, the `task` prompt,
and the ledger read `task Survey the auth module` instead of clipped JSON.

### 2. The asker is a field, set by the nearest `task`

`ApprovalRequest.from?: { task: string; title: string; agent: string }`. The `watched`
wrapper in `task.ts` sets it when the request has none, so a grandchild's ask keeps the
grandchild as its asker on the way up. The reason keeps only why the call asks.

Alternative: parse the prefix back out on each surface. Rejected, because it is the
string-munging the report asks to remove.

### 3. The engine announces added rules; each waiting ask decides itself again

`PermissionEngine` keeps a listener set in its shared object, so a derived engine hears a
grant made through any engine in the tree. `add()` fires the listeners, and it skips a
rule whose text, decision, and scope are already present. Ten identical session grants are
then one rule and one notification. Session grants (`grant`), project grants
(`RuleEditor.grantProject`, which calls `engine.add`), and `/permissions allow` all pass
through `add`. `ToolDispatcher.onGrant(listener)` exposes it.

In `executeBatch`, an `ask` waits with a `redecide` function, which is the batch's own
`decide(index)`, pre_tool hook verdict included. On each grant it runs again. When it now
says `allow`, the wait settles with that verdict, and `settleDecision` records it the way it
records an allow by rule: an `approval_decision` naming the rule, its source, and the
reason.

Alternative: re-decide at the top of the chain with the top engine. Rejected, because the
top engine does not carry a child's narrowing, so it could allow a call the child's
`allowed-tools` refuse.

### 4. A settled ask withdraws itself up the chain

The `approval_request` event gains `withdrawn?: AbortSignal`, aborted with the settling
verdict as its `reason` when the ask was settled without its `decide`. `NestedApproval`
takes it as an argument, and `childLauncher` passes the child's event's signal along. The
parent's nested wrapper then stops waiting, emits `approval_decision` for the scoped id with
the verdict's rule, source, and reason, and aborts its own event's signal in turn, so a
grandchild's settlement reaches the top. Every surface already takes a prompt down on
`approval_decision`. The interface's controller also forgets the `decide` it held.

Alternative: a separate "withdrawn" event type. Rejected, because every surface would need
a new case to do what `approval_decision` already does.

### 5. Identical asks share an answer through a per-runtime registry

`ApprovalRequest.key` identifies the call: the working tree it runs in, the tool, and its
arguments. It is computed once where the request is built, so a child's key reaches the top
unchanged. Two children in different worktrees therefore never share a key. Each runtime
owns a `WaitingAsks` registry that it passes into every `executeBatch` through the agent's
options, because a background child's asks come through the batch that started it, long
after that batch returned. When one waiting ask is answered, every other ask in the
registry with the same key is settled with the same answer. Each one's own continuation
records it, so the log has one decision per call.

Surfaces show the group as one prompt. The interface groups its queue by `key`, the heading
says how many agents ask, and the waiting count counts groups. ACP keeps one open
`requestPermission` per key. An ask whose key already has one open waits for it, and it
asks on its own only if no decision for its own call arrived meanwhile.

Registries are per runtime, not shared with children. A shared registry would hold a
child's ask twice, once under its own id and once under the parent's scoped id.

### 6. The pre-flight is an approval request for the fan-out's grants

`task` takes `needs: string[]`. In `executeBatch`, after a group of consecutive `delegate`
calls is decided and before the allowed ones run, the union of their `needs` goes to
`ToolDispatcher.grantable(needs)`. That calls `PermissionEngine.grantable`, which keeps a
rule only when:

- it parses as an allow rule;
- it names a pattern where the tool takes one, and the pattern is not only wildcards, and a
  command pattern hides no code and is not an interpreter taken whole, the same vetting
  `suggestPatterns` applies;
- the example call it stands for (`subjects.ts`: `command` for `run_command`, `path` for
  the path tools, `url` for a domain) is decided `ask` today;
- that same call is decided `allow` by an engine holding the same rules and mode plus this
  one.

A rule already allowed, one denied, or one no grant can reach, such as a command with hidden
code, is therefore never offered. When nothing is left, nothing is asked.

Otherwise one request is raised. Its call is `task` under the id `<first call id>:needs`,
`grants: { rules, agents }`, a summary naming the rules and the count, and no `key`. The
answers map onto existing decisions, so no surface needs a new decision shape:

| Answer | Decision | Effect |
|---|---|---|
| Allow for this session | `{ allow, scope: 'session' }` | each rule granted for the session, source `granted before N agents started` |
| Allow for this project | `{ allow, scope: 'project' }` | written to `.jamcli/config.local.json`, source names the file and `granted before N agents started` |
| Ask as they go | `{ allow: false, proceed: true }` | nothing granted; the children start and ask as today |
| Escape | `{ allow: false }` by the person | the step stops; no child starts |
| A surface that cannot ask | `{ allow: false, by: 'mode' }` | read as ask as they go |

`ToolDispatcher.grant` and `RuleEditor.grantProject` take the source phrase, so a rule a
pre-flight granted names that fan-out in every decision it makes. That puts it in the ledger
for each child call it allowed. The pre-flight's own `approval_decision` records the joined
rules and the scope, and a `tool_result` for its id settles its transcript row.

Alternative: fold the grants into each `task` call's own prompt. Rejected, because in auto
mode `task` is allowed without asking, so there would be no prompt to carry them, and in
default mode it would be N prompts again.

### 7. Look in from the prompt

On a child's prompt, `o` opens that child's view, as Enter does on the board (`openAgent`),
and the prompt is back when the view closes. Letters other than `y` and `n` are free on the
prompt, and `o` is the key Codex uses. It is not added to the rebindable key actions, since
the prompt's own keys (1 to 5, y, n) are not rebindable either.

## Risks / Trade-offs

- [An ACP editor keeps showing a request the core settled] → the later answer is ignored,
  since `decide` on a settled wait does nothing. Identical asks send one request per key, so
  the common flood shows once. Recorded in `docs/protocols.md`.
- [The model names needs too broad to grant] → the vetting drops what the prompt would
  never offer, and the person reads every rule before allowing it. Session grants end with
  the session.
- [Applying one answer to several agents surprises the person] → the heading says how many
  agents ask and names them before the answer is given, and each call is recorded.
- [A grant re-decides every waiting ask synchronously] → a waiting ask is one decision; ten
  children at depth two are a few dozen decisions per grant.

## Migration Plan

No stored format changes. `from`, `key`, `grants`, and `withdrawn` are optional, so older
session logs read as before, and a caller of `task` that sends no `title` or `needs` behaves
as today apart from the label. Rollback is a revert of the unit's commits.
