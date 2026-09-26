## Context

The owner's framing: the pipeline matters less than the specific language the model reads
at the moment it decides whether and where to delegate. This document therefore leads with
that language, then the decisions that make it true.

The reference is Claude Code, read from source at
`/Users/jam/Downloads/CLAUDE_CODE_DEVOP_2026_03_31/claude-code-main/src`:

- `tools/AgentTool/prompt.ts:43` `formatAgentLine`: one line per target,
  `- ${agentType}: ${whenToUse} (Tools: ${tools})`.
- `tools/AgentTool/prompt.ts:66` `getPrompt`: the list inside fixed guidance. "When NOT to
  use" (`:235`), "Writing the prompt" (`:101`), "Never delegate understanding" (`:112`),
  usage notes on background runs and parallel calls.
- `tools/AgentTool/AgentTool.tsx:82-86`: the model chooses `subagent_type` by name, and may
  set `model` from a three-value enum, never a raw id.
- `utils/model/agent.ts:37-78` `getAgentModel`: precedence is environment override, then
  the tool-specified model, then the agent's own, then `inherit`.
- `prompt.ts:53`: a dynamic agent list was about 10.2% of their fleet's cache-creation
  tokens, because any change to it rebuilt the tool schema.

## Goals / Non-Goals

- Goals: the model sees a short, described, owner-curated list and the default, with
  guidance, and chooses well on the first call. The owner sets descriptions and the default
  in settings or in the file, and both are the same store. A category's reasoning level
  takes effect. Existing configuration keeps loading.
- Non-Goals: raw `provider:model` choice by the model, graded effort levels, hot reload of
  configuration, per-category tool allowlists, persisting `/model`.

## The language the model reads

This is the `task` description the runtime builds (`src/core/runtime/index.ts:514`), shown
for a configuration with the owner's example vocabulary. The static parts are fixed text in
`src/core/tools/task.ts`. The list and the default line are generated from normalized
configuration.

```
Delegate a self-contained piece of work to a child agent. It runs on its own model and
session with the same tools as you, under your permissions, and returns one final message.
The person does not see that message, so tell them what matters in it.

Categories (choose by what the work needs):
- smart: Hard problems where getting it right matters more than speed: a subtle bug, a
  change that crosses several modules. (runs on openrouter:anthropic/claude-sonnet-4.5)
- thinker: Problems that need long, careful reasoning before any action: a design with
  real trade-offs, a proof, a tricky migration plan. (runs on openrouter:deepseek/deepseek-r1,
  reasoning on)
- quick: Small, well-specified jobs with a short answer: a lookup, a single-file check,
  one piece of a fan-out. Fast and cheap, not deep. (runs on ollama:qwen3:8b)
If you omit category, quick is used.

Delegate when:
- The work is independent and its intermediate output is not worth keeping in your
  context: a survey, a search across many files, a check that can run while you continue.
- There are several independent pieces: call task once per piece in the same step so they
  run together.

Do it yourself when:
- You are reading one known file, or searching two or three. That is faster than briefing
  a child.
- The work depends on this conversation in ways you cannot restate in the prompt.

Writing the prompt: the child starts with nothing. Brief it like a capable colleague who
just walked in. Say what you are trying to achieve and why, what you already know or have
ruled out, the exact files and lines involved, and what form the answer should take. Say
whether it should change code or only report. Never delegate understanding: "based on your
findings, fix it" hands the child the synthesis you owe.

reasoning: on for work that needs careful multi-step thought, off for lookups. Omit it to
use the category's own setting.
background: true starts the child and returns an id at once. Collect it with task_result.
Use it only when you have other work to do meanwhile.
```

With no configured categories, the built-in list reads:

```
- quick: Small, well-specified jobs with a short answer: a lookup, a single-file check,
  one piece of a fan-out. (runs on ollama:llama3)
- explore: Investigation across the codebase: where something lives, how two parts
  connect, what calls what. Ask it to report, not to edit. (runs on ollama:llama3)
- deep: Problems that need sustained, multi-step work. (runs on ollama:llama3)
- writing: Prose: documentation, a commit message, a summary for the person.
  (runs on ollama:llama3)
If you omit category, quick is used.
```

Every built-in line ends with `(runs on ollama:llama3)`. That suffix is how the model learns
the four defaults share one small model. A description never claims a capability the
chain does not have. Where the description and the model disagree, the "runs on" text is
the truth. Descriptions say what work a category is for, and the suffix says what will do
it.

## Decisions

- **Decision: the model chooses a category, never a raw model.** This is the owner decision
  recorded in the proposal. Claude Code's own override is an enum of three
  (`AgentTool.tsx:86`), and jamcli's categories already are the owner-curated,
  provider-agnostic equivalent. Alternatives considered: a free `provider:model` parameter
  gated by `providerConfigured`, rejected because the model would guess among thousands of
  ids, and a second list of "model tiers" beside categories, rejected because categories
  already map a name to a model chain and two lists would split one concept.
- **Decision: one line per category, `- name: description (runs on chain)`.** This is
  Claude Code's `formatAgentLine`, with the tool list replaced by the model chain, since
  jamcli categories share one tool set and differ by model. `describeChain` already renders
  the chain, including reasoning.
- **Decision: config shape is a union, normalized once.** The object form is
  `{ description?: string, models: CategoryEntry[] }`, and the plain `CategoryEntry[]` still
  loads. `normalizeCategories` in `src/core/routing/categories.ts` returns
  `Record<string, { description?: string; chain: CategoryChain }>`. `categoriesOf`,
  `resolveRoute`, `model.ts:35`, `doctor.ts:113-116`, `workflows/runners.ts:63`, and
  `/categories` all read through it. The config key is `models`, which reads naturally in a
  file. `chain` stays the internal name, where it already is. Alternative: migrating files
  to the object form on load, rejected because "Layered Configuration" requires that
  migration happen only when the user asks.
- **Decision: a category is offered only if some entry's provider is configured.** The
  check uses `providerConfigured`: local, synchronous, no network, and the same test
  `resolveRoute` applies first. Reachability (a running Ollama) stays at call time, where
  commit `9272739` put it, because probing every provider while building a tool
  description would put network latency into session start.
- **Decision: `category` is optional; `delegation.default_category` names the default.**
  With no default, an omitted category is refused through the existing refusal path, naming
  the categories. The description's last list line states the default, or says "Always name
  a category." when there is none. So the model is told the rule, and the refusal is only a
  backstop. Alternative: computing `required` in the schema per configuration, rejected as
  a second dynamic surface for one rule the description already states. With no configured
  categories, the default is `quick`, which the built-in list names.
- **Decision: `reasoning` on `task` uses `off | on | auto`.** It is exactly
  `ProviderRequestOptions['reasoning']`, which Ollama, OpenAI-compatible, and Anthropic
  providers accept today. Precedence: the call's `reasoning`, then the category entry's,
  then the agent default (`auto`, `src/core/agent.ts:524`). The result always passes
  through `downgradeReasoning`.
- **Decision: a settings change applies from the next session, and says so.** A runtime
  reads configuration once at creation (`src/core/runtime/index.ts:275`). If routing
  re-read the file mid-session while the `task` description kept the old list, the model
  would be told one set of routes and served another. So a session holds one snapshot.
  `/categories`, `jamcli config set`, and a hand edit all take effect at the next session,
  and the two command paths say so in their notice. This also keeps the description stable
  within a session, which avoids the cache cost Claude Code measured (`prompt.ts:53`).

## Risks / Trade-offs

- Owner-written descriptions can be wrong or can oversell a model. Mitigation: the
  "runs on" suffix is generated, not written, so the model always sees the real chain
  beside the claim.
- A longer `task` description costs tokens on every request. Mitigation: one line per
  category and fixed guidance of about 250 words. It is stable within a session, so it sits
  in the cacheable prefix.
- `jamcli config set categories.<name>.description` on a category still in list form has
  no object to set a key on. Mitigation: the writer refuses with the object form to use,
  and `/categories` shows which categories are in list form. The owner asking to add a
  description is the explicit request that makes conversion acceptable, but conversion is a
  follow-up, not this unit.
- Making `category` optional changes the tool schema. Existing calls that name a category
  are unaffected. Only omission is new behavior.

## Migration Plan

No file changes are needed. Existing list-form categories load as described-less
categories and are offered exactly as today, with the new guidance around them. Rollback is
reverting the change. Object-form files written in the meantime then fail validation with
the file and key named, and converting them back is removing `description` and renaming
`models` to a plain list.

## Open Questions

- **Built-in category names.** Keep `quick`, `explore`, `deep`, and `writing` (recommended:
  they name kinds of work as the spec requires, existing workflows reference them, and the
  owner's `smart`, `thinker`, and `quick` fit naturally as configured categories), or
  replace the built-ins with the owner's capability vocabulary. Capability names on four
  copies of one small model would be exactly the overselling the "runs on" suffix exists to
  expose.
- **Graded effort.** If graded levels are wanted later, they extend `reasoning`'s enum where
  the catalog reports `effort` support (`src/types/config.ts:89`). That is a provider
  change, so a later unit.
