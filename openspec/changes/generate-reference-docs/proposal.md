# Change: Reference pages built from the code, and proofs the build runs

## Why

The docs site can only drift from the product one way today without the build noticing: a
page can describe behaviour that has changed while every file and symbol it cites still
exists. `site/scripts/check-receipts.ts` catches a renamed or deleted symbol and nothing
more. The lists a reader looks things up in (the slash commands, the tools, the settings, the
keys, the CLI's options) are the pages most likely to fall behind, and every one of them is
already defined once in the code, where the product itself reads it.

The owner approved this change on 2026-09-27, while `add-session-reflection` waits at its
task 6.2, as an exception to the working rule, as `add-surface-parity` was.

## What Changes

- **Reference pages generated at build time.** `site/` gains a `reference/` section with one
  page each for the built-in slash commands, the built-in tools, the settings, the interface
  keys, and the CLI's usage. Each table is rendered from the definition the product uses:
  `BUILTIN_COMMANDS`, `BUILTIN_TOOLS`, `settingsFromSchema()`, `DEFAULT_KEYS` with
  `ACTION_WORDS`, and `USAGE`. The data is written by a script at the start of every build
  and dev run and is never committed, so there is no copy to fall behind.
- **The build refuses an undescribed entry.** A command without a summary, a visible tool
  without a description, or a setting without a description fails the site build, naming it.
  What the product shows a person and what the site shows a reader are the same text.
- **Proofs run at build time.** Every `<Proof run>` on a page is run from the repository root
  during the site build, and a failing one fails the build. A proof only a reader can run (it
  needs their configuration, the network, or a file a guide has them create) is marked
  `reader`, and its label says so, so a reader can tell a checked proof from an unchecked one.
- **The tool registry no longer depends on import order.** Importing `BUILTIN_TOOLS` before
  the registry module crashes today, because the default registry is filled while its own
  import cycle is still resolving. It is filled on first use instead. The product behaves the
  same; the definitions can be read on their own, which the generator needs.

Not in this change:

- Tools a session adds from its surroundings (`skill`, `search_tools`, `lsp`, `web_search`,
  MCP tools) are built from live dependencies. The tools page lists the fixed built-in set
  and says that these are offered by the session; their concept pages stay hand-written.
- The CLI's subcommands are named in three places (`USAGE`, `parseArgs`, and the entry
  point's `HEADLESS_INTENTS`). The page renders `USAGE`, which is what `jamcli --help` prints;
  making the three one definition is left for a later change.
- Concept pages and guides stay hand-written, under `site/NOTE.md`.

## Capabilities

### New Capabilities

None. The docs site and its build are project tooling, not behaviour of JamCLI.

### Modified Capabilities

None. `skip_specs: true`.

## Impact

- `src/core/tools/registry.ts`: the default registry is created lazily.
- `site/scripts/`: `reference.ts` (new), `check-proofs.ts` (new); `package.json` scripts run
  them before `astro build` and `astro dev`.
- `site/src/content/docs/reference/` (new pages), `site/src/components/` (a table component,
  and `Proof.astro` gains `reader`), `site/src/content/docs/index.mdx` (cards).
- `site/AGENTS.md`: how reference pages and proofs work now.
- `.gitignore`: the generated data file.
- The site build now needs the repository's dependencies installed (`bun install` at the
  root), since it imports the product's definitions and runs its tests.
