## 1. Decide

- [ ] 1.1 Owner approves the `task` description text in `design.md` ("The language the
  model reads"), including the built-in descriptions. This is the substance of the change;
  wording changes land here, before code.
- [ ] 1.2 Owner settles the built-in names (open question in `design.md`): keep `quick`,
  `explore`, `deep`, `writing` (recommended), or replace them.
- [ ] 1.3 Confirm the config keys: `categories.<name>.description`,
  `categories.<name>.models`, and `delegation.default_category`.

## 2. Build

- [ ] 2.1 Normalize categories. In `src/types/config.ts` add the object form beside
  `CategoryChain` and `default_category?: string` on `DelegationConfig`. In
  `src/core/config/schema.ts:168` accept a union of the list form and the object form, and
  add the new key. Add `normalizeCategories` to `src/core/routing/categories.ts` returning
  `Record<string, { description?: string; chain: CategoryChain }>`. Test both forms, a mix
  of both in one file, and that a list-form file loads unchanged.
- [ ] 2.2 Route every reader through the normalizer: `categoriesOf`
  (`src/core/runtime/children.ts:62`), `getChain` and `resolveRoute`
  (`src/core/routing/resolve.ts`), `src/core/runtime/model.ts:35`,
  `src/cli/doctor.ts:113-116`, `src/core/workflows/runners.ts:63`, and `/categories`
  (`src/tui/app/commands.ts:543-555`). Behavior is unchanged, so existing tests must pass
  untouched. Add a test that the trust classifier and doctor still find `quick`'s first
  model in object form.
- [ ] 2.3 Carry reasoning to the child. Add `reasoning?: 'off' | 'on' | 'auto'` to
  `RuntimeOptions` and pass it into the agent (`src/core/agent.ts:40`). In `childLauncher`,
  create the child with `route.reasoning`. The test fails first: a category entry with
  `reasoning: 'on'` shows on the child's request today as the default.
- [ ] 2.4 Extend the `task` schema (`src/core/tools/task.ts:27-42`): `category` optional,
  `reasoning` enum `off | on | auto`. In `childLauncher` resolve an omitted category to
  `delegation.default_category`, or to `quick` when the built-in defaults are in effect, or
  refuse with the categories named. Precedence for reasoning: the call, then the category
  entry, then the agent default, all through `downgradeReasoning`. Test each branch.
- [ ] 2.5 Build the description. Move the static guidance from `design.md` into
  `src/core/tools/task.ts`. Generate the list at `src/core/runtime/index.ts:514`: one line
  per category, `- name: description (runs on <describeChain>)`, only categories with a
  configured provider, then the default line. Tests: the exact rendered text for the
  built-ins; a described object-form category; an undescribed list-form one; a category
  whose provider is unconfigured is absent; the no-default wording.
- [ ] 2.6 Validate the default. `delegation.default_category` naming no category in effect
  is reported at load with the file, the key, and the categories that exist, per "Layered
  Configuration".
- [ ] 2.7 Settings. `/categories` lists each category with description, chain, and a
  default marker. Choosing one writes `delegation.default_category` through the `/config
  set` writer, and the notice names the file and says it applies from the next session.
  `jamcli config set categories.<name>.description` on a list-form category is refused
  with the object form to use. Tests for the write, the notice, and the refusal.
- [ ] 2.8 Docs: regenerate `docs/config.schema.json` from the schema, document the object
  form and `delegation.default_category` in the configuration docs, and update the `task`
  row in `docs/tools.md`.

## 3. Verify

- [ ] 3.1 The four gates: `bun install`, `npx tsc --noEmit` at the baseline of 0,
  `bun test`, `bun run build`. The five failures that predate this unit are recorded and
  unchanged.
- [ ] 3.2 The local-first path: with no configuration and no network, the built-in
  categories are offered with their descriptions, a `task` call without a category runs
  on `quick`, and an unreachable Ollama is refused cleanly.
- [ ] 3.3 Replay the shape of session `2026-09-26-de8c4d4a` against a fake provider: a
  three-way fan-out sees the described list and the default in the request it is given.
- [ ] 3.4 `openspec validate update-delegation-categories --strict`.

## 4. Archive

- [ ] 4.1 `openspec archive update-delegation-categories --yes`, then
  `openspec validate --all --strict`.
- [ ] 4.2 Update `openspec/SEQUENCE.md` and the "Known state" in `AGENTS.md`.
