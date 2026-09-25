# Security

JamCLI is local-first: nothing is sent anywhere except the model provider the person
configured, and telemetry is off.

## Permissions

Every tool call is decided before it runs, deny first:

- A deny rule always wins; an allow rule must match; a mode decides what is left. Modes
  are `plan`, `default`, `accept-edits`, `auto`, and `bypass`, and a rule may be scoped
  to the session, the project, the project-local file, or the user.
- A rule's subject is the thing it reaches: a path for file tools, a command for
  `run_command`, a domain for `web_fetch`. `jamcli audit` reports tool access, isolation,
  and guardrail findings, and `/permissions` shows and changes the rules in effect.
- A workflow's agent step may lower its mode, never raise it above the session's.

## Isolation

- Commands, MCP servers, hooks, language servers, and plugins run through a sandbox:
  bubblewrap on Linux, Seatbelt on macOS, with the project writable and the rest read
  only. Network is off unless a setting or a plugin's declared host turns it on.
- A subprocess gets the session's environment with credential-looking names removed
  (`subprocessEnv`), plus any names a setting declares. A provider key reaches no
  subprocess unless its entry names it.
- In the Seatbelt profile credentials are hidden after reads are allowed, since the last
  matching rule wins.

## Secrets and redaction

- Provider keys live in the operating system's keychain, or an environment variable named
  with `key_env_var`; they do not belong in project files. `jamcli auth list` shows what
  is stored without printing a value.
- Tool output, referenced file content, MCP resource text, ACP updates, language server
  diagnostics, and session logs pass through the redactor, which replaces a credential's
  value with `[redacted:NAME]`.

## Extensions

- A project's hooks do not run until trusted as they are now; trust is recorded against a
  digest and lapses when they change. A plugin's hooks are consented to at install and
  run in the plugin's sandbox.
- Plugins are installed only after showing what they add and may reach; their copy is
  hashed by path and contents, symbolic links are refused, and a changed copy is turned
  off at the next session start. A lockfile committed to a repository proves nothing: the
  copy must be JamCLI's own and consented to on this machine.
- A project's `.jamcli/mcp.json` servers are not yet gated on trust (a known gap).

## Protocols

- `web_fetch` fetches only http and https, caps a response at 5 MB, times out, and does
  not follow a redirect to another host: the model is told where it points and fetches it
  as a new call, which the rules judge for that host.
- The ACP client offers an external agent no file system or terminal capabilities, and
  the agent gets the session's minimal environment.
- The observer socket is 0600 from creation and refuses a path in a directory others can
  write; it cannot prompt or open sessions.

## Known limits

- Plugin network access is not per host: a declared host turns the sandbox's network on
  as a whole.
- On macOS the hostile-plugin write test shows a plugin hook can still write outside the
  plugin and the project under Seatbelt; network, secrets, and the environment are
  confined. The Seatbelt escape suite is owed (3.7).
- An installed git hook runs whatever the workflow file says at the time; recording the
  file's digest at install and refusing a changed one is owed.
