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
`id` and a `base_url`; models then read `id:model`.

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

## Categories

Delegated work (`task`, `delegate`, and a workflow's `agent` step with `category`) routes
through categories, each a chain of models tried in order:

```json
{ "categories": { "quick": [{ "model": "ollama:qwen2.5-coder:7b" }, { "model": "openai:gpt-5-mini" }] } }
```

The defaults route every category to `ollama:llama3`, which must be pulled; an entry
whose provider is not configured is skipped with a reason, and a chain with no servable
entry says so. `jamcli doctor` reports the session's model and what it answers.

## Context and compaction

The context window comes from the catalog or the `models` override. Compaction runs
automatically near the budget and on demand with `/compact`; `context_management` from
1.x is still read. `/cost` reports tokens and cost per model.
