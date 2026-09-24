import type { ToolPermissionValue } from '../../types/config.js';
import type { ToolRegistry } from '../tools/registry.js';
import { PermissionEngine } from '../permissions/engine.js';
import { loadPermissions, type PermissionFlags } from '../permissions/config.js';
import { modeRefusal, type PermissionMode } from '../permissions/modes.js';
import { toolNaming } from './tools.js';

export interface SessionPermissionOptions {
  projectRoot: string;
  registry: ToolRegistry;
  /** The legacy per-tool block of `.jamcli/mcp.json`. */
  legacyTools?: Record<string, ToolPermissionValue | undefined>;
  flags?: PermissionFlags;
  /** `--dangerously-bypass-permissions`: start in bypass mode, confirmed. */
  bypass?: boolean;
  sandboxed: boolean;
  env?: Record<string, string | undefined>;
}

/**
 * The permission engine a session starts with. A mode whose precondition fails, such as
 * `auto` without a sandbox or `bypass` from a file rather than the flag, falls back to
 * `default` with a notice saying which setting asked for it and why it cannot apply.
 */
export function sessionPermissions(options: SessionPermissionOptions): { engine: PermissionEngine; notices: string[] } {
  const loaded = loadPermissions({ projectRoot: options.projectRoot, legacyTools: options.legacyTools, flags: options.flags, env: options.env });
  const notices = [...loaded.errors];
  let mode: PermissionMode = options.bypass ? 'bypass' : loaded.mode;
  const refusal = modeRefusal(mode, { sandboxed: options.sandboxed, bypassConfirmed: options.bypass });
  if (refusal) {
    notices.push(`${loaded.modeSource} asks for ${mode} mode, but ${refusal} This session starts in default mode.`);
    mode = 'default';
  }
  const { classOf, namesOf } = toolNaming(options.registry);
  const engine = new PermissionEngine({
    projectRoot: options.projectRoot,
    rules: loaded.rules,
    mode,
    sandboxed: options.sandboxed,
    classOf,
    namesOf,
  });
  for (const rule of engine.unmatched(options.registry.list().map((tool) => tool.name))) {
    notices.push(`The rule ${rule.text} (${rule.source}) names no tool, so it has no effect.`);
  }
  return { engine, notices };
}
