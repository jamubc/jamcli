import type { AgentEvent, ApprovalPreview, ApprovalScope, ChatMessage, ToolCall, ToolStatus } from '../../core/types.js';
import { describeCall } from '../../core/approval.js';
import { isSummary } from '../../core/context/compact.js';

/**
 * The interface's view state, and the pure function that folds runtime events into it.
 * The interface renders this and nothing else, so everything it shows can be tested
 * without a terminal.
 */

/** How a tool call stands, as its block shows it. */
export type ToolPhase = 'pending' | 'waiting' | 'running' | ToolStatus;

export type Row =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string; reasoning: string; streaming: boolean }
  | {
      kind: 'tool';
      id: number;
      callId: string;
      tool: string;
      /** One line: the tool and its main argument. */
      summary: string;
      phase: ToolPhase;
      durationMs?: number;
      /** The last lines of what the tool printed or returned. */
      output: string;
      /** A diff or command shown when the call asked for approval. */
      preview?: ApprovalPreview;
      /** The change an edit made, or proposed, as a unified diff. Shown open. */
      diff?: string;
      /** The file the call names, for highlighting its diff. */
      path?: string;
      /** How an approval request for it was answered. */
      decision?: { allow: boolean; by: string; scope: ApprovalScope; rule?: string };
      collapsed: boolean;
    }
  | { kind: 'notice'; id: number; level: 'info' | 'warn' | 'error'; text: string }
  /** A slash command as the person typed it. */
  | { kind: 'command'; id: number; text: string }
  /** What a command reports: a table, a list, or a few lines. */
  | { kind: 'output'; id: number; text: string; diff?: string }
  | { kind: 'compaction'; id: number; trigger: 'auto' | 'manual'; strategy: 'summary' | 'drop'; beforeTokens: number; afterTokens: number };

/** A call waiting for the person, as the permission prompt shows it. */
export interface PendingApproval {
  callId: string;
  tool: string;
  summary: string;
  /** The rule or mode that asked. */
  reason: string;
  preview?: ApprovalPreview;
  /** Patterns a grant could remember, most specific first. */
  suggestions: string[];
}

/** What the turn is doing now, for the status line. */
export type Phase = 'idle' | 'thinking' | 'streaming' | 'tool' | 'waiting' | 'retrying' | 'compacting';

export interface StatusData {
  mode: string;
  /** `provider:model`. */
  model: string;
  sandbox: string;
  /** The next request's share of the budget, 0 to 100, when known. */
  contextPercent?: number;
  /** What the session has cost; null while no request had a known price. */
  costUsd: number | null;
  /** Requests with no known price, which make a cost a lower bound. */
  unpriced: number;
  inputTokens: number;
  outputTokens: number;
  mcpServers: number;
  /** The language servers that can run here, by name. */
  lspServers: number;
  phase: Phase;
  retry?: { attempt: number; delayMs: number; reason: string };
}

/** One item of the model's todo list, as its `todo_write` call left it. */
export interface TodoView {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  active_form?: string;
}

export interface ViewState {
  rows: Row[];
  approvals: PendingApproval[];
  status: StatusData;
  running: boolean;
  nextId: number;
  /** The todo list the model last wrote in this session, when it has written one. */
  todos?: TodoView[];
}

export type ViewAction =
  | { type: 'event'; event: AgentEvent }
  /** The person sent a message; it is shown as typed, before any `@` reference is expanded. */
  | { type: 'submit'; text: string }
  /** Show a conversation from its messages, as a resumed session. */
  | { type: 'load'; messages: ChatMessage[] }
  | { type: 'status'; patch: Partial<StatusData> }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; text: string }
  /** The person ran a slash command, which never reaches the model. */
  | { type: 'command'; text: string }
  | { type: 'output'; text: string; diff?: string }
  | { type: 'toggle'; id: number }
  | { type: 'clear' };

/** Characters of a tool's output a block keeps, from the end. */
export const OUTPUT_TAIL_CHARS = 4_000;
/** Lines of a tool's output a block keeps, from the end. */
export const OUTPUT_TAIL_LINES = 40;

export const tail = (text: string): string => {
  const recent = text.length > OUTPUT_TAIL_CHARS ? text.slice(-OUTPUT_TAIL_CHARS) : text;
  const lines = recent.split('\n');
  return lines.length > OUTPUT_TAIL_LINES ? lines.slice(-OUTPUT_TAIL_LINES).join('\n') : recent;
};

export function initialView(status: Partial<StatusData> = {}): ViewState {
  return {
    rows: [],
    approvals: [],
    running: false,
    nextId: 1,
    status: { mode: 'default', model: '', sandbox: 'none', costUsd: null, unpriced: 0, inputTokens: 0, outputTokens: 0, mcpServers: 0, lspServers: 0, phase: 'idle', ...status },
  };
}

const toolCallOf = (call: { id?: string; function: { name: string; arguments?: any } }, index: number): ToolCall => ({
  id: call.id ?? `call-${index}`,
  name: call.function.name,
  arguments: typeof call.function.arguments === 'string' ? safeParse(call.function.arguments) : (call.function.arguments ?? {}),
});

const safeParse = (text: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

/** Replace the row that matches, keeping every other row as it was. */
const updateRow = (rows: Row[], match: (row: Row) => boolean, change: (row: any) => Row): Row[] => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (match(rows[index])) {
      const next = rows.slice();
      next[index] = change(rows[index]);
      return next;
    }
  }
  return rows;
};

const isTool = (callId: string) => (row: Row) => row.kind === 'tool' && row.callId === callId;

/** The assistant row being streamed into, closed when anything else is shown. */
const closeStreaming = (rows: Row[]): Row[] => {
  const last = rows[rows.length - 1];
  if (last?.kind !== 'assistant' || !last.streaming) return rows;
  return [...rows.slice(0, -1), { ...last, streaming: false }];
};

function applyEvent(state: ViewState, event: AgentEvent): ViewState {
  const status = state.status;
  switch (event.type) {
    case 'turn_start':
    case 'step_start':
      return { ...state, running: true, status: { ...status, phase: 'thinking', retry: undefined } };

    case 'text':
    case 'reasoning': {
      const last = state.rows[state.rows.length - 1];
      const field = event.type === 'text' ? 'text' : 'reasoning';
      const phase: Phase = event.type === 'text' ? 'streaming' : 'thinking';
      if (last?.kind === 'assistant' && last.streaming) {
        const rows = [...state.rows.slice(0, -1), { ...last, [field]: last[field] + event.delta }];
        return { ...state, rows, status: { ...status, phase, retry: undefined } };
      }
      const row: Row = { kind: 'assistant', id: state.nextId, text: '', reasoning: '', streaming: true, [field]: event.delta };
      return { ...state, rows: [...state.rows, row], nextId: state.nextId + 1, status: { ...status, phase, retry: undefined } };
    }

    case 'tool_call': {
      const rows = closeStreaming(state.rows);
      if (rows.some(isTool(event.call.id))) return { ...state, rows };
      const target = event.call.arguments?.path;
      const row: Row = {
        kind: 'tool',
        id: state.nextId,
        callId: event.call.id,
        tool: event.call.name,
        summary: describeCall(event.call),
        phase: 'pending',
        output: '',
        ...(typeof target === 'string' ? { path: target } : {}),
        collapsed: true,
      };
      return { ...state, rows: [...rows, row], nextId: state.nextId + 1, status: { ...status, phase: 'tool', retry: undefined } };
    }

    case 'tool_progress':
      return {
        ...state,
        rows: updateRow(state.rows, isTool(event.callId), (row) => ({ ...row, phase: 'running', output: tail(row.output + event.chunk) })),
      };

    case 'tool_result': {
      const result = event.result;
      const phase: ToolPhase = result.status ?? (result.success ? 'ok' : 'error');
      const madeDiff = typeof result.metadata?.diff === 'string' && result.metadata.diff ? (result.metadata.diff as string) : undefined;
      const rows = updateRow(state.rows, isTool(result.callId ?? ''), (row) => ({
        ...row,
        phase,
        durationMs: result.durationMs,
        output: tail(result.output ?? ''),
        // The change made replaces the one proposed, and a change is shown open.
        ...(madeDiff ? { diff: madeDiff, collapsed: false } : {}),
      }));
      const todos = result.tool === 'todo_write' && result.success && Array.isArray(result.metadata?.todos) ? (result.metadata.todos as TodoView[]) : undefined;
      return { ...state, rows, approvals: state.approvals.filter((approval) => approval.callId !== result.callId), ...(todos ? { todos } : {}) };
    }

    case 'approval_request': {
      const request = event.request;
      const approval: PendingApproval = {
        callId: event.call.id,
        tool: event.call.name,
        summary: request?.summary ?? describeCall(event.call),
        reason: request?.reason ?? 'this tool asks before it runs',
        ...(request?.preview ? { preview: request.preview } : {}),
        suggestions: request?.suggestions ?? [],
      };
      const known = state.rows.some(isTool(event.call.id));
      const proposed = approval.preview?.kind === 'diff' ? { diff: approval.preview.text } : {};
      const target = event.call.arguments?.path;
      const rows = known
        ? updateRow(state.rows, isTool(event.call.id), (row) => ({ ...row, phase: 'waiting', preview: approval.preview, ...proposed }))
        : [
            ...closeStreaming(state.rows),
            {
              kind: 'tool',
              id: state.nextId,
              callId: event.call.id,
              tool: event.call.name,
              summary: approval.summary,
              phase: 'waiting',
              output: '',
              preview: approval.preview,
              ...proposed,
              ...(typeof target === 'string' ? { path: target } : {}),
              collapsed: true,
            } as Row,
          ];
      return {
        ...state,
        rows,
        nextId: known ? state.nextId : state.nextId + 1,
        approvals: [...state.approvals.filter((item) => item.callId !== approval.callId), approval],
        status: { ...status, phase: 'waiting' },
      };
    }

    case 'approval_decision':
      return {
        ...state,
        rows: updateRow(state.rows, isTool(event.callId), (row) => ({
          ...row,
          phase: event.allow ? 'running' : 'denied',
          decision: { allow: event.allow, by: event.by, scope: event.scope, ...(event.rule ? { rule: event.rule } : {}) },
        })),
        approvals: state.approvals.filter((approval) => approval.callId !== event.callId),
        status: { ...status, phase: state.approvals.length > 1 ? 'waiting' : 'tool' },
      };

    case 'usage': {
      const priced = event.cost !== undefined;
      return {
        ...state,
        status: {
          ...status,
          costUsd: priced ? (status.costUsd ?? 0) + event.cost! : status.costUsd,
          unpriced: status.unpriced + (priced ? 0 : 1),
          inputTokens: status.inputTokens + (event.usage.prompt_tokens || 0),
          outputTokens: status.outputTokens + (event.usage.completion_tokens || 0),
        },
      };
    }

    case 'retry':
      return { ...state, status: { ...status, phase: 'retrying', retry: { attempt: event.attempt, delayMs: event.delayMs, reason: event.reason } } };

    case 'compaction': {
      const row: Row = { kind: 'compaction', id: state.nextId, trigger: event.trigger, strategy: event.strategy, beforeTokens: event.beforeTokens, afterTokens: event.afterTokens };
      return { ...state, rows: [...closeStreaming(state.rows), row], nextId: state.nextId + 1 };
    }

    case 'notice': {
      // The compaction's own row says what this notice says, for surfaces that print text.
      if (event.code === 'compacted') return state;
      const row: Row = { kind: 'notice', id: state.nextId, level: event.level ?? 'info', text: event.message };
      return { ...state, rows: [...closeStreaming(state.rows), row], nextId: state.nextId + 1 };
    }

    case 'turn_end': {
      // A call still open when the turn ends did not finish.
      const rows = closeStreaming(state.rows).map((row) =>
        row.kind === 'tool' && (row.phase === 'pending' || row.phase === 'running' || row.phase === 'waiting') ? { ...row, phase: 'cancelled' as const } : row
      );
      return { ...state, rows, approvals: [], running: false, status: { ...status, phase: 'idle', retry: undefined } };
    }

    default:
      return state;
  }
}

/** Rows for a conversation read back from its messages. */
function rowsFrom(messages: ChatMessage[], firstId: number): { rows: Row[]; nextId: number } {
  const rows: Row[] = [];
  let id = firstId;
  messages.forEach((message) => {
    if (message.role === 'system') return;
    if (message.role === 'user') {
      if (isSummary(message)) rows.push({ kind: 'notice', id: id++, level: 'info', text: 'The earlier conversation was summarized.' });
      else rows.push({ kind: 'user', id: id++, text: message.content });
      return;
    }
    if (message.role === 'assistant') {
      if (message.content?.trim() || message.reasoning?.trim()) {
        rows.push({ kind: 'assistant', id: id++, text: message.content ?? '', reasoning: message.reasoning ?? '', streaming: false });
      }
      (message.tool_calls ?? []).forEach((raw, index) => {
        const call = toolCallOf(raw, index);
        rows.push({ kind: 'tool', id: id++, callId: call.id, tool: call.name, summary: describeCall(call), phase: 'cancelled', output: '', collapsed: true });
      });
      return;
    }
    // A tool result settles the block its call opened.
    let at = rows.length - 1;
    while (at >= 0 && !(rows[at].kind === 'tool' && (rows[at] as { callId?: string }).callId === message.tool_call_id)) at -= 1;
    if (at >= 0) {
      const row = rows[at] as Extract<Row, { kind: 'tool' }>;
      rows[at] = { ...row, phase: message.toolStatus ?? 'ok', output: tail(message.content ?? '') };
    }
  });
  return { rows, nextId: id };
}

export function reduceView(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'event':
      return applyEvent(state, action.event);
    case 'submit': {
      const row: Row = { kind: 'user', id: state.nextId, text: action.text };
      return { ...state, rows: [...closeStreaming(state.rows), row], nextId: state.nextId + 1, running: true, status: { ...state.status, phase: 'thinking' } };
    }
    case 'load': {
      const { rows, nextId } = rowsFrom(action.messages, state.nextId);
      // Tokens are counted from events, so another session's count starts over.
      return { ...state, rows, nextId, approvals: [], running: false, todos: undefined, status: { ...state.status, phase: 'idle', retry: undefined, inputTokens: 0, outputTokens: 0 } };
    }
    case 'status':
      return { ...state, status: { ...state.status, ...action.patch } };
    case 'notice': {
      const row: Row = { kind: 'notice', id: state.nextId, level: action.level, text: action.text };
      return { ...state, rows: [...state.rows, row], nextId: state.nextId + 1 };
    }
    case 'command':
    case 'output': {
      const row: Row = action.type === 'output' && action.diff ? { kind: 'output', id: state.nextId, text: action.text, diff: action.diff } : { kind: action.type, id: state.nextId, text: action.text };
      return { ...state, rows: [...closeStreaming(state.rows), row], nextId: state.nextId + 1 };
    }
    case 'toggle':
      return { ...state, rows: updateRow(state.rows, (row) => row.id === action.id && row.kind === 'tool', (row) => ({ ...row, collapsed: !row.collapsed })) };
    case 'clear':
      return { ...state, rows: [], approvals: [] };
    default:
      return state;
  }
}
