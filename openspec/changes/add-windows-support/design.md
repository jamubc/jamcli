## Context

`rehaul-jamcli` dropped Windows from its 2.0.0 gate and release on 2026-09-26 after its
first real CI run failed on nearly the whole suite there (see
`openspec/changes/archive/2026-09-26-rehaul-jamcli/tasks.md`, task 12.3, and
`openspec/SEQUENCE.md`'s closed-unit entry). This change picks that back up as its own
unit, kept separate from that work so a security-relevant, multi-subsystem addition does
not get built under a release-tagging deadline.

## Goals / Non-Goals

- Goals: a Windows binary whose sandbox, credential storage, and command cancellation
  claims are as true as the ones already made for Linux and macOS; `windows-latest`
  passing the same `bun test` suite the other two platforms pass; the release binary
  restored.
- Non-goals: parity with every macOS/Linux-only affordance that has no Windows analogue
  at all (for example, this does not attempt to replicate `sandbox-exec`'s exact profile
  language); WSL is not a target, this is native Windows.

## Decisions

- Decision: not yet made. **Open question**, first to resolve: what actually backs
  "Command Sandbox" on Windows. Candidates, roughly by increasing effort:
  - A Job Object with `JOB_OBJECT_LIMIT_*` flags for process/resource containment,
    combined with a restricted token, giving real filesystem and network limits.
  - AppContainer, which is what Windows itself uses to sandbox Store apps; more
    capability but a larger integration surface.
  - Ship with the documented "no sandbox available" fallback deliberately, on the
    reasoning that an honest disclosure beats a partial sandbox that is not load-bearing.
    If chosen, this is a real decision to record, not silence.
- Decision: not yet made. Credential storage: Windows Credential Manager, through either
  `cmdkey`/`vaultcmd` shelled out, or a native binding. Shelling out matches how the
  Keychain and Secret Service paths already work (`security`, `secret-tool`) and needs no
  new native dependency; that is the leading candidate.
- Decision: not yet made. Command cancellation: a Job Object assigned to the spawned
  process at creation, killed as a unit on timeout or cancellation. This is the standard
  replacement for "kill the process group" on Windows and is the leading candidate
  independent of what the sandbox decision above lands on.

## Risks / Trade-offs

- A Job Object-based sandbox is real but partial: it does not give the same filesystem
  read-only/writable split bubblewrap and Seatbelt do without significant extra work
  (a restricted token plus explicit ACLs). Shipping it as "sandboxed" without matching
  guarantees would be the same honesty problem this change exists to fix. Whatever ships
  must be named for what it actually restricts, in `jamcli doctor` and the sandbox
  requirement's own scenarios.
- Shelling out to `cmdkey` for credentials is simple but its exact behavior across
  Windows versions needs verification; a native DPAPI binding is more work but more
  reliable if `cmdkey` proves inconsistent.

## Migration Plan

None needed: Windows has never worked, so there is no existing Windows user or file to
migrate. The 2.0.0 release notes and `docs/migration.md` already say Windows is not yet
supported; this change is what makes that note obsolete.

## Open Questions

- Which sandbox primitive, per the Decisions section above: a real answer needs a spike
  against a Job Object and a restricted token before committing tasks to it.
- Whether a partial Windows sandbox should be `sandbox.enabled` by default once it exists,
  or opt-in until its restrictions are as trusted as bubblewrap's, matching how this
  project already treats a missing sandbox as a disclosed, not silent, fact.
