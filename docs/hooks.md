# Hooks

A hook is a command JamCLI runs at a point in a session's life. Hooks come from the user
configuration, the project's, the project-local file, the environment layer, and
plugins.

## Events

| Event | When | What it can do |
|---|---|---|
| `session_start` | A session opens | Add context to the system prompt |
| `user_prompt_submit` | A prompt is sent | Add context, or block the prompt |
| `pre_tool` | Before a tool call runs | Allow, deny, or ask; rewrite the input |
| `post_tool` | After a tool call runs | Add context, or block the result |
| `stop` | The model wants to stop | Ask it to keep going, or block the stop |
| `pre_compact` | Before compaction | Add focus or context |
| `notification` | A notice is shown | Observe |
| `session_end` | A session closes | Observe |

A `pre_tool` and `post_tool` hook may carry a `matcher`, which is judged exactly like a
permission rule: `edit(src/**)`, `run_command(npm test *)`, `web_fetch(domain:docs.python.org)`.

## The protocol

The hook's command is run through the shell with the event's payload as one JSON line on
stdin. What it writes on stdout decides:

- Plain text is context the model reads (for the events that take context).
- A JSON object may carry `decision` (`allow`, `deny`, `ask`), `reason`,
  `additional_context`, and, for `pre_tool`, `updated_input` to rewrite the call.
- Exiting 2 blocks, with stderr as the reason. Any other non-zero exit is a failure,
  which is reported as a warning and does not change the outcome.

`timeout_ms` bounds a hook (default 5,000 ms); a hook that overruns is killed and counted
as failed. Hooks run with the session's minimal environment and, when a sandbox is
active, inside it.

## Configuration

```json
{
  "hooks": {
    "pre_tool": [
      { "matcher": "run_command(rm *)", "command": "echo 'rm is not allowed here' >&2; exit 2" }
    ],
    "user_prompt_submit": [
      { "command": "node .jamcli/hooks/standup.js" }
    ]
  }
}
```

A project's or the project-local file's hooks do not run until the person trusts them as
they are now: `jamcli hooks trust`, `/hooks trust`, or the question the interface asks on
first start. Trust is recorded in the state directory against a digest of the hooks, so
editing them asks again. A plugin's hooks are consented to at install and run in the
plugin's sandbox.
