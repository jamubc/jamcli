import type { RunStatus } from '../core/types.js';

/**
 * Agent Client Protocol (v1) message shapes, JSON-RPC 2.0 over a line-delimited
 * stdio channel. The wire shapes here were read off the reference client at
 * ~/.local/bin/acp-delegate: initialize, session/new, session/prompt,
 * session/cancel, session/update, and session/request_permission.
 */

export const ACP_PROTOCOL_VERSION = 1;

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Encode a message as one newline-terminated JSON line. */
export const encodeMessage = (message: JsonRpcMessage): string => `${JSON.stringify(message)}\n`;

/** Decode one line into a message, or null when it is not valid JSON-RPC 2.0. */
export const decodeMessage = (line: string): JsonRpcMessage | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.jsonrpc !== '2.0') return null;

  if (typeof parsed.method === 'string') {
    if (parsed.id === undefined) {
      return { jsonrpc: '2.0', method: parsed.method, params: parsed.params };
    }
    return { jsonrpc: '2.0', id: parsed.id, method: parsed.method, params: parsed.params };
  }

  if ('result' in parsed || 'error' in parsed) {
    return { jsonrpc: '2.0', id: parsed.id ?? null, result: parsed.result, error: parsed.error };
  }

  return null;
};

export const isRequest = (message: JsonRpcMessage): message is JsonRpcRequest =>
  'method' in message && 'id' in message;
export const isNotification = (message: JsonRpcMessage): message is JsonRpcNotification =>
  'method' in message && !('id' in message);
export const isResponse = (message: JsonRpcMessage): message is JsonRpcResponse => !('method' in message);

/** Permission option kinds the client selects from. */
export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export interface PermissionSelected {
  outcome: 'selected';
  optionId: string;
}
export interface PermissionCancelled {
  outcome: 'cancelled';
}
export type PermissionOutcome = PermissionSelected | PermissionCancelled;

export const permissionOptions = (): PermissionOption[] => [
  { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
  { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
  { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
];

/** True only when the client chose an allow option that exists in the offer. */
export const isApprovalOutcome = (
  outcome: PermissionOutcome | null | undefined,
  options: PermissionOption[]
): boolean => {
  if (!outcome || outcome.outcome !== 'selected' || typeof outcome.optionId !== 'string') return false;
  const chosen = options.find((option) => option.optionId === outcome.optionId);
  if (!chosen) return false;
  return chosen.kind === 'allow_once' || chosen.kind === 'allow_always';
};

export interface AcpToolCall {
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  rawInput?: unknown;
  locations?: { path: string }[];
}

export type SessionUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content: { type: 'text'; text: string } }
  | { sessionUpdate: 'agent_thought_chunk'; content: { type: 'text'; text: string } }
  | ({ sessionUpdate: 'tool_call' } & AcpToolCall)
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; status: string };

export const messageChunk = (text: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
});

export const thoughtChunk = (text: string): SessionUpdate => ({
  sessionUpdate: 'agent_thought_chunk',
  content: { type: 'text', text },
});

export const toolCallUpdate = (call: { id: string; name: string; arguments?: Record<string, any> }): SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: call.id,
  title: call.name,
  kind: 'other',
  status: 'in_progress',
  rawInput: call.arguments ?? {},
  locations: [],
});

export const toolCallStatusUpdate = (
  toolCallId: string,
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
): SessionUpdate => ({ sessionUpdate: 'tool_call_update', toolCallId, status });

export interface AcpConfigOption {
  id: string;
  name: string;
  category: string;
  currentValue: string;
  options?: { value: string; name: string }[];
}

export type AcpStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled';

/** Map a core run status onto the ACP stop reason vocabulary. */
export const stopReasonFor = (status: RunStatus): AcpStopReason => {
  switch (status) {
    case 'ok':
      return 'end_turn';
    case 'limit':
      return 'max_turn_requests';
    case 'cancelled':
      return 'cancelled';
    case 'refused':
    case 'error':
    default:
      return 'refusal';
  }
};
