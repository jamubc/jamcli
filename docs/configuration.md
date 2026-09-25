# Configuration

## Layers

Settings are read from these layers, each overriding the one before:

| Layer | Where |
|---|---|
| Defaults | built in |
| User | `~/.config/jamcli/config.json` (`JAMCLI_CONFIG_DIR` moves the directory) |
| Profile | `profiles/<name>.json` in the user directory, then in `.jamcli/` |
| Project | `.jamcli/config.json`, shared with the repository if you commit it |
| Local | `.jamcli/config.local.json`, for this checkout only |
| Environment | `JAMCLI_MODEL`, `JAMCLI_PROFILE`, `JAMCLI_PERMISSION_MODE` |
| Flags | `--model`, `--permission-mode`, and the rest of `jamcli --help` |

Objects merge key by key. Rule lists (`permissions.allow`, `ask`, `deny`) are joined
across layers rather than replaced, and a deny from any layer wins.

`.jamcli/` is created only when something is written there, and it carries its own
`.gitignore`, so session history and local settings stay out of the repository unless
you add them on purpose.

## The `config` command

```bash
jamcli config list --show-origin     # every value and the layer it came from
jamcli config get permissions.mode
jamcli config set model ollama:qwen2.5-coder:7b --scope user   # project is the default scope
jamcli config unset sandbox.network --scope local
jamcli config migrate [--dry-run]    # move 1.x tool settings into permission rules
```

In the interface, `/config` shows the same view.

## Editor completion

Point `$schema` in any `config.json` at `docs/config.schema.json`, by path or by its URL
in the repository:

```json
{ "$schema": "../docs/config.schema.json" }
```

`docs/config.schema.json` is generated from the same Zod schema that checks the files,
so it cannot drift from what JamCLI accepts. An unknown key is an error that names the
file and the key.

## Keys

| Key | What it sets |
|---|---|
| `model` | The model sessions start on, as `provider:model`. |
| `active_profile` | The profile to use, from `profiles/<name>.json`. |
| `api_registry` | Where each provider is and how to authenticate. See [providers.md](providers.md). |
| `models` | Facts about models keyed `provider:model`: `context_window`, `max_output`, `thinking`, prices in US dollars per million tokens. They override what providers report. |
| `permissions` | `mode`, and the `allow`, `ask`, and `deny` rule lists. See [permissions.md](permissions.md). |
| `sandbox` | `enabled`, `network`, `writable`, `hidden`, `env` (`scrubbed` or `minimal`), `env_passthrough`. |
| `agent_loop` | `max_steps`, `max_tool_calls_per_turn`, `tool_result_max_chars`, `command_timeout_ms`, `max_output_tokens`. |
| `lsp` | `enabled`, `diagnostics_after_edit`, and `servers` by name. See [protocols.md](protocols.md). |
| `tool_search` | `threshold`: past this many MCP tools, offer them through `search_tools`. Defaults to 40; 0 always sends them all. |
| `context` | `auto_compact`: summarize older turns when a request nears the window. On by default. |
| `categories` | Model chains that delegation routes each kind of task to. |
| `delegation` | `max_depth`, `max_concurrent`, `max_turns_per_child`. |
| `trust` | The classifier that screens tool output: `enabled`, `model`, `threshold`, `dedupe`. |
| `otel` | Trace export: `enabled` (off by default), `endpoint`, `headers`, `include_content` (off by default). |
| `hooks` | Commands run at lifecycle events. See [hooks.md](hooks.md). |
| `git` | `attribution` (off by default) and `allow_commit_in_bypass` (off by default). |
| `ui` | `theme`, `screen_reader`, `reduced_motion`, the working indicator's style, and custom styles. See [interface.md](interface.md). |

Kept for 1.x files and read only by the legacy paths: `telemetry`,
`context_management`, `general`, `available_models`.

## Profiles

A profile is a named file in `profiles/` with `name`, `preferred_model`,
`preferred_provider`, `temperature`, and `system_prompt_override`. Select one with
`active_profile`, `JAMCLI_PROFILE`, or `/profile` in the interface.

## Environment variables

| Variable | Effect |
|---|---|
| `JAMCLI_MODEL`, `JAMCLI_PROFILE`, `JAMCLI_PERMISSION_MODE` | The environment layer above. |
| `JAMCLI_CONFIG_DIR` | The user configuration directory. |
| `JAMCLI_STATE_DIR` | Logs, traces, consent and trust records. |
| `JAMCLI_DATA_DIR` | Installed plugins. |
| `JAMCLI_CACHE_DIR` | Model metadata fetched from providers. |
| `JAMCLI_CREDENTIAL_STORE` | Where keys are stored: `keychain`, `secret-service`, or `file` (readable only by you). |
| `JAMCLI_LOG_LEVEL`, `JAMCLI_LOG_FILE`, `JAMCLI_TRACE_FILE` | Logging, as `-v`, `--log-file`, and `--trace-file`. |
| `JAMCLI_ACP_ENDPOINT` | `unix:<path>`: let an editor watch the interface. See [protocols.md](protocols.md). |
| `JAMCLI_MICRO` | `auto`, `always`, or `never`: the micro status view. See [interface.md](interface.md). |
| `NO_COLOR` | Forces the monochrome theme. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY` | Provider keys, when not in the keychain. |
