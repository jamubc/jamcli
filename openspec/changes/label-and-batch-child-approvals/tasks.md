# Tasks

## 1. The flood, before

- [ ] 1.1 In a throwaway fixture project with its own `JAMCLI_STATE_DIR` and a copied `JAMCLI_CONFIG_DIR`, drive the interface built from this branch's base through `jamcli mcp serve`'s `terminal_*` tools on `opencode-go:deepseek-v4.1-flash`, in default mode. Ask for several background children that each run the same test command, allow the first ask for the session, and keep the recording. It is done when the recording shows the prompts that remain after the grant and the labels built from each prompt's first words.

## 2. A child's title

- [ ] 2.1 Add `title` to `task`: a `wireSchema` that requires it, an `inputSchema` that does not, and a label that is the title, or the prompt's first 60 characters when there is none, with no agent prefix. Name a `task` call by its title in `describeCall`, and drop the prefix-stripping from the board in `src/tui/app/App.tsx`. Verify with `src/core/runtime/__tests__/children.test.ts` (a titled child's work item and transcript line carry the title; an untitled one falls back to the prompt) and the board test in `src/tui/app/__tests__/board.test.tsx`.
- [ ] 2.2 Say in the `task` description and in `docs/tools.md` what the title is for and how long it is, and verify with `bun test src/core/runtime/__tests__/prompt` and the docs check.

## 3. Who asks, as data

- [ ] 3.1 Add `ApprovalRequest.from` (`task`, `title`, `agent`), set it in `watched()` when absent, and remove the reason prefix. Replace the prefix assertion at `src/core/runtime/__tests__/children.test.ts:410` with one on `from`, and verify that a grandchild's ask reaches the top naming the grandchild.
- [ ] 3.2 Interface: the prompt heading names the child's title and agent before the call, in both styled and screen reader modes, and `o` on a child's prompt opens that child's view, with the prompt back when it closes. Verify with a test in `src/tui/app/__tests__/prompt.test.tsx` that drives a child's ask, and document the key and heading in `docs/interface.md`.
- [ ] 3.3 Headless names the child in a denial (`PermissionDenial.from`), ACP puts the child's title and agent in the permission request's title, and the MCP session's waiting approval carries it. Verify with one assertion added to an existing headless child test and one to an existing ACP permission test, then document it in `docs/protocols.md` and `docs/headless.md`.

## 4. A grant settles what it now allows

- [ ] 4.1 `PermissionEngine` keeps grant listeners in its shared object, fires them from `add()`, and skips a rule already present with the same text, decision, and scope. `ToolDispatcher.onGrant` exposes the listeners. Verify with an engine test showing that a derived engine hears a grant made through its parent and that a repeated grant adds nothing and fires nothing.
- [ ] 4.2 In `executeBatch`, a waiting ask re-runs its own `decide` on each grant. When the result is `allow`, it settles with an `approval_decision` naming the rule, its source, and the reason, and aborts its event's `withdrawn` signal. The nested wrapper takes a child's `withdrawn`, stops waiting, and emits the decision for the scoped id. `childLauncher` passes the signal up. Verify with a runtime test that fails on `master`: several children ask different `bun test` commands, one is allowed with the pattern `run_command(bun test *)` for the session, and every other ask settles without an answer, each decision naming that rule.
- [ ] 4.3 The interface's controller forgets a `decide` once its call is decided, and the MCP session clears a waiting approval whose call was decided. Verify with the runtime test above driven through the interface harness, asserting that no prompt remains, and with one assertion in the MCP session test. Document settling in `docs/permissions.md`.

## 5. Identical asks are one prompt

- [ ] 5.1 Add `ApprovalRequest.key` (working tree, tool, arguments), computed where the request is built, and a per-runtime `WaitingAsks` registry passed through the agent's options into every `executeBatch`. An answer to one waiting ask settles every other with the same key, each recorded by its own continuation. Verify with a dispatch test: two identical waiting asks, one answered `allow once`, both run and both are recorded, while a differing ask still waits.
- [ ] 5.2 Interface: group the prompt queue by `key`, say in the heading how many agents ask and name them, and count groups in `1 of N waiting`. Verify with the report's test in `src/tui/app/__tests__/prompt.test.tsx`, which fails on `master`: ten children ask the same command, one prompt says ten agents ask, one session answer leaves no prompt, and all ten run.
- [ ] 5.3 ACP: keep one open `requestPermission` per key, and have a later ask with that key ask on its own only when its call was not decided meanwhile. Verify with an ACP test where two identical child asks reach the editor as one request, then document it in `docs/protocols.md`.

## 6. The question before a fan-out

- [ ] 6.1 Add `needs` to `task`, and `PermissionEngine.grantable` with the example call for a rule in `src/core/permissions/subjects.ts`. It keeps a rule only when its example call asks today and would be allowed with the rule added, and it drops bare, wildcard-only, hidden-code, and interpreter-wide rules. Verify with engine tests covering each kept and dropped case, including a rule a deny covers and one already allowed.
- [ ] 6.2 `ToolDispatcher.grantable` and a source phrase on `ToolDispatcher.grant` and `RuleEditor.grantProject`. In `executeBatch`, after a delegation group is decided, raise one request carrying `grants` and apply the answer as the design's table says, then settle its row with a `tool_result`. Verify with dispatch tests: a session answer grants the rules with the fan-out's source; ask as they go grants nothing and runs the children; Escape runs none and answers each call; nothing is asked when no rule is grantable.
- [ ] 6.3 Interface: the pre-flight prompt lists the rules and how many agents start, and offers 1 allow for this session, 2 allow for this project, and 3 ask as they go, with Escape stopping the turn. Verify with an interface test where two children with `needs` start after one session answer and run without asking. Then check that `jamcli audit ledger` names the pre-flight source on their calls.
- [ ] 6.4 ACP offers allow for this session and ask as they go on a pre-flight; the MCP session maps `allow_session`, `deny`, and a refused `allow_once`; headless treats a pre-flight as ask as they go. Verify with one ACP assertion and the headless child test. Document `needs` and the question in `docs/tools.md`, `docs/permissions.md`, and `docs/interface.md`.

## 7. The flood, after, and close

- [ ] 7.1 Repeat 1.1 on this branch's build, restarting `jamcli mcp serve` first, with the orchestrator free to name `needs`. It is done when the recording shows the titled children on the board, prompts that name their child, identical asks as one prompt, and no prompt left after the grant.
- [ ] 7.2 Run the four gates (`bun install`, `npx tsc --noEmit` at the baseline of 0, `bun test` under 150 s, `bun run build`) and `openspec validate label-and-batch-child-approvals --strict`.
- [ ] 7.3 Record the unit in `openspec/SEQUENCE.md` and `openspec/ROADMAP.md`, and archive the change.
