# Change: Delegation categories the model can choose between well

## Why

When the model delegates, it chooses blind. The `task` tool tells it the category names
and nothing else: its description is the base text plus
`Categories: quick, explore, deep, writing.` (`src/core/runtime/index.ts:514`). A category
has a model chain and, per entry, a reasoning level (`src/types/config.ts:46-51`), but no
words saying what kind of work it is for. The model is asked to route work without being
told what the routes are.

Session `2026-09-26-de8c4d4a` (run in `monaco-code-editor`) shows the cost. Asked to
research three things in parallel, the model fanned out to category `quick` three times.
It had no way to know that `quick` meant a local `ollama:llama3` that was not running, or
that nothing better was on offer. The raw failures are fixed separately (commit `9272739`
wires the reachability check `resolveRoute` always had), but a clean refusal is still a
wasted turn. The model should see what it can delegate to before it calls.

Claude Code's answer to the same problem is language, not machinery. Each delegation
target is shown to the model as one line, `- type: whenToUse (Tools: ...)`
(`claude-code-main/src/tools/AgentTool/prompt.ts:43`). The list sits inside guidance on
when to delegate, when not to, and how to brief the child
(`prompt.ts:101-112`, `:235`). The model chooses by name from a short, described,
owner-curated list, and the model override is a three-value enum, never a raw model id
(`AgentTool.tsx:86`). The owner decision recorded with this proposal is to follow that
shape: the model chooses among configured categories, not among every model every
provider offers, because a list of a thousand OpenRouter and Ollama ids is not a choice,
it is a guess.

Three defects sit under the same surface and are fixed here because the new behavior
depends on them:

- **A category's reasoning level is computed and then dropped.** `resolveRoute` normalizes
  it through `downgradeReasoning` (`src/core/routing/resolve.ts:53-56`,
  `src/core/routing/capabilities.ts:8-20`), but the child is created with the model alone
  (`src/core/runtime/children.ts:104-108`), and `RuntimeOptions` has no reasoning field to
  carry it. The agent loop accepts one (`src/core/agent.ts:40`) and silently defaults to
  `auto` (`src/core/agent.ts:524`). The spec scenario "Normalize reasoning capability" is
  met on paper and has no effect.
- **The default has nowhere to live.** `category` is required
  (`src/core/tools/task.ts:27-42`), so there is no default to set, in settings or anywhere
  else.
- **Two readers assume the list shape.** `src/core/runtime/model.ts:35` and
  `src/cli/doctor.ts:113-116` read `config.categories?.quick?.[0]?.model` directly. Any
  change to what a category is has to go through one normalizer, or these break without
  an error.

## What Changes

- A category may carry a `description`: the words the model reads when choosing. The
  object form is `{ "description": "...", "models": [ { "model": "...", "reasoning": "..." } ] }`.
  The existing plain-list form keeps loading unchanged, as a category with no description,
  as "Layered Configuration" requires of files written by an earlier version. One
  normalizer in `src/core/routing/categories.ts` turns either form into one internal shape,
  and every reader goes through it.
- The `task` description is built the way Claude Code builds its agent list. There is one
  line per category: its name, its description, and the models it runs on (reusing
  `describeChain`, `src/core/routing/categories.ts:26-29`). The line names the default.
  Around the list is fixed guidance on when to delegate, when not to, and how to brief a
  child that starts with nothing. The exact text is drafted in `design.md` and is the main
  work of this change.
- Categories with no entry whose provider is configured are not offered. The check is
  `providerConfigured` (`src/core/routing/capabilities.ts:32`), which is local and costs no
  network. This follows Claude Code filtering agents whose requirements are unmet, so the
  model is never shown a route that cannot run.
- `category` becomes optional. A new key, `delegation.default_category`, names the category
  used when the model omits it. With no default set, an omitted category is refused with
  the categories named, the same way an unknown one is refused today
  (`src/core/runtime/children.ts:90`).
- `task` takes an optional `reasoning` (`off`, `on`, `auto`), the vocabulary every provider
  in the pipeline already accepts (`src/core/providers/ollama.ts:154`,
  `openai-compat.ts:112`, `anthropic.ts:447`). It overrides the category entry's level for
  that one child and is normalized against the model like any other level. `RuntimeOptions`
  gains `reasoning`, and the child is created with the route's level, which fixes the
  dropped value.
- Settings and configuration are one store. `/categories` (`src/tui/app/commands.ts:543`)
  lists each category with its description, chain, and the default. Choosing one sets it as
  the default through the same writer `/config set` uses, and the notice names the file
  written. `jamcli config set delegation.default_category <name>` and
  `jamcli config set categories.<name>.description "..."` work through the existing
  JSON-aware path writer (`src/cli/config.ts:77-79,179`). A hand edit to the file is what
  `/categories` shows next. A change applies from the next session, because a runtime reads
  configuration once at creation (`src/core/runtime/index.ts:275`), and every notice says
  so.

## Impact

- **Affected specs:** `jamcli`. "Category-Based Model Routing" and "Delegated Task
  Execution" are modified. "Delegation Choice Presentation" and "Delegation Settings" are
  added.
- **Affected code, modified:** `src/types/config.ts` (the category object form,
  `default_category` on `DelegationConfig`), `src/core/config/schema.ts:168` (a union of
  the two category forms, the new key), `src/core/routing/categories.ts` (the normalizer,
  descriptions on the built-in defaults), `src/core/routing/resolve.ts` (reads normalized
  categories), `src/core/runtime/children.ts` (normalized categories, the default, passing
  reasoning), `src/core/runtime/index.ts` (`RuntimeOptions.reasoning` into the agent, the
  new `task` description at `:514`), `src/core/tools/task.ts` (optional `category`, the
  `reasoning` parameter), `src/core/runtime/model.ts:35` and `src/cli/doctor.ts:113-116`
  (through the normalizer), `src/core/workflows/runners.ts:63` (through the normalizer),
  `src/tui/app/commands.ts:543-555` (`/categories` lists and sets the default),
  `docs/config.schema.json` (regenerated, never hand-edited), and the configuration docs.
- **Reused unchanged:** `resolveRoute` and its skip-and-report path,
  `downgradeReasoning`, `providerConfigured`, `describeChain`, the layered loader, the
  `/config` writer, and the existing refusal path in `task.ts:98-99`.
- **Not affected:** the local-first path. The built-in defaults still route to
  `ollama:llama3` with no key and no network. They gain descriptions, and `deep` is renamed
  `intelligent` (owner decision), so the built-ins are `quick`, `intelligent`, `explore`,
  and `writing`. `ollama` always counts as configured, so the defaults are always offered.
- **Deliberately not done:** letting the model name an arbitrary `provider:model` (owner
  decision, above). Graded effort levels beyond `off`, `on`, and `auto`, since only
  Anthropic exposes them. Reloading configuration in a running session, which would touch
  every key and not just these. Per-category tool allowlists, which Claude Code's agent
  types have and jamcli's categories do not. Making `/model` persist, which is a separate
  concern about the session model.
