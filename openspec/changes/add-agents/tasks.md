## 1. Decide

- [x] 1.1 Owner approves the `task` description text and the agent file format in
  `design.md` (2026-09-26). The rules body sits before the project's rules, so a
  project's `AGENTS.md` comes last and wins: see "Owner Decisions" in `design.md`.
- [x] 1.2 Owner settles the built-in names. Done: `quick`, `intelligent`, `explore`,
  `writing`. See "Owner Decisions" in `design.md`.
- [x] 1.3 Owner settles the concept. Done: agents, with `categories` as the compatibility
  form. See `openspec/ROADMAP.md`, decision 3.

## 2. Build

- [ ] 2.1 `src/core/ext/agents.ts`: `agentDirs` (the skills order,
  `src/core/ext/skills.ts:39-47`, with `agents` for `skills`), `readAgent` (frontmatter
  through `parseFrontMatter`; `description` required; `models` required, string entries
  become `{ model }`; body is `rules`; unknown keys reported), `BUILTIN_AGENTS` (the four,
  with descriptions and no chain, running on the session's model), and `loadAgents(projectRoot, config)` merging
  files over `categories` over built-ins into `Record<string, Agent>`. Tests: each
  directory scope wins in order; a category loads without description or rules; each
  rejection reason; an unknown key is reported and the file loads.
- [ ] 2.2 Route every reader through `loadAgents`: `categoriesOf`
  (`src/core/runtime/children.ts:62`), `resolveRoute` (`src/core/routing/resolve.ts`),
  `src/core/runtime/model.ts:35`, `src/cli/doctor.ts:113-116`,
  `src/core/workflows/runners.ts:63` with `schema.ts:26` accepting `agent` and keeping
  `category` as an alias. Behavior is unchanged, so existing tests pass untouched. Add a
  test that the trust classifier and doctor still find `quick`'s first model when
  `quick` comes from a file.
- [ ] 2.3 Carry reasoning to the child. Add `reasoning?: 'off' | 'on' | 'auto'` to
  `RuntimeOptions` and pass it into the agent loop (`src/core/agent.ts:40`). In
  `childLauncher`, create the child with `route.reasoning`. The test fails first: a chain
  entry with `reasoning: 'on'` shows on the child's request today as the default.
- [ ] 2.4 Carry rules to the child. `childLauncher` appends the agent's `rules` to the
  child's system prompt before the project's rules, and the child's session log
  records the source path. Test: a file agent's body appears on the child's first request
  and not on the parent's.
- [ ] 2.5 Extend the `task` schema (`src/core/tools/task.ts:27-42`): `agent` optional,
  `reasoning` enum. In `childLauncher` resolve an omitted agent to
  `delegation.default_agent`, or to `quick` when only built-ins are in effect, or refuse
  with the agents named. Precedence for reasoning: the call, then the chain entry, then
  the loop default, through `downgradeReasoning`. Test each branch.
- [ ] 2.6 Build the description. Move the static guidance from `design.md` into
  `src/core/tools/task.ts`. Generate the list at `src/core/runtime/index.ts:514`: one line
  per agent, `- name: description (runs on <describeChain>)`, only agents with a
  configured provider, then the default line. Tests: the exact rendered text for the
  built-ins; a described file agent; an undescribed category agent; an agent whose
  provider is unconfigured is absent; the no-default wording.
- [ ] 2.7 Validate the default. `delegation.default_agent` naming no agent in effect is
  reported at load with the file, the key, and the agents that exist.
- [ ] 2.8 `/agents` replaces `/categories` (`src/tui/app/commands.ts:543-555`): source,
  description, chain, rules yes/no, default marker. Choosing one writes
  `delegation.default_agent` through the `/config set` writer; the notice names the file
  and says it applies from the next session. Tests for the listing, the write, and the
  notice.
- [ ] 2.9 Docs: regenerate `docs/config.schema.json`; document the agent file format and
  `delegation.default_agent`; update the `task` row in `docs/tools.md`; replace
  `/categories` with `/agents` wherever it is named.

## 3. Verify

- [ ] 3.1 The four gates: `bun install`, `npx tsc --noEmit` at the baseline of 0,
  `bun test`, `bun run build`. The five failures that predate this unit are recorded and
  unchanged.
- [ ] 3.2 The local-first path: with no configuration and no network, the built-ins are
  offered with their descriptions, a `task` call without an agent runs on `quick`, and an
  unreachable Ollama is refused cleanly.
- [ ] 3.3 Replay the shape of session `2026-09-26-de8c4d4a` against a fake provider: a
  three-way fan-out sees the described list and the default in the request it is given.
- [ ] 3.4 `openspec validate add-agents --strict`.

## 4. Archive

- [ ] 4.1 `openspec archive add-agents --yes`, then `openspec validate --all --strict`.
- [ ] 4.2 Update `openspec/SEQUENCE.md`, `openspec/ROADMAP.md`, and the "Known state" in
  `AGENTS.md`.
