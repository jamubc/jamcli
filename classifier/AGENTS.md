# classifier

A learned, second approval mode, built beside the trust gate and never in place of it.
Read `HANDOFF.md` first, then `README.md` for the contract and `RESEARCH.md` for what the data supports.

## Rules

- **The trust gate is not touched.** `src/core/trust/` (Jev and the chat classifier) screens
  tool results. This folder decides nothing about them and imports nothing from it.
- **Nothing here is wired into `src/` until a gate has certified a model.** The only files
  outside this folder that mention it are `.gitignore` and the docs.
- **Personal data stays local.** `data/` and `models/` are gitignored. A dataset holds real
  commands, redacted but not anonymous. Never commit one, paste one, or attach one.
- **Offline and on demand.** No hook, watcher, or background job trains anything. A person
  runs a command, reads the result, and keeps or deletes the file.
- **A model can save a prompt and nothing else.** It may allow or abstain. It never denies,
  never overrides `floor.ts`, and never has more authority than its gate certified.
- **A change that widens what a model may allow needs a test that fails without it.**

## Gates

```bash
npx tsc -p classifier --noEmit
bun test classifier
```
