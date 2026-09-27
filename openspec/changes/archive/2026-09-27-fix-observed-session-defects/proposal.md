# Change: Fix what one session's logs showed

## Why

The owner's most recent session in `monaco-code-editor` (`2026-09-27-5c20fef9`, on
OpenCode Go, in auto mode) delegated twice. Each time a subagent's command needed a
person's answer, and the prompt could not be answered: one waited 4 minutes, one 12,
and the owner stopped both turns. The same session showed the trust gate withholding
the model's own todo list as irrelevant and withholding results for being duplicates,
and the TypeScript language server dying under the sandbox. The global log recorded
almost none of it: no failure reasons, no prompts, no stopped turns.

## What Changes

- **Delegated Approvals** (added): a child's prompt is taken down once answered, so the
  next can be reached, and the call's result is shown where the prompt was. The cause
  was that only a session's own calls announced their answers; a child's never did, so
  its first prompt stayed on screen and every later one queued behind it.
- **Terminal User Interface**: a command in a permission prompt is shown whole, wrapped,
  and one too long for its space scrolls; long lines were cut to one row.
- **Tool Output Trust Gate**: the session's own state is not screened, and a duplicate
  takes its twin's verdict instead of being withheld. `trust.dedupe`, a setting nothing
  read, is honored.
- **Observability**: the default log names a failed call's reason, prompts left
  unanswered, and turns stopped after a long wait on a prompt.
- Not spec-visible: a language server in the sandbox is given no parent process to
  watch, since it cannot see JamCLI's and exited three seconds in, taking it for gone.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jamcli`: Terminal User Interface, Tool Output Trust Gate, and Observability restated;
  Delegated Approvals added.

## Impact

`src/core/tools/dispatch.ts`, `src/core/runtime/children.ts`, `src/tui/app/Prompt.tsx`,
`src/core/agent.ts`, `src/core/trust/index.ts`, `src/core/observe/session.ts`, and
`src/core/lsp/client.ts`, with a test for each defect that fails on the code before it.
The fixes are commits `fba0ded` to `7439f21`, each passing the four gates on its own.
