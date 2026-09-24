import type { PolicyClass } from '../types.js';

export type PermissionMode = 'plan' | 'default' | 'accept-edits' | 'auto' | 'bypass';

export const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'default', 'accept-edits', 'auto', 'bypass'];

/** What a mode does with a class when no rule decides: `inside` allows only within the project, `sandboxed` only in a sandbox. */
export type ModeDefault = 'allow' | 'ask' | 'deny' | 'inside' | 'sandboxed';

type Classes = PolicyClass | 'unknown';

const table = (read: ModeDefault, write: ModeDefault, execute: ModeDefault, network: ModeDefault, delegate: ModeDefault) => ({
  read,
  write,
  execute,
  network,
  delegate,
  // The agent's own plan changes nothing outside it.
  state: 'allow' as ModeDefault,
  // A tool that declares no class is treated as one that runs things.
  unknown: execute,
});

export const MODE_DEFAULTS: Record<PermissionMode, Record<Classes, ModeDefault>> = {
  plan: table('allow', 'deny', 'deny', 'ask', 'deny'),
  default: table('allow', 'ask', 'ask', 'ask', 'ask'),
  'accept-edits': table('allow', 'inside', 'ask', 'ask', 'ask'),
  auto: table('allow', 'inside', 'sandboxed', 'ask', 'allow'),
  bypass: table('allow', 'allow', 'allow', 'allow', 'allow'),
};

export const isPermissionMode = (value: unknown): value is PermissionMode =>
  typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);

/** Why a session cannot enter a mode, or nothing when it can. */
export function modeRefusal(mode: PermissionMode, options: { sandboxed: boolean; bypassConfirmed?: boolean }): string | undefined {
  if (mode === 'auto' && !options.sandboxed) {
    return 'auto mode runs commands without asking only inside a sandbox, and no sandbox is available here.';
  }
  if (mode === 'bypass' && !options.bypassConfirmed) {
    return 'bypass mode needs --dangerously-bypass-permissions or a confirmation in the interface.';
  }
  return undefined;
}

export const PLAN_NOTE =
  'Plan mode is on: you can read and search, but not change files, run commands, or delegate. Investigate, then present a plan for the user to approve.';
