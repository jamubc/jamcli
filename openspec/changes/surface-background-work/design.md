# Design

## Context

See proposal.md for why. What exists: `run_command` with `background: true` starts a
process and keeps it in a module-global map in `src/core/tools/command.ts`; `task` with
`background: true` keeps a child in a module-global map in `src/core/tools/task.ts`; a
foreground child is not tracked anywhere. The runtime reaches its surface only through
the `emit` of a running turn (`emitting` in `src/core/runtime/index.ts`), so nothing can
be reported between turns today. `executeBatch` in `src/core/tools/dispatch.ts` runs
read-only calls together and everything else one at a time, so consecutive `task` calls
are serial. The transcript and the view reducer know nothing about jobs.

## Goals / Non-Goals

**Goals:**
- One owner for everything that runs beside the turn, per runtime.
- Ends reach the model through the messages it already reads, with no new event the
  model must poll and no turn started on the model's behalf.
- The person sees and stops work from any surface, and the interface counts it.
- A fan-out of foreground tasks in one step runs concurrently.

**Non-Goals:**
- Persisting jobs across restarts, or reattaching to a job after the session closes.
- A wake-up turn when a job ends. A finished job is news for the next turn.
- Per-job permission rules. The command's own rule decides the call.
- The interface's working strip inside the plan board; that belongs to the interface unit.

## Decisions

**One work table, owned by the runtime, passed through the tool context.**
`src/core/work.ts` exports `WorkTable`: entries `{ id, kind: 'job' | 'task', label,
startedAt, endedAt?, outcome?, stop() }`, with `add`, `end`, `list`, `running(kind)`,
`stopAll`, `watch(listener)`, and `drainEnded()` which returns the entries that ended since
it was last called and marks them told. `createRuntime` makes one and puts it on
`ToolContext.work`; a child runtime shares its parent's table so a child's job is the
person's to see and stop too. Alternative considered: keep the two maps and add a
listener to each. Rejected: two owners for one fact, and the MCP server would still share
jobs across sessions.

**`run_command` and `task` register in the table.** `startBackgroundCommand` takes the
table and adds an entry whose `stop` is `stopProcess`; the job's own record (child, output
buffer) stays with the tool. `command_output` and `command_kill` look jobs up through the
table's entry, which carries the tool's record, so a job id is valid only in the session
that made it. `taskRunner` adds an entry for a foreground child before delegating and ends
it after; `startBackground` does the same for a background child and drops its own map,
keeping the task record on the entry. `canDelegate` counts `table.running('task')`.

**News reaches the model through the agent's own messages.** `AgentOptions.news?: () =>
string[]` is called by `turn()` twice: after the prompt is recorded, where a non-empty
list is appended to the prompt as `[Work ended while you were away: ...]`, in the place
the `user_prompt_submit` hook's context already goes; and after each batch's results are
recorded, where the list is appended to the last result's output, as a `post_tool` hook's
context is. The runtime supplies `news` from `table.drainEnded()`, one line per entry:
`job_ab12 (npm start) exited with code 1 after 42s; read it with command_output`. A
background task's line names `task_result`. Only the top-level runtime supplies `news`: a
child shares the table, and if it drained the news it would take it from the session the
person talks to. A foreground child is added as already told, since its result comes back
in the call that started it. Alternative considered: emit an event and
have the surface inject a message. Rejected: the model's conversation is the agent's to
write, and a surface-injected message would differ per surface.

**Work reaches the person through a runtime listener, not an agent event.** `Runtime`
gains `work(): WorkItem[]`, `watchWork(listener): () => void`, and `stopWork(id)`. The
interface controller subscribes at start and dispatches `{ type: 'work', items }`, so the
status line updates between turns. Headless and ACP need no listener: `/jobs` reads
`work()`. Alternative considered: a `job` agent event. Rejected: agent events exist only
while a turn runs, and a job that dies between turns would be invisible until the next one.

**Consecutive delegate calls run together.** In `executeBatch`, when the current call's
class is `delegate`, the loop takes the run of consecutive `delegate` calls, decides each
in order as today (deny settles it, ask waits for the person, a person's denial stops the
step as today), then performs every allowed one with `Promise.all` and settles each in
call order. `beforeChange` is called once before the group as for a single call. The
per-turn cap counts each. Alternative considered: tell the model to use `background:
true` for parallelism. Rejected: the guidance already says "call task once per piece in
the same step so they run together", and that promise should be true.

**Guidance and the approval line.** `prompt.ts` adds one line when `run_command` is
offered. `describeCall` appends `· background` to a background command's summary, so the
prompt heading and the transcript line both say it.

**`/jobs` on every surface.** A built-in command in `src/commands/builtin/index.ts`:
bare, it shows a table of `work()`; `stop <id>` calls `stopWork`. It needs no turn to be
idle, since stopping is the person's and the table is not the turn's.

## Risks / Trade-offs

- [A job that ends during a step is told to the model on that step's last tool result,
  which may be about something else] → the line is prefixed and self-contained, and the
  same shape reaches the model on a prompt, so it reads the same either way.
- [A child runtime sharing the parent's table lets a child's job outlive the child's turn]
  → that is the point: the person sees and stops it; the child's close does not stop
  the table, only the top-level runtime's close does.
- [Concurrent foreground tasks each ask the parent's surface] → they are decided before
  any runs, one prompt at a time, as the Delegated Approvals requirement already says.
- [The status line grows] → the count is a droppable part, given up before the mode
  and the phase, as the fit already orders parts.
