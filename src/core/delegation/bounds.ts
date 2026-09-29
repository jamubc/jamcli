import type { DelegationConfig } from '../../types/config.js';
import { DEFAULT_DELEGATION_CONFIG } from '../../types/config.js';

export interface DelegationState {
  depth: number;
  running: number;
  /** What configuration sets; a key it leaves out keeps its default. */
  config?: Partial<DelegationConfig>;
}

export interface DelegationDecision {
  allowed: boolean;
  reason?: string;
}

export const canDelegate = (state: DelegationState): DelegationDecision => {
  // A block that sets only some keys must not leave the others unbounded.
  const config = { ...DEFAULT_DELEGATION_CONFIG, ...state.config };
  if (state.depth >= config.max_depth) {
    return {
      allowed: false,
      reason: `Delegation depth ${state.depth} is at the configured maximum of ${config.max_depth}.`,
    };
  }
  if (state.running >= config.max_concurrent) {
    // A child's siblings hold the slots and it cannot outlast them, so a retry only spends its turns.
    const advice = state.depth > 0 ? ' Do this part yourself in this run; asking again will not free a slot.' : '';
    return {
      allowed: false,
      reason: `Already running ${state.running} child task(s); the maximum is ${config.max_concurrent}.${advice}`,
    };
  }
  return { allowed: true };
};

export const childTurns = (config: Partial<DelegationConfig> | undefined, requested?: number): number => {
  const limit = config?.max_turns_per_child ?? DEFAULT_DELEGATION_CONFIG.max_turns_per_child;
  if (!requested || requested <= 0) return limit;
  return Math.min(requested, limit);
};

export interface DelegationRecord {
  agent: string;
  resolvedModel: string;
  childSessionId: string;
  status: string;
}

export const delegationTranscriptLine = (record: DelegationRecord): string =>
  [
    `Delegated to agent "${record.agent}" on ${record.resolvedModel}`,
    `child session ${record.childSessionId}`,
    `status ${record.status}`,
  ].join(' | ');
