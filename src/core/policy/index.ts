import type { ToolPermission, ToolPermissionValue } from '../../types/config.js';
import type { RegisteredToolClass } from '../../types/tools.js';
import { listTools } from '../tools/registry.js';

export type ToolDecision = 'allow' | 'ask' | 'deny';

export interface ToolPolicySource {
  permissions?: Record<string, ToolPermissionValue>;
  allowTools?: string[];
  denyTools?: string[];
}

export interface ToolPolicyResolution {
  tool: string;
  decision: ToolDecision;
  reason: string;
}

const STATE_CHANGING: ToolDecision = 'ask';
const READ_ONLY: ToolDecision = 'allow';

export const policyClassOf = (tool: string): RegisteredToolClass | 'unknown' => {
  const registered = listTools().find((entry) => entry.name === tool);
  if (!registered) return 'unknown';
  return registered.policy;
};

const defaultDecision = (tool: string): ToolDecision => {
  const policy = policyClassOf(tool);
  if (policy === 'read') return READ_ONLY;
  if (policy === 'write' || policy === 'execute') return STATE_CHANGING;
  return STATE_CHANGING;
};

const fromPermission = (permission: ToolPermissionValue): ToolDecision | null => {
  if (typeof permission === 'boolean') {
    if (!permission) return 'deny';
    return null;
  }
  if (!permission.allowed) return 'deny';
  if (permission.require_approval) return 'ask';
  return 'allow';
};

export const resolveToolPolicy = (tool: string, source: ToolPolicySource = {}): ToolPolicyResolution => {
  const denied = new Set(source.denyTools ?? []);
  const allowed = new Set(source.allowTools ?? []);

  if (denied.has(tool)) {
    return { tool, decision: 'deny', reason: 'a deny override applies to this run' };
  }

  const configured = source.permissions?.[tool];
  const configuredDecision = configured === undefined ? null : fromPermission(configured);
  if (configuredDecision === 'deny') {
    return { tool, decision: 'deny', reason: 'configuration denies this tool' };
  }
  if (configuredDecision) {
    if (configuredDecision === 'allow' && !allowed.size && defaultDecision(tool) === 'ask') {
      return { tool, decision: 'allow', reason: 'configuration allows this tool without approval' };
    }
    return { tool, decision: configuredDecision, reason: 'configuration sets this tool' };
  }

  if (allowed.size) {
    if (allowed.has(tool)) return { tool, decision: 'allow', reason: 'an allow override applies to this run' };
    return { tool, decision: 'deny', reason: 'the run allows an explicit tool list that omits this tool' };
  }

  const decision = defaultDecision(tool);
  return {
    tool,
    decision,
    reason: decision === 'ask' ? 'state-changing tools ask by default' : 'read-only tools run by default',
  };
};

export const resolveAllPolicies = (source: ToolPolicySource = {}): ToolPolicyResolution[] =>
  listTools().map((tool) => resolveToolPolicy(tool.name, source));

export const narrowForChild = (parent: ToolPolicyResolution[]): ToolPolicyResolution[] =>
  parent.map((resolution) =>
    resolution.decision === 'allow' && policyClassOf(resolution.tool) !== 'read'
      ? { ...resolution, decision: 'ask' as ToolDecision, reason: 'a delegated run cannot widen permissions' }
      : resolution
  );

export type { ToolPermission };
