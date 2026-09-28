# Tasks

## 1. The tool definitions load in any order (refactor)

- [x] 1.1 `src/core/tools/registry.ts` builds its default registry on first use rather than at module load. Verified by a test in `src/core/tools/__tests__/` that imports `builtins.ts` in a fresh `bun` process before anything else and reads `BUILTIN_TOOLS`, which fails on the current code with "Cannot access 'BUILTIN_TOOLS' before initialization", and by `bun test src/core` passing unchanged.

## 2. Reference data from the definitions

- [ ] 2.1 `site/scripts/reference.ts` writes `site/src/generated/reference.json` from `BUILTIN_COMMANDS`, `BUILTIN_TOOLS`, `settingsFromSchema()`, the interface keys, and `USAGE`; the file is gitignored. Verified by running it and reading the file.
- [ ] 2.2 It exits 1 naming every command with no summary, visible tool with no description, and setting with no description. Verified by running it against a definition with its text removed, which fails, and restored, which passes. Any entry it names today is given its text at the definition, one commit per area.
- [ ] 2.3 `site/package.json` runs it before `astro build` and `astro dev`. Verified by `bun run build` in `site/`.

## 3. The reference pages

- [ ] 3.1 `ReferenceTable.astro` renders a table from the data, and `site/src/content/docs/reference/` gains `commands`, `tools`, `settings`, `keys`, and `cli` pages, each in the house style: frontmatter, an "In short" aside, receipts to the definition, and a proof. Verified by `bun run build` and reading the built pages in `site/dist/`.
- [ ] 3.2 `index.mdx` gains a card per page, and the sidebar lists the section. Verified in the built index.
- [ ] 3.3 Taking a command out of `BUILTIN_COMMANDS` takes its row off the built commands page with no page edit. Verified once by hand and reverted.

## 4. Proofs the build runs

- [ ] 4.1 `site/scripts/check-proofs.ts` runs every `<Proof run>` not marked `reader` from the repository root, once per distinct command, and fails naming the page and the failing output. Verified by breaking one proof's command, which fails the check, and restoring it.
- [ ] 4.2 `Proof.astro` takes `reader` and labels checked and reader proofs differently; proofs a build cannot run (`jamcli doctor`, `bun test utcTime`) are marked `reader`. Verified by `bun run build` passing and both labels in `site/dist/`.
- [ ] 4.3 `site/package.json` runs the check in `build` after the receipt check. Verified by `bun run build`.

## 5. Record and close

- [ ] 5.1 `site/AGENTS.md` says reference pages are generated and their text is fixed at the definition, and that a proof is checked unless marked `reader`. `openspec/SEQUENCE.md` records this unit. Verified by reading them.
- [ ] 5.2 Four gates at the root, `bun run build` in `site/`, `openspec validate --strict`, then archive.
