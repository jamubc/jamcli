# Providers and models

JamCLI speaks to OpenAI-compatible endpoints, Anthropic's Messages API, and Ollama. The
provider layer is described in `architecture.md`; this page is how to configure it.

## Built-in providers

| Provider | Default endpoint | Key from |
|---|---|---|
| `ollama` | `http://127.0.0.1:11434` | none |
| `openrouter` | OpenRouter's API | `OPENROUTER_API_KEY`, or `jamcli auth login openrouter` |
| `openai` | OpenAI's API | `OPENAI_API_KEY`, or `jamcli auth set openai` |
| `anthropic` | Anthropic's API | `ANTHROPIC_API_KEY`, or `jamcli auth set anthropic` |

An entry may set `base_url` to use a compatible server instead, and `key_env_var` to name
the environment variable holding the key:

```json
{
  "api_registry": {
    "ollama": { "endpoint": "http://127.0.0.1:11434" },
    "anthropic": { "base_url": "https://api.anthropic.com", "key_env_var": "MY_ANTHROPIC_KEY" }
  }
}
```

A custom OpenAI-compatible server is an entry under `api_registry.endpoints` with an
`id` and a `base_url`; models then read `id:model`. Its key is stored under the id with
`jamcli auth set <id>`. `headers` adds headers to every request, and `${session_id}` in a
value becomes the conversation's id, for a provider that routes or caches per
conversation. OpenCode Go asks for exactly that:

```json
{
  "api_registry": {
    "endpoints": [
      {
        "id": "opencode-go",
        "base_url": "https://opencode.ai/zen/go/v1",
        "headers": { "x-opencode-session": "${session_id}" }
      }
    ]
  }
}
```

Then `jamcli auth set opencode-go` and `--model opencode-go:deepseek-v4.1-flash`. Every
request names JamCLI as its user agent, `jamcli/<version>`, which such providers also ask
for.

## Keys

Keys are stored with `jamcli auth set <provider>`, which writes to the operating system's
keychain (or the file store when `JAMCLI_CREDENTIAL_STORE=file`). `jamcli auth list`
shows what is stored without printing a value; `jamcli auth remove` deletes one.
`jamcli auth login openrouter` signs in through the browser instead of pasting a key.
Keys never enter project files, and a subprocess gets none unless a setting names it.

## Models

- `/model` lists what the configured providers offer, with what is known of each, and
  switches the session's model. `/model info` describes the one in use.
- `--model provider:model` runs one turn on another model; `/profile` and profiles set
  the session's model.
- The catalog carries context windows, prices, and reasoning support. `models` in the
  configuration overrides or adds entries: `{ "models": { "openai:gpt-5": { "context_window": 400000, "price": { "input": 2, "output": 8 } } } }`.
- A model whose price is unknown reports a cost as a lower bound; `/cost` says what is
  unpriced.

## Agents

Delegated work (`task`, and a workflow's `agent` step with `category`) runs on an agent:
a name, a description the model reads when choosing, a chain of models tried in order,
and optional rules. An agent is one markdown file, `agents/<name>.md`, in the project's
`.jamcli` directory, the user configuration directory, or a plugin, the first found
winning:

```markdown
---
description: Prose: documentation, a commit message, a summary for the person.
model: openrouter:anthropic/claude-haiku-4.5
effort: low
---
Write plainly. Short sentences. No em dashes, no emojis.
```

- `description` is required. `model` names one model, `models` a chain tried in order;
  with neither, the agent runs on the session's model, so an agent can be just rules and
  an effort. An entry is a model ref, or `{ model, reasoning, effort }` with `reasoning`
  of `off`, `on`, or `auto`.
- `effort` is how hard the model thinks: `low`, `medium`, `high`, `xhigh`, or `max`. Set
  at the top it applies to every entry without its own. Anthropic receives it as
  `output_config.effort` on models that take it, OpenAI and custom endpoints as
  `reasoning_effort`, OpenRouter as `reasoning.effort` (above `high` sent as `high`), and
  Ollama's gpt-oss models as the `think` level. A `task` call may set `effort` for one
  child.
- The body is the agent's rules. Only a child running on the agent reads them, before the
  project's rules, so a project's `AGENTS.md` wins a conflict.
- The built-ins are `quick`, `intelligent`, `explore`, and `writing`. They have no chain
  and run on the session's model, whatever provider serves it. A file of the same name
  gives one a chain of its own.
- `delegation.default_agent` names the agent a `task` without one runs on; with only the
  built-ins it is `quick`. `/agents` lists every agent with where it came from and sets
  the default.
- The model sees each agent as one line, its description and the chain it runs on, and
  only agents with a model on a configured provider.

The earlier `categories` setting still works: each entry loads as an agent of that name
with that chain and no description or rules, and configured categories replace the
built-ins, as they always have.

```json
{ "categories": { "quick": [{ "model": "ollama:qwen2.5-coder:7b" }, { "model": "openai:gpt-5-mini" }] } }
```

An entry whose provider is not configured is skipped with a reason, an Ollama that is not
running is skipped before a child starts, and a chain with no servable entry says so.
`jamcli doctor` checks every configured agent's models and reports agent files it could
not read.

## Context and compaction

The context window comes from the catalog or the `models` override. Compaction runs
automatically near the budget and on demand with `/compact`; `context_management` from
1.x is still read. `/cost` reports tokens and cost per model.
