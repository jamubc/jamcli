# Stage 21: Break on purpose (reminder, not a task list)

This stage cannot be fully defined here because break-on-purpose testing only exists after code is built. No code is built in this plan. This file is a reminder to run it later.

## What it is
After each module in `00-plan.md` lands its code and tests, prove the tests notice breakage on purpose with `bun scripts/probe.ts probes.json` per `openspec/DEFERRED.md` How to run a probe. A probe is caught when tests fail or hang. A survivor needs a new test or a written equivalent-mutant reason.

## When to run it
- After Phase 1 modules: run their probe JSON before marking the checkpoint green.
- After Phase 2 and 3 modules: same, per module.
- After 17 unfinished features: re-run `14-probes-repeat-crosscutting.md` for the new callers.
- At 19 archive: confirm every gap marked in DEFERRED is either caught or has a written reason. Unproven tests stay marked unproven.

## Acceptance for Stage 21
- [ ] Every module checkpoint includes its probe run output (caught list).
- [ ] Every survivor has a new test or a written equivalent-mutant reason stored with the module.
- [ ] Archive does not claim proven tests until their probes ran.

## Dependencies
None. Runs after the code it probes. Do not block planning or implementation on this file.

## Files likely touched
- `scripts/probe.ts`
- Per-module `probes.json` files created at implementation time
