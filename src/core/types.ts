export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  model?: string;
  modelName?: string;
  streaming?: boolean;
  usage?: TokenUsage;
  reasoning?: string;
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

export interface ToolResult {
  tool: string;
  success: boolean;
  output: string;
  durationMs: number;
  metadata?: Record<string, any>;
}

export interface JamSession {
  id: string;
  projectRoot: string;
  messages: ChatMessage[];
  usage: TokenUsage;
  modelUsage: Record<string, TokenUsage>;
  createdAt: number;
  updatedAt: number;
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'notice'; message: string }
  | { type: 'approval_request'; call: ToolCall; decide: (ok: boolean) => void };

export type RunStatus = 'ok' | 'refused' | 'limit' | 'cancelled' | 'error';

export interface RunResult {
  status: RunStatus;
  sessionId: string;
  response: string;
  turns: number;
  usage: TokenUsage;
  error?: string;
}

export interface Agent {
  run(session: JamSession, prompt: string, onEvent: (e: AgentEvent) => void): Promise<RunResult>;
  cancel(sessionId: string): void;
}
