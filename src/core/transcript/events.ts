import type { ToolDefinition } from '../providers/types.js';
import type { ApprovalScope, ChatMessage, RunStatus, TokenUsage } from '../types.js';

/**
 * A session is an append-only log of these events, one JSON object per line with
 * `"v":2`. Provider requests, resumes, forks, exports, and ACP replays are projections
 * of the log, so the log is the only record that has to be right.
 */
/** What the trust gate made of one result, as logs written before its removal record it. */
export interface ScreenedResult {
  tool: string;
  verdict?: { relevance: number; injection: boolean; reason?: string };
  withheld: boolean;
  /** For a duplicate that was not sent: the index of the result whose verdict it took. */
  duplicateOf?: number;
}

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
      /** What the prompt named, as its summary; written since 2026-09-29, for a child's call above all. */
      target?: string;
      allow: boolean;
      scope: ApprovalScope;
      by: string;
      surface: string;
      rule?: string;
      /** Where the deciding rule came from; absent in logs written before 2026-09-29. */
      source?: string;
      feedback?: string;
      reason?: string;
    }
  | {
      v: 2;
      type: 'usage';
      ts: number;
      model?: string;
      usage: TokenUsage;
      /** US dollars, priced when the request was made. Absent when the price was unknown. */
      cost?: number;
      /** The delegated session that made the request, when this session did not. */
      delegated?: string;
    }
  | { v: 2; type: 'notice'; ts: number; level: 'info' | 'warn' | 'error'; message: string; code?: string; detail?: string }
  /**
   * A flag the person planted with `/note`: a tester's remark about this point in the
   * session, for people reading it back. It is never sent to the model.
   */
  | { v: 2; type: 'note'; ts: number; text: string }
  /**
   * What the person typed in the composer, as they typed it (a paste in full, a slash or
   * shell line as written), and whether it was sent or cleared away unsent. It is the record
   * that recall and history search read, and it is never sent to the model.
   */
  | { v: 2; type: 'prompt'; ts: number; text: string; state: 'sent' | 'cleared' }
  /**
   * What requests carry besides the conversation, as sent: the system prompt and the tool
   * definitions. Written when they differ from the last recorded, so it holds for every
   * request after it until the next one.
   */
  | { v: 2; type: 'context'; ts: number; system?: string; tools?: ToolDefinition[] }
  /** One trust-gate request, in logs written before the gate was removed on 2026-09-29: what the classifier was sent, what it answered or why it failed, and each result's fate. */
  | { v: 2; type: 'screening'; ts: number; model?: string; sent?: string; answered?: string; error?: string; results: ScreenedResult[] }
  | { v: 2; type: 'model'; ts: number; from?: string; to: string }
  | { v: 2; type: 'permission_mode'; ts: number; from: string; to: string }
  | {
      v: 2;
      type: 'compaction';
      ts: number;
      summary: string;
      replaced: number;
      before: number;
      after: number;
      /** Absent in logs written before 4.3, which only summarized. */
      strategy?: 'summary' | 'drop';
      trigger?: 'auto' | 'manual';
    }
  | {
      v: 2;
      type: 'checkpoint';
      ts: number;
      /** A commit on the session's private ref, or a backup directory outside a repository. */
      ref: string;
      /** Outside a repository: the files backed up, relative to the project. */
      files?: string[];
      /** In a repository: the working copy once the step was done, so a restore touches only what it changed. */
      after?: string;
      /** What was about to change it, such as `edit src/a.ts`. */
      label?: string;
      /** The index, among events after the header, of the message that began the turn. */
      turn?: number;
    }
  /** A gate ran on a tree, by the harness or by the model. `shaped` is what the model read of it. */
  | {
      v: 2;
      type: 'gate';
      ts: number;
      tier: 'T0' | 'T1' | 'T2' | 'T3';
      name: string;
      command: string;
      tree?: string;
      status: 'passed' | 'failed' | 'skipped';
      durationMs: number;
      step?: number;
      byModel?: boolean;
      shaped?: string;
    }
  /** An older tool result, at `message` in the conversation as it then stood, became `stub` before any summary. */
  | { v: 2; type: 'elision'; ts: number; stage: string; message: number; tokensRemoved: number; stub: string }
  /** The harness steered the turn, and how. */
  | { v: 2; type: 'steer'; ts: number; handler: string; callId?: string; detail: string }
  /** The handoff file was rendered from this log. */
  | { v: 2; type: 'handoff'; ts: number; path: string; bytes: number; reason: 'session_end' | 'reset' | 'drop' }
  | {
      v: 2;
      type: 'end';
      ts: number;
      status: RunStatus;
      /** The session so far: what its requests carried, how much of it the provider had cached, and how the harness intervened. */
      summary?: { promptTokens: number; cachedTokens: number; cacheBreaks: number; gates: number; steers: number };
    };

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
