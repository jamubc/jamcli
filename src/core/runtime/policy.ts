import type { ToolPermissionValue } from '../../types/config.js';
import type { ApprovalBy, PolicyClass } from '../types.js';

export type PolicyDecision = 'allow' | 'ask' | 'deny';

export interface PolicyVerdict {
  decision: PolicyDecision;
  /** Who made the decision: a run flag or the configured policy. */
  by: Extract<ApprovalBy, 'flag' | 'policy'>;
  /** The flag or setting that decided, when one did. */
  rule?: string;
  reason: string;
}

export interface ToolPolicyOptions {
  /** The per-tool settings in `.jamcli/mcp.json` under `tools`. */
  permissions?: Record<string, ToolPermissionValue | undefined>;
  /** `--allow-tool` names for this run. */
  allowTools?: string[];
  /** `--deny-tool` names for this run. */
  denyTools?: string[];
  /** The class of a tool, which decides its default. */
  classOf: (tool: string) => PolicyClass | 'unknown';
  /** Every name a tool answers to: itself and its aliases. */
  namesOf: (tool: string) => string[];
  /** Whether a name belongs to any tool, for reporting flags that match nothing. */
  known: (name: string) => boolean;
}

export interface ToolPolicy {
  decide(tool: string): PolicyVerdict;
  /** Flag values that name no tool. */
  readonly unknownFlags: string[];
}

const splitFlags = (values: string[] | undefined): string[] =>
  (values ?? []).flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);

/** A configured setting as a decision, or null when it defers to the default. */
const fromSetting = (value: ToolPermissionValue | undefined): PolicyDecision | null => {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? null : 'deny';
  if (!value.allowed) return 'deny';
  return value.require_approval ? 'ask' : 'allow';
};

/**
 * The permission policy until the rule engine of stage 3 replaces it: per-tool settings,
 * run flags, and a default by class. A deny from a flag or a setting always wins.
 * `--allow-tool` allows the named tool without asking, even where a setting asks first,
 * and leaves every other tool as it was.
 */
export function createToolPolicy(options: ToolPolicyOptions): ToolPolicy {
  const allow = splitFlags(options.allowTools);
  const deny = splitFlags(options.denyTools);
  const unknownFlags = [...allow, ...deny].filter((name) => !options.known(name));
  const allowSet = new Set(allow);
  const denySet = new Set(deny);

  const decide = (tool: string): PolicyVerdict => {
    const names = options.namesOf(tool);
    const flagged = (set: Set<string>) => names.find((name) => set.has(name));
    const setting = names
      .map((name) => ({ name, decision: fromSetting(options.permissions?.[name]) }))
      .find((entry) => entry.decision !== null);

    const denied = flagged(denySet);
    if (denied) return { decision: 'deny', by: 'flag', rule: `--deny-tool ${denied}`, reason: `--deny-tool ${denied} denies it for this run` };
    if (setting?.decision === 'deny') {
      return { decision: 'deny', by: 'policy', rule: `tools.${setting.name}`, reason: `tools.${setting.name} in .jamcli/mcp.json denies it` };
    }
    const allowed = flagged(allowSet);
    if (allowed) return { decision: 'allow', by: 'flag', rule: `--allow-tool ${allowed}`, reason: `--allow-tool ${allowed} allows it for this run` };
    if (setting) {
      const verb = setting.decision === 'ask' ? 'asks before it runs' : 'allows it without asking';
      return { decision: setting.decision!, by: 'policy', rule: `tools.${setting.name}`, reason: `tools.${setting.name} in .jamcli/mcp.json ${verb}` };
    }
    return options.classOf(tool) === 'read'
      ? { decision: 'allow', by: 'policy', reason: 'read-only tools run without asking' }
      : { decision: 'ask', by: 'policy', reason: 'tools that change state ask first' };
  };

  return { decide, unknownFlags };
}
