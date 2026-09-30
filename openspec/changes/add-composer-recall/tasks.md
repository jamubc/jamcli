# Tasks

Each group is one or two commits (one concern each: conventional, lowercase, imperative, no
em dashes, no attribution) and leaves `bun install`, `npx tsc --noEmit`, `bun test`, and
`bun run build` green. The owner edits this checkout concurrently: stage only owned hunks,
never stash or reset. Trials use `jamcli mcp serve` `terminal_*` in a throwaway fixture with its
own `JAMCLI_STATE_DIR` and a copied `JAMCLI_CONFIG_DIR`, model `opencode-go:deepseek-v4.1-flash`
only, never Ollama.

## 1. Open the unit

- [x] 1.1 Record the `npx tsc --noEmit` error count and the `bun test` totals on this branch's first commit message body or the PR description as the baseline, and verify a second run reports the same counts
- [x] 1.2 Name `add-composer-recall` as the open unit in `openspec/SEQUENCE.md` and add it to `openspec/ROADMAP.md` under the interface units; verify `openspec validate add-composer-recall --strict` passes and `git diff` shows only those two files plus the change

## 2. Typing survives a click

- [x] 2.1 Add a test in `src/tui/app/__tests__/mouse.test.tsx` that clicks and drags in the transcript, then types with `mockInput.typeText`, and asserts the text is in the composer; verify it fails on the current code
- [x] 2.2 Add a test that a click on a tool block still shows or hides it; verify it passes before the fix and stays passing
- [x] 2.3 Call `preventDefault` on the transcript's mouse-down in `src/tui/app/App.tsx`; verify 2.1 passes, 2.2 still passes, and drag selection and copy tests in `mouse.test.tsx` pass. If 2.2 breaks, refocus the composer from `endDrag` instead and verify the same three
- [x] 2.4 Update the keys and composer notes in `docs/interface.md` (typing after a click needs no click back); verify `grep -n "click" docs/interface.md` shows no line saying a click is needed to type

## 3. Record what was typed

- [x] 3.1 Write failing tests in `src/core/transcript/__tests__` for a `prompt` event: recorded with `sent` and `cleared`, written once for a repeat, ignored by `projectMessages`, kept across a compaction event and a reopen, loaded from a log that has none; verify they fail for the missing event
- [x] 3.2 Add the `prompt` event to `src/core/transcript/events.ts`, `recordPrompt` to `src/core/transcript/recorder.ts`, and `prompt` and `prompts` to `src/core/runtime/index.ts` beside `note`; verify 3.1 passes and `npx tsc --noEmit` is at baseline
- [x] 3.3 Tally prompts in the debug Markdown of `src/core/transcript/markdown.ts` as it tallies notes, with a test on its output; verify the test passes
- [x] 3.4 Record a prompt from every send path in `src/tui/app/App.tsx` `submit` (message, `!cmd`, `#note`, `/command`, queued message), with tests in `src/tui/app/__tests__/composer.test.tsx` that send each and read `runtime.prompts()`; verify each recorded text is the text as typed, with an `@` reference unexpanded
- [x] 3.5 Make `earlierMessages` in `src/tui/app/history.ts` read prompt events and fall back to messages for a session with none, with a test using both kinds; verify Ctrl+R lists a `/help` and a pre-compaction prompt and still lists an old session
- [x] 3.6 Add a headless and an ACP test that a log holding `prompt` events resumes and projects unchanged; verify both pass
- [x] 3.7 Document the event in `docs/sessions.md` under "What a session records"; verify the doc names the event, its two states, and that the model never sees it

## 4. Recall with Up and Down

- [x] 4.1 Write unit tests for `src/tui/app/recall.ts`: first Up stashes and loads the newest; Up walks older and stops at the oldest; Down walks newer; Down past the newest restores the stash with its chips; Escape restores; a send drops the stash; Up on a later line or a wrapped first line moves the cursor and does not recall; verify they fail for the missing module
- [x] 4.2 Implement `recall.ts`; verify 4.1 passes
- [x] 4.3 Wire it into `App.tsx`'s key handler ahead of the board keys, with the command and reference lists keeping Up and Down, and draw the one-row strip above the composer in styled and plain phrasing; add `composer.test.tsx` tests that press Up, Down, and Escape through `mockInput` and read the frame; verify a multi-line pasted prompt returns whole, and a draft typed before Up returns after Down
- [ ] 4.4 Add a test that a cleared draft is recalled (after group 5) and that recall works after `/compact` and after `switchSession` to a resumed session; verify both pass
- [x] 4.5 Update the key tables in `docs/interface.md` (rows for Up, Down, Ctrl+R) and `docs/ux.md`; verify the rows match the specs' wording and no row still says Up chooses an agent

## 5. Ctrl+C clears

- [ ] 5.1 Write tests in `src/tui/app/__tests__/composer.test.tsx`: exit key with a running turn stops it and keeps the draft; with a draft and no turn clears it and does not arm exit; with an empty composer arms exit and a second press within two seconds leaves; verify the clear case fails on the current code
- [ ] 5.2 Change the exit-key handler in `App.tsx` to that order and record a `cleared` prompt; verify 5.1 passes and the existing exit tests in `app.test.tsx` still pass
- [ ] 5.3 Update the Ctrl+C row in `docs/interface.md` and `docs/ux.md`; verify the rows say a draft is cleared first

## 6. Drafts survive leaving

- [ ] 6.1 Write tests for `src/core/transcript/draft.ts`: atomic write and read; remove on clear; adopt a draft whose pid is dead and take the file; leave a draft whose pid is alive; ignore a corrupt file; a `.draft` file is not listed as a session by `readSessionIndex` or `jamcli sessions list`; verify they fail for the missing module
- [ ] 6.2 Implement `draft.ts` with `saveDraft`, `readDraft`, `clearDraft`, and `adoptOrphanDraft`; verify 6.1 passes
- [ ] 6.3 Debounce a save from the composer's content change in `App.tsx`, remove it on send and clear, restore an adopted draft with a notice when a session opens with an empty composer, and add an exit flush called from `exit()` in `src/tui/app/start.tsx`; add tests in `composer.test.tsx` that type, wait past the debounce, and read the file, then open a second session and see the draft restored; verify both pass
- [ ] 6.4 Test the flush: send SIGHUP to a real `startOpenTui` child process in a fixture project with text typed, and verify the draft file holds that text and a restart restores it
- [ ] 6.5 Document drafts in `docs/sessions.md` and the secret-on-disk note in `docs/security.md`; verify each names the file, when it is removed, and that `.jamcli/` is gitignored

## 7. Paste chips, counter, and growth

- [ ] 7.1 Write tests with `mockInput.pasteBracketedText`: a paste under the threshold is inserted; ten lines and 1,000 characters each become a chip; sending expands it in the message, the recorded prompt, and the recalled entry; a paste at a chip expands it; an edited chip is sent as typed; the draft file restores chips; verify they fail on the current code
- [ ] 7.2 Implement the chip in `App.tsx` (or a small `src/tui/app/paste.ts` if the logic passes about 60 lines), with its expansion in `submit`; verify 7.1 passes
- [ ] 7.3 Write tests that the composer is one row when empty, grows a line at a time to eight rows, scrolls after that, returns to one on send, and that the counter shows past two lines in styled and plain phrasing; verify they fail for a fixed height
- [ ] 7.4 Replace the fixed height in `App.tsx` with `minHeight` and `maxHeight`, add the counter, and verify 7.3 passes and every snapshot in `src/tui/app/__tests__` still passes or changes only in the composer's height
- [ ] 7.5 Update `## The composer` in `docs/interface.md` for chips, growth, and the counter; verify it matches the specs

## 8. Board defects, then a thinner board

- [ ] 8.1 Write failing tests in `src/tui/app/__tests__/board.test.tsx` for each defect: with reduced motion an ended child past 90 seconds leaves the board and cannot be chosen; a choice held on a child that expired or was sent past is let go and Enter does not open it; the hint shows when only ended children are listed; panel and keys list the same children; verify all four fail
- [ ] 8.2 Fix them in `App.tsx`: one list from one clock shared by panel and keys, the clock ticking while any ended child is listed, the choice cleared when it leaves that list, the hint tied to the list; verify 8.1 passes
- [ ] 8.3 Write tests for the new keys: Down on an empty composer chooses the running child else the first; Up and Down move; Up on the first lets go; Enter opens; Escape lets go; a queued message comes back on Down before any choice; verify they fail on the current keys
- [ ] 8.4 Move the board keys to Down per those tests and update the header hint; verify 8.3 passes and the existing navigation tests in `board.test.tsx` and `queue.test.tsx` pass
- [ ] 8.5 Write tests that each agent is exactly one row, its label cuts before its facts at 60 and 100 columns, an asking agent keeps the warning color, the active step wraps to four rows, and plain mode keeps one line of words per agent; verify they fail on the three-row board
- [ ] 8.6 Redraw the board's agent rows and the active step as designed; verify 8.5 passes and the frame of a board with two running children fits in the rows the old one took for one
- [ ] 8.7 Update the board notes in `docs/interface.md` ("The plan board") for Down and the one-line rows; verify no line still says Up chooses an agent

## 9. Close the unit

- [ ] 9.1 Run the interface through `jamcli mcp serve` `terminal_*` in a throwaway fixture: click the transcript and type; type a draft, send SIGHUP to the terminal process, restart and see the draft restored; send three prompts including a multi-line paste, `/compact`, and Up three times; Ctrl+C a draft and Up brings it back; start two children and walk the board with Down, Up, Enter, and Escape; keep the recording as evidence and fix any defect with a failing test first
- [ ] 9.2 Run `bun install`, `npx tsc --noEmit` (not above the 1.1 baseline), `bun test` (passes, under its time budget), `bun run build`, and `openspec validate add-composer-recall --strict`; verify all pass
- [ ] 9.3 Archive with `/opsx:archive` so the deltas apply to `openspec/specs/jamcli/spec.md`, then close the unit in `openspec/SEQUENCE.md` and `openspec/ROADMAP.md`; verify the change sits under `openspec/changes/archive/` and `openspec validate --strict` passes
