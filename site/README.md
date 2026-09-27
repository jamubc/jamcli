# JamCLI docs site

The published documentation, built with Astro Starlight. It is a separate project: its own
dependencies, its own build, not touched by the root gates. `docs/` at the repository root is
working notes and stays separate.

```bash
cd site
bun install
bun run dev      # local preview with reload
bun run build    # checks references, then builds to dist/
```

## Writing a page

Pages live in `src/content/docs/`, one topic per page. The sidebar groups follow the folders.
Every page needs a `description` in its frontmatter: it is the summary search and `llms.txt` show.

Two components carry the house style:

- `<Receipt path="src/..." symbol="name" />` says where a claim comes from and links to the
  code. `bun run check` fails when the path or the symbol no longer exists. Leave line numbers out.
- `<Proof run="...">what to expect</Proof>` is a command to run from the repository root, and
  what it should show.

Every `src/...` path a page mentions is checked too, except on a line that says "new file", for
examples that name a file the reader is about to create.

Diagrams are inline SVG in `src/components/diagrams/`, drawn in `currentColor` so they work in
both themes.
