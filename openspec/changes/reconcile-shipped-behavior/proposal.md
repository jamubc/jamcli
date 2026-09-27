# Change: The spec says what ships

## Why

After `add-agents` closed, owner-directed work kept landing on `feat/agentic-harness-core`
without an openspec change of its own: live model facts from models.dev, a `/model` that
saves its choice, a trust gate scoped to auto mode with a classifier the user names, a
permission prompt that can deny and still let the turn go on, keys kept out of project
files, and a transcript whose thinking, tool blocks, notes, and selection were redesigned.
`openspec/specs/jamcli/spec.md` is current truth only while it describes what ships, and
in eight requirements it no longer did. This change records that behavior. It adds no
code.

## What Changes

- **Terminal User Interface**: thinking in a window of fixed size that folds to one line;
  tool blocks that open on a click, and an expanded view of everything; a permission
  prompt that leaves the transcript in view; `/note`; selecting and clicking.
- **Model Discovery**: `/model` switches the session and saves `model` in the user
  configuration, not in the active profile.
- **Approval-Gated State Changes**: a denial can let the turn go on without feedback.
- **UI Style Configuration**: a style may name a theme role in place of a color, and a
  style name an earlier version saved still resolves.
- **Tool Output Trust Gate**: it screens only in auto mode, on the classifier `trust.model`
  names on any provider, TypeSafe's Jev included; nothing is chosen for the user.
- **Model Catalog**: the models.dev directory sits between provider metadata and the
  bundled table, and an Ollama model never consults it.
- **Credential Storage**: `jamcli config set` never writes a key into a project file, and a
  key already in one draws a notice every session.
- **Keybindings and Themes**: each theme has its own selection and chosen-row colors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `jamcli`: the eight requirements above, each restated whole in
  `specs/jamcli/spec.md`.

## Impact

The spec only. The behavior shipped in these commits, which name the code:

- Terminal User Interface: `b33e688` (select and click), `755204f` (the wheel in lists),
  `0936bd7` (the thinking window), `6d030e9` (the expanded view), `da128fc` (the
  transcript behind a prompt), `e7b3cff` (`/note`), `eedfc70` (the chosen row).
- Model Discovery: `255a24b`.
- Approval-Gated State Changes: `45383ab`, `10ab887`.
- UI Style Configuration: `44ba472`.
- Tool Output Trust Gate: `7944219`, `f7b1839`, `a102608`, and the page `88b34f1`.
- Model Catalog: `828cb60`.
- Credential Storage: `5de175e`.
- Keybindings and Themes: `eedfc70`.
