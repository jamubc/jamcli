import fs from 'fs';
import path from 'path';
import type { ChatMessage } from '../types.js';
import {
  SessionLog,
  ensureProjectStateDir,
  listSessionSummaries,
  searchSessionSummaries,
  transcriptToMarkdown,
  type SessionSummary,
} from '../transcript/index.js';

export type { SessionSummary };

/** This project's sessions, newest first. */
export const listSessions = async (projectRoot: string, limit = 20): Promise<SessionSummary[]> =>
  listSessionSummaries(projectRoot, limit);

/** The most recently updated session of this project, for `--continue`. */
export const latestSessionId = async (projectRoot: string): Promise<string | null> =>
  listSessionSummaries(projectRoot, 1)[0]?.id ?? null;

export const searchSessions = async (projectRoot: string, query: string, limit = 20): Promise<SessionSummary[]> =>
  searchSessionSummaries(projectRoot, query, limit);

/** A session's conversation with its tool calls and results; empty if there is no such session. */
export const loadSessionMessages = async (projectRoot: string, sessionId: string): Promise<ChatMessage[]> =>
  SessionLog.exists(projectRoot, sessionId) ? SessionLog.open(projectRoot, sessionId).messages() : [];

/** The session rendered as Markdown. Throws if there is no such session. */
export const renderSession = async (projectRoot: string, sessionId: string): Promise<string> =>
  transcriptToMarkdown(SessionLog.open(projectRoot, sessionId).events(), { id: sessionId });

/** Write the Markdown rendering next to the session file and return its path. */
export const exportSession = async (projectRoot: string, sessionId: string): Promise<string> => {
  const markdown = await renderSession(projectRoot, sessionId);
  ensureProjectStateDir(projectRoot);
  const file = path.join(path.dirname(SessionLog.open(projectRoot, sessionId).file), `${sessionId}.md`);
  fs.writeFileSync(file, markdown, 'utf8');
  return file;
};

/**
 * Copy a session into a new one that names it as its parent, and return the new id.
 * Returns null when the source has no messages to copy.
 */
export const forkSession = async (
  projectRoot: string,
  sourceId: string,
  options: { atEvent?: number; surface?: string } = {}
): Promise<string | null> => {
  if (!(await loadSessionMessages(projectRoot, sourceId)).length) return null;
  return SessionLog.fork(projectRoot, sourceId, { atEvent: options.atEvent, surface: options.surface ?? 'tui' }).id;
};
