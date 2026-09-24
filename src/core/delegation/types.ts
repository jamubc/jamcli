import type { ApprovalDecision, ApprovalRequest, ToolCall } from '../types.js';

/** Ask whoever answers a call's approvals about a call nested inside it, such as a child run's. */
export type NestedApproval = (nested: { call: ToolCall; request?: ApprovalRequest }) => Promise<ApprovalDecision | 'cancelled'>;

export interface DelegationRequest {
  category: string;
  prompt: string;
  maxTurns: number;
  /** A background child outlives the call that started it, so it cannot ask anyone. */
  background: boolean;
  signal?: AbortSignal;
  /** The child's reply as it streams. */
  onText?: (delta: string) => void;
  requestApproval?: NestedApproval;
}

export interface DelegationOutcome {
  status: 'ok' | 'error' | 'cancelled' | 'refused' | 'limit';
  response: string;
  category: string;
  resolvedModel?: string;
  childSessionId?: string;
  reason?: string;
}

/** Runs one child for the task tool. The runtime supplies it. */
export type Delegate = (request: DelegationRequest) => Promise<DelegationOutcome>;
