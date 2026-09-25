## Task 1: Permission mapping gaps in server.ts

**Description:** Session-scoped allow and reject paths are untested.

**Acceptance criteria:**
- [ ] "allow always" grants for the session; second call does not ask again
- [ ] `reject-always` denies; comparing `kind` wrongly turns it red
- [ ] `requestPermission` failing (client error) denies safely; swallowing the error to allow turns it red

**Verification:**
- [ ] Tests pass: `bun test src/acp/__tests__/features.test.ts`
- [ ] Manual check: re-run caught probes (bypass offered, setMode refusal, replay order) still red when broken

**Dependencies:** None

**Files likely touched:**
- `src/acp/server.ts`
- `src/acp/session.ts`
- `src/acp/__tests__/features.test.ts`

**Estimated scope:** Medium: 3-5 files

## Task 2: Update ordering and content gaps

**Description:** Command ordering, full update flushing, long output, and apply_patch paths need tests.

**Acceptance criteria:**
- [ ] Test asserts `available_commands_update` arrives after `session/new` reply
- [ ] Test asserts every update precedes the prompt reply (`queue` awaited before `end_turn`)
- [ ] Long output is cut at `OUTPUT_LIMIT`
- [ ] `resource_link` blocks appear in `promptText`; `pathsOf` handles `apply_patch`

**Verification:**
- [ ] Tests pass: `bun test src/acp/__tests__/features.test.ts src/acp/__tests__/runtime.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/acp/server.ts`
- `src/acp/updates.ts`

**Estimated scope:** Medium: 3-5 files

## Task 3: Client capability and exit gaps

**Description:** The delegating client must prove it offers no FS and handles agent exit with minimal env.

**Acceptance criteria:**
- [ ] Fake agent records client capabilities in `_meta`; test asserts FS caps are empty
- [ ] Killing the fake agent mid-prompt fails the prompt cleanly; ignoring exit turns it red
- [ ] Re-run caught probe: `process.env` whole vs `subprocessEnv` still red when broken

**Verification:**
- [ ] Tests pass: `bun test src/services/__tests__/acpClient.test.ts`

**Dependencies:** Task 1

**Files likely touched:**
- `src/services/AcpClient.ts`
- `src/testing/fakeAcpAgent.ts`

**Estimated scope:** Small: 1-2 files

## Checkpoint: After Tasks 1-3
- [ ] All ACP tests pass with SDK schema validation on every message
- [ ] Probe list for 9.3 runs end to end


## Source verbatim from openspec/DEFERRED.md (lines 207-253)

### 9.3 ACP on the SDK (`a0f1bff`, `7268f91`)

`src/acp/server.ts`:

- **break**: offer `bypass` in `acpModes` (`src/acp/session.ts`).
  - **caught by**: `features.test.ts`, which lists the modes.
- **break**: `setMode` refusal ignored (always `{}`).
  - **caught by**: `features.test.ts`, which expects an error for `bypass`.
- **break**: `allow_always` mapped to `{ allow: true }` without `scope: 'session'`.
  - **gap**: no test answers "allow always" and then checks that a second call does not ask.
- **break**: `reject-always` treated as allow (compare `kind` wrongly).
  - **gap**: only `reject-once` is tested.
- **break**: `ask` catch swallowing an error but allowing the call.
  - **gap**: no test makes `requestPermission` fail (client answers with an error).
- **break**: replay after the `loadSession` reply instead of before it.
  - **caught by**: `features.test.ts`, which slices the messages before the reply.
- **break** `promptText`: drop `resource_link` blocks.
  - **gap**: only an embedded resource is tested.
- **break**: send `available_commands_update` before the `session/new` reply.
  - **gap**: the test does not check the order.
- **break**: `queue` in `agent()` not awaited before the prompt reply, so the last updates
  arrive after `end_turn`.
  - **gap**: no test checks that every update precedes the reply.

`src/acp/updates.ts`:

- **break** `toolKind`: map `edit` to `other`.
  - **caught by**: `runtime.test.ts` and `observer.test.ts`, which expect `kind: 'edit'`.
- **break** `diffContent`: skip `reversePatch`, so `oldText` equals `newText`.
  - **caught by**: `features.test.ts`, which expects `oldText: 'old\n'`.
- **break**: the `OUTPUT_LIMIT` cut.
  - **gap**: no test streams a long output.
- **break** `planOf`: every status becomes `pending`.
  - **caught by**: `features.test.ts`.
- **break** `pathsOf` for `apply_patch`.
  - **gap**: no ACP test uses `apply_patch`.

`src/services/AcpClient.ts`:

- **break**: offer `fs` capabilities again in `initialize`.
  - **gap**: no test asserts the client capabilities are empty. The fake agent should
    record them in `_meta` like `envNames`.
- **break** `within`: ignore the agent exiting.
  - **gap**: no test kills the fake agent mid-prompt.
- **break**: `subprocessEnv` replaced by `process.env`.
  - **caught by**: `acpClient.test.ts` "an external agent gets no provider key...".

