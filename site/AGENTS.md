# The JamCLI docs site

Read `NOTE.md` first. A new article needs the owner's approval and involvement, and the
repository's `AGENTS.md` hard rules apply here too: no em dashes, no AI attribution,
conventional commits, one concern per commit.

## Who reads this site

A person who runs JamCLI, or who wires another agent to it. Not a contributor: working notes
and engineering prose live in `docs/` and `openspec/` at the repository root, and are not
pasted here. Write to what the reader can see and do, and explain the inside only as far as it
explains that.

## The house style

Every page follows one shape, and `bun run build` enforces the parts that can be enforced:

- **Frontmatter** carries a `title` and a substantive `description`. The description is what
  search and `llms.txt` show, so it says what the page answers, not just its topic. A page in a
  folder with an order sets `sidebar.order`.
- **An "In short" `Aside`** opens the page: the whole answer in a few sentences, for a reader who
  stops there.
- **Claim, then source.** Each claim about behaviour is followed by `Source:` and one or more
  `<Receipt path="src/..." symbol="..." />`. Find the exact exported symbol with a search before
  citing it: a guessed one fails the build. Leave line numbers out.
- **Proofs close the page.** `<Proof run="...">` gives a command run from the repository root and
  what it shows. Run every one before committing, and quote real output, never expected output.
- **Plain, exact prose.** Say what happens, in the order it happens. Tables for anything with
  more than two attributes per row. No marketing, no filler, no claims the code does not make.

## What goes where

- `concepts/`: how something works and why. One topic per page.
- `tools/`: one page per built-in tool family: inputs, limits, configuration, permissions.
- `guides/`: a task from start to finish, with `Steps` where order matters.
- `index.mdx`: a card per page, and one sentence naming what the site covers. Add both when a
  page is added.

## Keeping a page true

- Say only what you have seen: in the code, in a test, or in a run. If a behaviour was not
  observed, leave it out rather than describe what it probably does.
- Be honest about limits. Where something is held by rule and not by a check, say so, as
  `concepts/surfaces.mdx` does for the answers a terminal shows only as text.
- Do not describe an open openspec change beyond what has shipped. When a change closes, check
  the pages it touches.
- A correction to an existing page is its own commit, apart from new pages.

## Diagrams

Inline SVG in `src/components/diagrams/`, drawn in `currentColor`, with a `title` and a `desc`
that say in words what the picture shows. Add one only when it shows a mechanism the prose
cannot, and keep it cheap.

## Before committing

```bash
cd site
bun install
bun run build    # runs the receipt check first
```

Then grep the changed pages for U+2014 and run each page's proofs from the repository root. The
site is its own project: the root gates do not cover it.
