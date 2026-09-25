# Probe results

Every module's probe file lives beside this one. Each was run with
`bun scripts/probe.ts openspec/DEFERRED_STAGES/probes/<file>` before its module's
checkpoint was marked green. "Caught" means the named tests failed with the code broken
on purpose. Run 2026-09-25 on macOS 27.0 arm64, Bun 1.4.2.

| File | Module | Result |
|---|---|---|
| `01-mcp.json` | 01 MCP prompts and resources | 25/25 caught |
| `02-shell.json` | 02 composer `!` shell | 11/11 caught |
| `03-tool-search.json` | 03 tool search | 9/9 caught |
| `04-acp.json` | 04 ACP on the SDK | 14/14 caught |
| `05-observer.json` | 05 ACP observer | 8/8 caught |
| `06-lsp.json` | 06 LSP | 12/12 caught |
| `07-plugins.json` | 07 plugins | 13/13 caught |
| `08-workflows.json` | 08 workflows | 16/16 caught |
| `09-micro.json` | 09 micro mode | 6/6 caught, plus the equivalent mutant below |
| `10-consent.json` | 10 plugin consent | 5/5 caught |
| `11-lsp-sandbox.json` | 11 language servers in the sandbox | 2/2 caught that can run here |
| `12-web-fetch.json` | 12 web_fetch | 8/8 caught |
| `13-lazy.json` | 13 lazy loading | 1/1 caught |
| `14-crosscutting.json` | 14 crosscutting repeat | 5/5 caught |
| `16-note.json` | 16 the `#` note | 2/2 caught |
| `17-unfinished.json` | 17 unfinished stages | 2/2 caught |
| `18-security.json` | 18 security fixes | 2/2 caught |
| `20-found-late.json` | 20 found-late fixes | 1/1 caught |

## Survivors and mutants that are not runnable

- **09, forced reducedMotion**: an equivalent mutant. In micro mode the full view is
  mounted but not visible, so its animation cannot reach the captured frame; the flag
  still stops the hidden animation work, which a frame test cannot see. Recorded in
  `09-probes-micro-mode.md`.
- **11, the wrap dropped**: not runnable on macOS. Seatbelt allows file reads by design,
  so the hidden-path read succeeds with or without the wrapper. The bwrap test exists and
  skips with that reason; a Linux CI run proves it.
- **07 and 12, the hostile sandbox probes**: the hostile plugin test fails on macOS
  before the fix (a plugin hook can write outside the plugin and the project under
  Seatbelt), so a probe run there would carry no signal. Recorded for module 18 and the
  Seatbelt escape work.

## Survivors that got a test

Each first survived, then got the test that catches it, and was re-run:

- `04j`: the SDK itself rejects a closed stdio; the fixture gained a mode where the agent
  exits while a grandchild keeps its stdout open.
- `05b`: the model path was flaky; the test now drives the hub's write path directly.
- `06i`: the outside-the-project test asserted only the status; it now asserts the
  refusal text.
- `08i`: the grammar test had no case where `and` and `or` differ; it now has one.
- `14a`: the first mutant used `permissions.mode: bypass`, which the engine refuses
  without confirmation; the probe now passes `bypassPermissions: true`.
- `16a`: the note test only covered Escape; it now covers choosing "Do not".
- `18b`: the first mutant used `mode: bypass` (inert); the test now uses `accept-edits`,
  a real escalation.
