## 1. The terminal moves into the product (refactor, then behavior)

- [x] 1.1 `src/testing/terminal.ts` moves to `src/terminal/`, and the end-to-end tests import it from there.
- [x] 1.2 It launches JamCLI as the shipped build does, from the running executable and entry, or a compiled binary as itself; records asciinema v2; resizes; names keys.

## 2. The server and its sessions

- [x] 2.1 `jamcli mcp serve` starts an MCP server on stdio; usage and the dispatcher name it.
- [x] 2.2 `session_start`, `session_send`, `session_answer`, `session_state`, `session_stop` over the ACP session controller and its command host: output since last read, what the session waits on, waits bounded by `wait_ms`, progress notifications.
- [x] 2.3 The person's answer: always-ask approvals and person-only lists refused to the caller, elicited from the person, denied where the host cannot ask or the person does not accept.
- [x] 2.4 Tests through an SDK client on the fake provider.

## 3. The interface through a terminal

- [x] 3.1 `terminal_start`, `terminal_type`, `terminal_keys`, `terminal_screen`, `terminal_wait`, `terminal_resize`, `terminal_stop`, with the observer watched for settling and for the person's approvals.
- [x] 3.2 Tests on the fake provider.

## 4. Docs and process

- [ ] 4.1 `docs/protocols.md` and `README.md`: what `jamcli mcp serve` offers and how a host adds it.
- [ ] 4.2 `AGENTS.md`: an agent testing JamCLI uses JamCLI's own MCP server, drives it in a throwaway fixture project never this checkout, and leaves the person's answers to the person.

## 5. Proof and close

- [ ] 5.1 Through a real MCP client on a real model: delegate an edit with an approval, run commands, and use the interface through a terminal. Record what it found and fix what is JamCLI's.
- [ ] 5.2 Four gates, `openspec validate --strict`, then archive. 6.2 of `add-session-reflection` then runs through this server with the owner approving each lesson.
