<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

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
run the four gates, then archive.

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
- **No memory, learning, or self-improvement features.** That experiment was run and
  decommissioned. See `openspec/SEQUENCE.md` for the numbers.

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
- `src/tui/` is the OpenTUI interface, and it only renders and forwards input.
- `src/cli/` is the dispatcher and the non-interactive surfaces.
- `src/services/` holds the pre-core services that have not moved yet.
- `openspec/specs/jamcli/spec.md` is current truth. `openspec/changes/` is what should
  change. Do not edit the spec while a change is open; the spec updates at archive time.

## Known state

The open unit is `rehaul-jamcli`. Its `audit.md` records the measured state of the tree
when it opened, including the defects the previous unit's tests did not catch. Its
`tasks.md` is the checklist, and the last checked task is where work stopped. The type
baseline for the unit was 22 errors; it reached 0 when Ink was removed (6.15), and stays 0.
