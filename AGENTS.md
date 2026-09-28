# JamCLI

A terminal-native AI coding agent. Local-first, provider-agnostic, human-in-the-loop.
Personal project under `jamubc/jamcli`. Not a Jam-Sw product.

Read `openspec/project.md` first. It carries the product thesis, the tech stack, the
conventions, and the constraints. `openspec/SEQUENCE.md` carries the working rule and
the definition of done. Everything else under `openspec/` is the spec and the work.

## How work happens here

**One unit in flight.** A unit lives on its branch until it is complete: not merged, not
set aside to start something else. Stages and slices inside it are committed as
checkpoints that must each install, typecheck, test, and build, so the unit can be
abandoned safely at any checkpoint. It is finished only when its change is archived.
`openspec/SEQUENCE.md` names the open unit and says when it is done.

The path is: read the open change in `openspec/changes/`, work its `tasks.md` in order,
run the four gates, then archive. OpenSpec drives that path through skills rather than a
checked-in instruction file: `/opsx:propose` opens a change, `/opsx:apply` works it,
`/opsx:archive` closes it. `openspec/config.yaml` carries the hard rules below into every
one of those requests, so they reach planning without a file anyone has to remember to open.

**Executing `tasks.md`.** When a change's tasks are independent, the
`subagent-driven-development` skill runs them: a fresh implementer per task, a spec and
quality review after each, a whole-branch review at the end. Its ledger lives under
`.superpowers/sdd/`, which is gitignored scratch. Tightly coupled tasks stay inline. Either
way the four gates hold at every checkpoint.

## Testing JamCLI by using it

To find out whether JamCLI works, use it, the way a person would: through JamCLI's own MCP
server, `jamcli mcp serve` (see `docs/protocols.md`). `terminal_*` runs the interface
itself; `session_*` delegates a turn or any `/command`. Do not build a harness of your own
or reach into the source: the program on the other end must be the one a person runs, or
the bugs it hides go unfound.

- Run the JamCLI under test in a throwaway fixture project, never this checkout, and give
  it its own `JAMCLI_STATE_DIR` and a copied `JAMCLI_CONFIG_DIR`, so its sessions stay out
  of this repository's history and nothing it saves reaches the owner's configuration.
- Rebuild or restart the server after changing JamCLI; a running server keeps the code it
  started with.
- What only the person answers stays theirs: a commit, a lesson from `/reflect`, bypass,
  trusting a project's hooks. The server asks them; never answer for them.
- A defect found this way is fixed with a test that fails without the fix, and the
  terminal's recording is the evidence.

## Hard rules

- **No em dashes** (U+2014) in anything authored here: commits, specs, docs, comments,
  release notes. Use a colon, a comma, or a full stop.
- **No AI attribution.** Commits and documents carry the owner's identity only. No
  `Co-Authored-By` trailers, no "generated with" lines.
- **Conventional commits**, lowercase and imperative, scoped when it helps.
- **One concern per commit.** A dependency bump is its own commit. A refactor and a
  behavior change do not share one.
- **Secrets never enter the repository.** `.jamcli/` is gitignored. Provider keys are
  read from the environment through `key_env_var` wherever the provider allows it.
- **The local-first path must keep working.** If Ollama with no network is broken, the
  change is not done, regardless of what else it does.
- **Learning only as reviewable files, on demand, behind the gates.** JamCLI may improve
  itself only by proposing edits to skills, rules, or agents that the user approves, when
  the user asks, and only after the citation and novelty gates of `add-session-reflection`.
  No background learning, no hidden memory, no user profile. The earlier unguarded attempt
  and its numbers are in `openspec/SEQUENCE.md`.

## Four gates, every change

```bash
bun install
npx tsc --noEmit
bun test
bun run build
```

`npx tsc --noEmit` may not exceed the baseline recorded in the open change's PR
description. `bun test` must pass, and the tests must be capable of failing.

## Where things live

- `src/core/` is the harness: the agent loop, tools, providers, routing, context,
  policy, hooks, sessions, rules. It imports neither OpenTUI nor React.
- `src/commands/` is every built-in command, defined once, and the host that runs them
  where there is no screen. Every surface runs the same set. It imports neither OpenTUI
  nor React, and `src/core/` does not import it.
- `src/tui/` is the OpenTUI interface, and it only renders and forwards input.
- `src/cli/` is the dispatcher and the non-interactive surfaces.
- `src/services/` holds the pre-core services that have not moved yet.
- `openspec/specs/jamcli/spec.md` is current truth. `openspec/changes/` is what should
  change. Do not edit the spec while a change is open; the spec updates at archive time.

## Current state

`openspec/SEQUENCE.md` names the open unit, what closed before it, and what closing each
found and left open. `openspec/ROADMAP.md` names the units after it. Read those rather
than trusting a copy here, and update them, not this file, when a unit opens or closes.
