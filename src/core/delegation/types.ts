import type { AgentEvent, ApprovalDecision, ApprovalRequest, ToolCall, ToolResult } from '../types.js';
import type { EffortLevel, ReasoningLevel } from '../routing/capabilities.js';

/**
 * Ask whoever answers a call's approvals about a call nested inside it, such as a child
 * run's. `withdrawn` aborts when the run that asked settled it without an answer.
 */
export type NestedApproval = (nested: { call: ToolCall; request?: ApprovalRequest; withdrawn?: AbortSignal }) => Promise<ApprovalDecision | 'cancelled'>;

export interface DelegationRequest {
  /** The agent to run on; the configured default when absent. */
  agent?: string;
  prompt: string;
  /** Replaces the chain entry's reasoning level for this child only. */
  reasoning?: ReasoningLevel;
  /** Replaces the agent's effort for this child only. */
  effort?: EffortLevel;
  maxTurns: number;
  /** A background child outlives the call that started it; it still asks through `requestApproval`. */
  background: boolean;
  signal?: AbortSignal;
  /** The child's reply as it streams. */
  onText?: (delta: string) => void;
  /** The child's session is open and about to run: the agent and model it resolved to. */
  onStart?: (child: { agent: string; model: string; sessionId: string }) => void;
  /** Every event of the child's run, as it happens, so the person can look in on it. */
  onEvent?: (event: AgentEvent) => void;
  /** What the person watching has said to the child since it last asked, so it can hear them. */
  heard?: () => string[];
  requestApproval?: NestedApproval;
  /** A call the child asked about through `requestApproval`, once it has a result. */
  onResult?: (result: ToolResult) => void;
  /** `worktree`: the child works in a git worktree of its own, apart from the parent's files. */
  isolation?: 'worktree';
}

export interface DelegationOutcome {
  status: 'ok' | 'error' | 'cancelled' | 'refused' | 'limit';
  response: string;
  /** The agent that ran, or was asked for when none could. */
  agent: string;
  resolvedModel?: string;
  childSessionId?: string;
  reason?: string;
  /** Where an isolated child's changes are, when it made any; its worktree is removed when it made none. */
  worktree?: { path: string; branch: string; summary: string };
}

/** Runs one child for the task tool. The runtime supplies it. */
export type Delegate = (request: DelegationRequest) => Promise<DelegationOutcome>;
