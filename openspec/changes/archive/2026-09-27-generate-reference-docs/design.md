# Design

## Context

See proposal.md, Why. The site is its own Astro project under `site/`; its build already runs
a Bun script first (`check-receipts.ts`), so Bun scripts that read the repository are the
established way the site reaches the code. Every definition the reference pages need is
exported today: `BUILTIN_COMMANDS` (`src/commands/builtin/index.ts`), `BUILTIN_TOOLS`
(`src/core/tools/builtins.ts`), `settingsFromSchema()` (`src/commands/settings.ts`),
`KEY_ACTIONS`, `ACTION_WORDS` and `DEFAULT_KEYS` (`src/tui/app/keys.ts`), and `USAGE`
(`src/cli.ts`).

## Goals / Non-Goals

**Goals:**
- A reference table cannot say anything its definition does not say.
- A proof on a page is a check, not a claim, wherever the build can run it.

**Non-Goals:**
- Generating prose. The generator renders names, arguments, classes, defaults, and the
  descriptions the code already carries; it writes no sentences of its own.
- Checking a proof's printed output against the page's words. A proof passes when its
  command exits 0; the tests it runs are what hold the behaviour.

## Decisions

**Generate data, not pages.** `site/scripts/reference.ts` imports the definitions and writes
one JSON file, `site/src/generated/reference.json`, gitignored. Each reference page is an
ordinary `.mdx` page (frontmatter, an "In short" aside, receipts to the definition) that
renders its table through `ReferenceTable.astro` from that file. Alternatives: importing
`src/` from Astro directly would pull the runtime through Vite, which does not resolve Bun's
module semantics the same way; writing whole `.mdx` files from a script would put generated
prose where a reviewer expects written prose. Data plus a hand-written frame keeps the house
style and keeps the generated part to the table.

**Regenerate on every build and dev run, never commit.** `build` and `dev` run the script
first. A committed file would need its own staleness check; a file that is always rebuilt
has nothing to go stale.

**Missing descriptions fail the build.** The generator collects every command with an empty
summary, every visible tool with an empty description, and every setting with no
description, and exits 1 naming each. Hidden tools and aliases are listed as such and are not
required to carry text. This is the rule that makes the code the one place the text lives.

**Proofs are found by parsing the pages, as receipts are.** `check-proofs.ts` reads each
`<Proof run="...">` and `run={`...`}` from the `.mdx` sources, skips those with `reader`,
runs each once from the repository root with `sh -c`, and fails listing each failure with
its page and the command's last lines of output. Identical commands run once. It runs after
the receipt check and before `astro build`. A test run it does not want is kept out by the
page marking the proof `reader`, never by a list in the script, so the page is the one place
that says whether its proof is checked.

**`reader` is visible.** `Proof.astro` labels a checked proof "Proof · checked at every
build" and a `reader` proof "Proof · run it yourself", so the guarantee a reader relies on is
on the page.

**The default registry is built on first use.** `registry.ts` fills `defaultRegistry` at
module load by calling `registerBuiltinTools`, which reads `BUILTIN_TOOLS`. When a script
imports `builtins.ts` first, a tool module's import chain reaches `registry.ts` while
`BUILTIN_TOOLS` is still uninitialised, and the load throws. A `defaults()` accessor that
creates and fills the registry the first time any of the module functions is called removes
the order dependency. Alternative: have the generator import through `src/core/tools/index.ts`
to get the working order. That leaves the trap in place for the next reader of the
definitions.

## Risks / Trade-offs

- [The site build now runs tests and takes longer] → Proof commands are already scoped to a
  few test files each; identical commands run once. The build prints the time it spent.
- [The site build needs the root's dependencies] → Said in `site/AGENTS.md`; the check fails
  with the missing import named, not silently.
- [A flaky test fails a docs build] → That is a flaky test, and it fails `bun test` too; the
  fix is in the test, not in skipping the proof.
- [A setting's schema description is written for an editor tooltip, not a page] → The same
  words are what `/config` shows a person, so a poor one is a poor one in both places and is
  fixed at the schema.
