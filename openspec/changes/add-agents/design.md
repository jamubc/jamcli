## Context

The owner's framing: the pipeline matters less than the specific language the model reads
at the moment it decides whether and where to delegate. This document therefore leads with
that language, then the file format, then the decisions that make both true.

The reference is Claude Code, read from source at
`/Users/jam/Downloads/CLAUDE_CODE_DEVOP_2026_03_31/claude-code-main/src`:

- `tools/AgentTool/loadAgentsDir.ts:76-92`: an agent's frontmatter is `name`,
  `description`, `tools`, `model`, `effort`, `hooks`, `skills`, `memory`. The body is the
  agent's system prompt. Files load from user and project directories and plugins.
- `tools/AgentTool/prompt.ts:43` `formatAgentLine`: one line per target,
  `- ${agentType}: ${whenToUse} (Tools: ${tools})`.
- `tools/AgentTool/prompt.ts:66` `getPrompt`: the list inside fixed guidance. "When NOT to
  use" (`:235`), "Writing the prompt" (`:101`), "Never delegate understanding" (`:112`),
  usage notes on background runs and parallel calls.
- `tools/AgentTool/AgentTool.tsx:82-86`: the model chooses `subagent_type` by name, and may
  set `model` from a three-value enum, never a raw id.
- `prompt.ts:53`: a dynamic agent list was about 10.2% of their fleet's cache-creation
  tokens, because any change to it rebuilt the tool schema.

## Goals / Non-Goals

- Goals: the model sees a short, described, owner-curated list and the default, with
  guidance, and chooses well on the first call. A person defines or overrides an agent by
  writing one file, and sets the default in settings or in the file, which are the same
  store. An agent's rules reach its child. A chain entry's reasoning level takes effect.
  Existing `categories` configuration keeps loading.
- Non-Goals: raw `provider:model` choice by the model, graded effort, hot reload, tool
  allowlists, stages (next but one unit), rules on the main conversation.

## The language the model reads

This is the `task` description the runtime builds (`src/core/runtime/index.ts:514`), shown
for a configuration where the person has written four agent files. The static parts are
fixed text in `src/core/tools/task.ts`. The list and the default line are generated.

```
Delegate a self-contained piece of work to a child agent. It runs on its own model and
session with the same tools as you, under your permissions, and returns one final message.
The person does not see that message, so tell them what matters in it.

Agents (choose by what the work needs):
- quick: Small, well-specified jobs with a short answer: a lookup, a single-file check,
  one piece of a fan-out. Fast and cheap, not deep. (runs on ollama:qwen3:8b)
- intelligent: Hard problems where getting it right matters more than speed: a subtle
  bug, a change that crosses several modules, a design with real trade-offs.
  (runs on openrouter:anthropic/claude-sonnet-4.5, reasoning on)
- explore: Investigation across the codebase: where something lives, how two parts
  connect, what calls what. Ask it to report, not to edit. (runs on ollama:qwen3:8b)
- writing: Prose: documentation, a commit message, a summary for the person.
  (runs on openrouter:anthropic/claude-haiku-4.5)
If you omit agent, quick is used.

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
use the agent's own setting.
background: true starts the child and returns an id at once. Collect it with task_result.
Use it only when you have other work to do meanwhile.
```

With no agent files and no `categories`, the built-in list reads:

```
- quick: Small, well-specified jobs with a short answer: a lookup, a single-file check,
  one piece of a fan-out. (runs on ollama:llama3)
- intelligent: Hard problems where getting it right matters more than speed: a subtle
  bug, a change that crosses several modules. (runs on ollama:llama3)
- explore: Investigation across the codebase: where something lives, how two parts
  connect, what calls what. Ask it to report, not to edit. (runs on ollama:llama3)
- writing: Prose: documentation, a commit message, a summary for the person.
  (runs on ollama:llama3)
If you omit agent, quick is used.
```

Every built-in line ends with `(runs on ollama:llama3)`. That suffix is how the model learns
the four defaults share one small model. A description never claims a capability the
chain does not have: the suffix is generated and the description is written, and where
they disagree the suffix is the truth.

## The file a person writes

```markdown
~/.jamcli/agents/writing.md
---
description: Prose: documentation, a commit message, a summary for the person.
models:
  - openrouter:anthropic/claude-haiku-4.5
  - model: ollama:llama3
    reasoning: off
---
Write plainly. Short sentences. No em dashes, no emojis, no headings unless asked.
When summarising for the person, lead with what changed and what they must decide.
```

- The file name is the agent's name. The rules `skillNameProblem` applies to a skill name
  apply here (`src/core/ext/skills.ts:50`).
- `description` is required. A file without one is reported and skipped, as a skill
  without a name is.
- `models` is required and non-empty. A string entry is `{ model }`.
- The body is optional. When present it is appended to the child's system prompt after
  the rules the child already gets, so a project's `AGENTS.md` still applies and the
  agent's own rules come last.
- Later units add keys beside these (`input`, `output` for stages). Unknown keys are
  reported by name and the file still loads, so a file written for a later version does
  not break an earlier one.

## Decisions

- **Decision: the model chooses an agent, never a raw model.** Owner decision 1 in
  `openspec/ROADMAP.md`. Claude Code's own override is an enum of three
  (`AgentTool.tsx:86`). Alternatives considered: a free `provider:model` parameter gated
  by `providerConfigured`, rejected because the model would guess among thousands of ids;
  a second list of "model tiers" beside agents, rejected because an agent already maps a
  name to a chain and two lists would split one concept.
- **Decision: an agent is a file, and `categories` is its compatibility form.** Files
  follow the skills precedent exactly: same directories, same order, same frontmatter
  parser, same name rules. A configured category loads as an agent with no description
  and no body. Alternative: extending the `categories` JSON with `description` and a
  `rules` string, rejected because rules are prose and belong in a markdown body, and
  because Claude Code, the reference the owner named, made the same call.
- **Decision: one line per agent, `- name: description (runs on chain)`.** Claude Code's
  `formatAgentLine` with the tool list replaced by the chain, since jamcli agents share
  one tool set and differ by model. `describeChain` already renders the chain, including
  reasoning.
- **Decision: an agent is offered only if some chain entry's provider is configured.**
  `providerConfigured`: local, synchronous, no network, the same test `resolveRoute`
  applies first. Reachability stays at call time (commit `9272739`); probing every
  provider while building a tool description would put network latency into session
  start.
- **Decision: `agent` is optional; `delegation.default_agent` names the default.** With
  no default, an omitted agent is refused through the existing refusal path, naming the
  agents. The description's last list line states the default, or says "Always name an
  agent." when there is none, so the refusal is a backstop. With no configuration at all
  the default is `quick`. Alternative: computing `required` in the schema per
  configuration, rejected as a second dynamic surface for one rule the description
  already states.
- **Decision: `reasoning` on `task` uses `off | on | auto`.** It is exactly
  `ProviderRequestOptions['reasoning']`. Precedence: the call, then the chain entry, then
  the agent-loop default (`auto`, `src/core/agent.ts:524`), always through
  `downgradeReasoning`.
- **Decision: the rules body reaches only the child.** Owner decision 4. It is appended to
  the child's system prompt in `childLauncher`, after what the child already receives.
  The parent never sees it and the transcript records that the agent's rules were
  applied, by file path, so a person can tell why a child behaved as it did.
- **Decision: a settings change applies from the next session, and says so.** A runtime
  reads configuration once (`src/core/runtime/index.ts:275`). If routing re-read the files
  mid-session while the `task` description kept the old list, the model would be told one
  set of routes and served another. So a session holds one snapshot, and `/agents`,
  `jamcli config set`, and a hand edit all take effect at the next session. This also
  keeps the description stable within a session, which avoids the cache cost Claude Code
  measured (`prompt.ts:53`).

## Risks / Trade-offs

- Owner-written descriptions can oversell a model. Mitigation: the "runs on" suffix is
  generated, so the model always sees the real chain beside the claim.
- A longer `task` description costs tokens on every request. Mitigation: one line per
  agent and fixed guidance of about 250 words, stable within a session, so it sits in
  the cacheable prefix.
- A project agent file can carry rules a teammate did not write. This is the same trust
  a project `AGENTS.md` or `.jamcli/skills` already asks for, and `/agents` names the file
  each agent came from.
- Making `agent` optional changes the tool schema. Calls that name one are unaffected;
  only omission is new. Workflow files that say `category` keep working through the
  alias.

## Migration Plan

No file changes are needed. `categories` configuration loads as agents without bodies and
routes exactly as today, with the new guidance around it. `/categories` is gone;
`/agents` shows the same information and more. Rollback is reverting the change: agent
files are then ignored with a notice naming them, and `categories` still routes.

## Owner Decisions

- **Built-in agent names are `quick`, `intelligent`, `explore`, and `writing`**
  (2026-09-26). `deep` is renamed `intelligent`. Nothing outside tests names the built-in
  `deep`: the tests that use that string configure it themselves. On the default chain
  all four run on `ollama:llama3`, and the generated "runs on" suffix keeps `intelligent`
  honest there.
- **Agents, not categories, before any code is written** (2026-09-26). Recorded as
  decision 3 in `openspec/ROADMAP.md`.

## Open Questions

- **Graded effort.** If graded levels are wanted later, they extend `reasoning`'s enum
  where the catalog reports `effort` support (`src/types/config.ts:89`). A provider unit.
- **Where the rules body sits in the child's system prompt.** After the child's existing
  rules is the proposal here. If a project's rules and an agent's rules conflict, last
  wins, which is the agent. Confirm at task 1.1.
