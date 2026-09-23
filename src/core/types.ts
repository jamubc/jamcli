export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Prompt tokens served from a provider cache, when the provider reports them. */
  cached_tokens?: number;
  /** Prompt tokens written to a provider cache, when the provider reports them. */
  cache_write_tokens?: number;
}

/**
 * Reasoning as the provider produced it. A signature or redacted payload is opaque and
 * only valid for the provider family that issued it, so it is replayed to that family
 * alone.
 */
export type ReasoningBlock =
  | { type: 'thinking'; text: string; signature?: string }
  | { type: 'redacted'; data: string };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  model?: string;
  modelName?: string;
  streaming?: boolean;
  usage?: TokenUsage;
  reasoning?: string;
  /** Structured reasoning with signatures, when the provider returns them. */
  reasoningBlocks?: ReasoningBlock[];
  /** The provider family that produced this message, such as `anthropic` or `openai`. */
  providerFamily?: string;
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
}

export type Message = ChatMessage;

export interface ProviderToolCall {
  id?: string;
  type?: string;
  function: {
    name: string;
    arguments?: any;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  type?: string;
  arguments: Record<string, any>;
}

/**
 * How a tool call ended. `denied` and `cancelled` calls never ran; `timeout` ran and
 * was stopped; `error` ran and failed, which includes a command that exited non-zero.
 */
export type ToolStatus = 'ok' | 'error' | 'denied' | 'timeout' | 'cancelled';

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  durationMs: number;
  metadata?: Record<string, any>;
  /** The call this result answers. */
  callId?: string;
  status?: ToolStatus;
}

/** What a tool can do, which decides its default permission. */
export type PolicyClass = 'read' | 'write' | 'execute' | 'network' | 'delegate' | 'state';

export interface ApprovalPreview {
  kind: 'diff' | 'command' | 'json' | 'text';
  text: string;
}

/** Everything a surface needs to ask a person, or a policy, about one tool call. */
export interface ApprovalRequest {
  id: string;
  call: ToolCall;
  policyClass: PolicyClass | 'unknown';
  /** One line naming the action, such as `run_command npm test`. */
  summary: string;
  preview?: ApprovalPreview;
  /** Why the call needs a decision: the mode or the rule that asked. */
  reason: string;
  /** Patterns a grant could remember, most specific first. */
  suggestions: string[];
}

export type ApprovalScope = 'once' | 'session' | 'project';

/** `true` and `false` stay valid shorthands for allowing or denying once. */
export type ApprovalDecision =
  | boolean
  | { allow: boolean; scope?: ApprovalScope; pattern?: string; feedback?: string };

export interface JamSession {
  id: string;
  projectRoot: string;
  messages: ChatMessage[];
  usage: TokenUsage;
  modelUsage: Record<string, TokenUsage>;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = 'ok' | 'refused' | 'limit' | 'cancelled' | 'error';

export type AgentEvent =
  | { type: 'turn_start'; prompt: string }
  | { type: 'step_start'; step: number }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_progress'; callId: string; tool: string; chunk: string }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'retry'; attempt: number; delayMs: number; reason: string }
  | { type: 'compaction'; beforeTokens: number; afterTokens: number; strategy: string }
  | { type: 'notice'; message: string; level?: 'info' | 'warn' | 'error'; code?: string }
  | {
      type: 'approval_request';
      call: ToolCall;
      decide: (decision: ApprovalDecision) => void;
      request?: ApprovalRequest;
    }
  | { type: 'turn_end'; status: RunStatus };

export interface RunResult {
  status: RunStatus;
  sessionId: string;
  response: string;
  turns: number;
  usage: TokenUsage;
  error?: string;
  /** The session after the run, including every message the run appended. */
  session?: JamSession;
}

export interface Agent {
  run(session: JamSession, prompt: string, onEvent: (e: AgentEvent) => void): Promise<RunResult>;
  cancel(sessionId: string): void;
}

/** Normalize an approval decision to its parts. */
export const readDecision = (
  decision: ApprovalDecision
): { allow: boolean; scope: ApprovalScope; pattern?: string; feedback?: string } =>
  typeof decision === 'boolean'
    ? { allow: decision, scope: 'once' }
    : { allow: decision.allow, scope: decision.scope ?? 'once', pattern: decision.pattern, feedback: decision.feedback };
