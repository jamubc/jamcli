## 1. Commands leave the interface (refactor: no behavior change)

- [x] 1.1 `src/commands/types.ts`: the command, its context, choice requests and items, the session choice, command sources. `src/commands/parse.ts`: parsing, word splitting, matching, lookup. The overlay's `PickItem` and `PickRequest` become the choice types, which the picker imports.
- [x] 1.2 Move every built-in command, with the reports, settings, theme names, and style helpers it uses, into `src/commands/builtin/`. Replace `dispatch` with `show(text, diff)`, `event`, `working`, `note`, and `clearNotes`; the key help reads `keyFor`.
- [x] 1.3 Custom commands and MCP prompts as commands move to `src/commands/custom.ts`.
- [x] 1.4 The interface builds the context, including repainting, the clipboard, notes, and leaving. `src/tui/` no longer imports `src/cli/` for commands.
- [x] 1.5 Four gates; the interface tests pass unchanged in what they assert.

## 2. The host for surfaces without a terminal

- [x] 2.1 `CommandHost`: the context without a terminal, output as entries, one pending choice, `/choose`, answers given in advance, session opening through an optional opener, bypass refused, notes kept, the system clipboard, exit ending the session.
- [x] 2.2 Host tests.

## 3. Headless and ACP

- [x] 3.1 Headless: a prompt naming a built-in command runs it through the host; `--choose` answers its choices in order; text, json, and stream-json carry its output.
- [x] 3.2 ACP: offer every built-in command; a prompt naming one runs it through the host, with output as message chunks, compaction events mapped, and `/choose` for choices.
- [x] 3.3 Tests on the assembled surfaces with the fake provider.
- [x] 3.4 `src/commands/__tests__/parity.test.ts`.

## 4. Whose answer it is

- [x] 4.1 An approval request says when its tool always asks; the observer's `requires_action` update names the tool and says so.
- [x] 4.2 A choice request can be marked as the person's; the hooks trust question is; the host never answers it from answers given in advance.
- [x] 4.3 Tests for both.

## 5. Docs

- [x] 5.1 `docs/headless.md`, `docs/protocols.md`, `docs/commands-and-skills.md`, and `docs/architecture.md`.
- [x] 5.2 `AGENTS.md` and `openspec/config.yaml`: `src/commands/` in the layout.

## 6. Proof and close

- [ ] 6.1 On a real model, in a throwaway fixture project: headless `/context`, `/compact`, `/resume list`, `/commit` answered with `--choose`, and `/reflect`; over ACP, the same through a prompt, and a list answered with `/choose`; and the interface's own commands unchanged. Record what it found and fix what is JamCLI's.
- [ ] 6.2 Four gates, `openspec validate --strict`, then archive.
