# Migrating to 2.0.0

JamCLI 2.0.0 keeps reading what version 1 wrote. Nothing has to be moved by hand, but a
few settings and habits changed.

## Configuration

- `jamcli config migrate [--dry-run]` moves 1.x tool settings that lived in
  `.jamcli/mcp.json` into permission rules. Run it with `--dry-run` first: it prints each
  rule it would write.
- These 1.x keys are still read when present: `telemetry`, `context_management`,
  `general`, and `available_models`. New settings are written in the current schema; see
  `configuration.md` and `config.schema.json`.
- `jamcli config list` shows every setting with the file it comes from, layer by layer.
  `jamcli config get`, `set`, and `unset` read and change the same layers.

## Keys

- Provider keys no longer belong in project files. Store them with
  `jamcli auth set <provider>`, which writes to the operating system's keychain (or the
  file store when `JAMCLI_CREDENTIAL_STORE=file`), and `jamcli auth list` shows what is
  stored without printing the value.
- A provider entry may still name an environment variable with `key_env_var`; the value
  never has to be written down.

## Sessions and history

- Version 1 history still loads and resumes. `jamcli sessions list`, `search`, `show`,
  `export`, and `fork` work on old and new sessions alike, and `-p --continue` and
  `--resume <id>` continue an old one.
- Sessions are recorded as JSONL under the project's `.jamcli/history/`, which is
  git-ignored by JamCLI on first write.

## Permissions

- Per-tool approval is replaced by modes: `plan`, `default`, `accept-edits`, `auto`, and
  `bypass`. A mode decides what asks; rules in the user, project, and project-local
  configuration decide what is allowed or denied, by path, command, or domain. A deny
  always wins.
- `--allow-tool` and `--deny-tool` still work for one run, and
  `--allowed-tools`/`--disallowed-tools` take rule text such as `edit(src/**)`.

## Tool names

- `list_files` and `search_code` remain registered as hidden aliases so permission files,
  profiles, and older sessions that name them keep working. The model is offered only
  `glob` and `grep`.

## The interface

- The Ink interface is gone. The OpenTUI interface is the only one; it is what `jamcli`
  starts. Screen reader mode (`--screen-reader`), reduced motion, and micro mode are
  described in `interface.md`.
- Keybindings load from the configuration and from `keys.bindings`; `/help` lists the
  commands and keys in effect.
