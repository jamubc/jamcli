## 1. Commands leave the interface (refactor: no behavior change)

- [x] 1.1 `src/commands/types.ts`: the command, its context, choice requests and items, the session choice, command sources. `src/commands/parse.ts`: parsing, word splitting, matching, lookup. The overlay's `PickItem` and `PickRequest` become the choice types, which the picker imports.
- [x] 1.2 Move every built-in command, with the reports, settings, theme names, and style helpers it uses, into `src/commands/builtin/`. Replace `dispatch` with `show(text, diff)`, `event`, `working`, `note`, and `clearNotes`; the key help reads `keyFor`.
- [x] 1.3 Custom commands and MCP prompts as commands move to `src/commands/custom.ts`.
- [x] 1.4 The interface builds the context, including repainting, the clipboard, notes, and leaving. `src/tui/` no longer imports `src/cli/` for commands.
- [x] 1.5 Four gates; the interface tests pass unchanged in what they assert.

## 2. The host for surfaces without a terminal

- [ ] 2.1 `CommandHost`: the context without a terminal, output as entries, one pending choice, `/choose`, answers given in advance, session opening through an optional opener, bypass refused, notes kept, the system clipboard, exit ending the session.
- [ ] 2.2 Host tests.

## 3. Headless and ACP

- [ ] 3.1 Headless: a prompt naming a built-in command runs it through the host; `--choose` answers its choices in order; text, json, and stream-json carry its output.
- [ ] 3.2 ACP: offer every built-in command; a prompt naming one runs it through the host, with output as message chunks, compaction events mapped, and `/choose` for choices.
- [ ] 3.3 Tests on the assembled surfaces with the fake provider.
- [ ] 3.4 `src/commands/__tests__/parity.test.ts`.

## 4. The driver

- [ ] 4.1 An approval says when its tool always asks; the view keeps it. A choice can be marked as the person's; the hooks trust question is.
- [ ] 4.2 `App` takes an inspector and hands it its state after each render.
- [ ] 4.3 `src/cli/drive.ts`: the server (offscreen interface, private socket, requests, settling, the person's answers) and the client verbs `start`, `send`, `type`, `keys`, `screen`, `state`, `wait`, `stop`, `list`; wired into the dispatcher and usage.
- [ ] 4.4 Driver tests on a fake provider.

## 5. Docs and process

- [ ] 5.1 `docs/driving.md`; `docs/headless.md`, `docs/protocols.md`, `docs/commands-and-skills.md`, and `docs/architecture.md` updated.
- [ ] 5.2 `AGENTS.md`: `src/commands/` in the layout, and how an agent tests JamCLI by driving it. `openspec/config.yaml` layout carries the same.
- [ ] 5.3 A driving skill beside `jamcli-trials`, tracked.

## 6. Proof and close

- [ ] 6.1 Drive the built interface on a real model through a scripted session: a prompt with an edit and its approval, `/diff`, `/compact`, `/resume`; record what it found and fix what is JamCLI's.
- [ ] 6.2 Four gates, `openspec validate --strict`, then archive.
