## 1. Record

- [x] 1.1 Restate each changed requirement whole in `specs/jamcli/spec.md`, every new or
  changed scenario checked against the code and the test that proves it:
  - Terminal User Interface: `src/tui/app/Rows.tsx`, `src/tui/state/view.ts`,
    `src/tui/app/Prompt.tsx`; `transcript.test.tsx`, `prompt.test.tsx`,
    `commands.test.tsx` (`/note`), `mouse.test.tsx`.
  - Model Discovery: `src/tui/app/commands.ts` (`/model`); `commands.test.tsx`.
  - Approval-Gated State Changes: `proceed` in `src/core/tools/dispatch.ts` and
    `src/core/agent.ts`; `verdicts.test.ts`, `prompt.test.tsx`.
  - UI Style Configuration: `src/tui/app/motion.ts`, `src/styles/statusStyles.ts`;
    `motion.test.ts`, `statusStyle.test.ts`.
  - Tool Output Trust Gate: `src/core/runtime/model.ts`, `src/core/runtime/index.ts`,
    `src/core/trust/`; `runtime.test.ts`, `agents.test.ts`, `jev.test.ts`.
  - Model Catalog: `src/core/catalog/directory.ts`, `src/core/catalog/index.ts`;
    `directory.test.ts`.
  - Credential Storage: `src/cli/config.ts`, the key notice in
    `src/core/runtime/index.ts`; `config.test.ts`, `catalog.test.ts`.
  - Keybindings and Themes: `selection` and `chosen` in `src/tui/app/theme.ts`;
    `theme.test.ts`, `mouse.test.tsx`.
- [x] 1.2 `openspec validate reconcile-shipped-behavior --strict`.

## 2. Close

- [x] 2.1 Four gates on the branch head.
- [x] 2.2 Archive, applying the deltas to `openspec/specs/jamcli/spec.md`, and record the
  unit in `openspec/SEQUENCE.md`.
