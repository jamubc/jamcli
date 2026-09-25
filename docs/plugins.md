# Plugins

A plugin is a directory with a `jamcli-plugin.json` manifest. It can add commands,
skills, hooks, and MCP servers, and it runs in a sandbox sized to what it declares.

## The manifest

```json
{
  "name": "acme-tools",
  "version": "1.0.0",
  "description": "Acme's helpers",
  "engines": { "jamcli": ">=2.0.0" },
  "permissions": {
    "network": ["api.acme.dev"],
    "env": ["ACME_TOKEN"],
    "filesystem": "none"
  },
  "contributes": {
    "commands": "commands",
    "skills": "skills",
    "hooks": "hooks.json",
    "mcpServers": { "acme": { "command": "./bin/acme-mcp", "args": [] } }
  }
}
```

- `name` is lowercase letters, digits, and single hyphens; `version` is a semantic
  version; `engines.jamcli` is a semver range checked against the running version.
- Paths under `contributes` are relative and must stay inside the plugin.
- `permissions.network` is a list of hosts, `permissions.env` a list of environment
  variable names, and `permissions.filesystem` is `none` (the default) or `project`.
  Nothing is reachable unless it is declared.

## Installing

```
jamcli plugin install <path | git-url[#ref]> [--scope user|project] [--yes]
jamcli plugin list | enable <name> | disable <name> | update <name> | verify | remove <name>
```

Installing shows every contribution and permission first and stores nothing without
consent; `--yes` consents for a run with nobody to ask. A plugin is copied into JamCLI's
data directory, hashed (every file's path and contents), and recorded in the lockfile for
its scope (the project's `.jamcli/plugins.lock.json`, or the user's). Consent lives in
the state directory, keyed by scope, project, and name, and covers the hash, the
permissions, and the directory.

- A plugin with a symbolic link is refused, so the hash cannot point outside the plugin.
- A copy outside JamCLI's plugin directory, or without a consent record, does not load:
  a lockfile committed to a repository proves nothing on its own.
- At every session start the installed copies are hashed again; one that changed is
  turned off with a notice until installed again.
- Updating keeps consent when the new version asks for nothing more, and asks again when
  it widens.

`/plugins` lists the installed plugins and their state; installing, updating, and
removing stay on the command line, which carries the same consent text.

## What runs where

Each plugin's hooks and MCP servers run through a sandbox: the network only when a host
is declared, the project writable only when `filesystem` is `project`, and the session's
environment plus the variables it named, and nothing else. Where no sandbox can start,
the plugin's parts still run and JamCLI says so: `Plugin <name> runs without a sandbox
here (<reason>), so it can reach more than it declared.`

Per-host network filtering is a known limit: a declared host turns the sandbox's network
on as a whole.
