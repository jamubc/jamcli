import type { ApprovalScope, ChatMessage, RunStatus, TokenUsage } from '../types.js';

/**
 * A session is an append-only log of these events, one JSON object per line with
 * `"v":2`. Provider requests, resumes, forks, exports, and ACP replays are projections
 * of the log, so the log is the only record that has to be right.
 */
export type TranscriptEvent =
  | {
      v: 2;
      type: 'session';
      ts: number;
      id: string;
      projectRoot: string;
      cwd: string;
      surface: string;
      jamcli: string;
      /** Set on a fork: the session and event index it was copied from. */
      parent?: { session: string; event: number };
      /** Set on a delegated run: the session whose task call started it. */
      delegatedBy?: string;
      /** The permission mode the session started in. */
      permissionMode?: string;
    }
  | { v: 2; type: 'message'; ts: number; message: ChatMessage }
  | {
      v: 2;
      type: 'approval';
      ts: number;
      callId: string;
      tool: string;
      allow: boolean;
      scope: ApprovalScope;
      by: string;
      surface: string;
      rule?: string;
      feedback?: string;
      reason?: string;
    }
  | { v: 2; type: 'usage'; ts: number; model?: string; usage: TokenUsage; cost?: number }
  | { v: 2; type: 'notice'; ts: number; level: 'info' | 'warn' | 'error'; message: string; code?: string }
  | { v: 2; type: 'model'; ts: number; from?: string; to: string }
  | { v: 2; type: 'permission_mode'; ts: number; from: string; to: string }
  | { v: 2; type: 'compaction'; ts: number; summary: string; replaced: number; before: number; after: number }
  | { v: 2; type: 'checkpoint'; ts: number; ref: string; files?: string[] }
  | { v: 2; type: 'end'; ts: number; status: RunStatus };

export type TranscriptEventType = TranscriptEvent['type'];

/** Version 1 history: one line per turn, holding only role and content. */
export interface LegacyTurn {
  id?: string;
  timestamp?: string;
  model?: string;
  messages: { role: ChatMessage['role']; content: string }[];
  usage?: TokenUsage;
}

/** Turn a version 1 line into the events it stands for. */
export const eventsFromLegacyTurn = (turn: LegacyTurn): TranscriptEvent[] => {
  const ts = turn.timestamp ? Date.parse(turn.timestamp) || 0 : 0;
  const events: TranscriptEvent[] = turn.messages.map((message) => ({
    v: 2 as const,
    type: 'message' as const,
    ts,
    message: { role: message.role, content: message.content ?? '', timestamp: ts, ...(turn.model ? { model: turn.model } : {}) },
  }));
  if (turn.usage) events.push({ v: 2, type: 'usage', ts, ...(turn.model ? { model: turn.model } : {}), usage: turn.usage });
  return events;
};

/** Parse one line of a session file, in either format. Unreadable lines are skipped. */
export const parseTranscriptLine = (line: string): TranscriptEvent[] => {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (json?.v === 2 && typeof json.type === 'string') return [json as TranscriptEvent];
  if (Array.isArray(json?.messages)) return eventsFromLegacyTurn(json as LegacyTurn);
  return [];
};
