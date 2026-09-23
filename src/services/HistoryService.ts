import fs from 'fs-extra';
import path from 'path';
import { Message, TokenUsage } from '../core/types.js';
import {
  SessionLog,
  ensureProjectStateDir,
  listSessionSummaries,
  newSessionId,
  projectMessages,
  readTranscript,
  searchSessionSummaries,
  transcriptToMarkdown,
  type LegacyTurn,
  type SessionSummary,
} from '../core/transcript/index.js';

export type SessionMetadata = SessionSummary;

/** A version 1 history line. New turns are written as version 2 events. */
export type ConversationTurn = LegacyTurn;

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  callCount: number;
}

/**
 * The interface's view of one session's history until the interface moves onto the
 * runtime. Reading, writing, and the index all go through the transcript module, so
 * version 1, version 2, and mixed files load the same way everywhere.
 */
export class HistoryService {
  private projectRoot: string;
  private sessionId: string;
  private sessionUsage: SessionUsage;
  private log: SessionLog;
  private disabled: boolean;

  constructor(projectRoot: string = process.cwd(), sessionId?: string) {
    this.projectRoot = projectRoot;
    this.sessionId = sessionId || newSessionId();
    this.sessionUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      callCount: 0,
    };
    this.disabled = false;
    this.log = SessionLog.openOrCreate(projectRoot, this.sessionId, { surface: 'tui' });
  }

  /** Nothing is created until the first turn is written. */
  async initialize(): Promise<void> {}

  getSessionId(): string {
    return this.sessionId;
  }

  getSessionUsage(): SessionUsage {
    return { ...this.sessionUsage };
  }

  updateUsage(usage?: TokenUsage): void {
    if (this.disabled) return;
    if (!usage) return;

    this.sessionUsage.promptTokens += usage.prompt_tokens || 0;
    this.sessionUsage.completionTokens += usage.completion_tokens || 0;
    this.sessionUsage.totalTokens += usage.total_tokens || 0;
    this.sessionUsage.callCount += 1;
  }

  async appendTurn(messages: Message[], usage?: TokenUsage): Promise<void> {
    if (this.disabled) return;
    this.updateUsage(usage);
    const model = messages.find((message) => message.model)?.model;
    try {
      for (const message of messages) this.log.append({ type: 'message', message });
      if (usage) this.log.append({ type: 'usage', ...(model ? { model } : {}), usage });
      this.log.updateIndex();
    } catch (error) {
      this.disabled = true;
      console.error('History disabled (failed to append turn):', error);
    }
  }

  async loadMessagesFromHistory(maxMessages?: number): Promise<Message[]> {
    if (this.disabled) return [];
    let messages: Message[];
    try {
      messages = projectMessages(readTranscript(this.log.file));
    } catch (error) {
      console.error(`Error loading history for session ${this.sessionId}:`, error);
      return [];
    }
    if (!maxMessages || messages.length <= maxMessages) return messages;
    // Never start with a tool result whose call was cut off.
    let start = messages.length - maxMessages;
    while (start < messages.length && messages[start].role === 'tool') start += 1;
    return messages.slice(start);
  }

  /** This project's sessions, newest first. */
  async listSessions(limit = 20): Promise<SessionMetadata[]> {
    return listSessionSummaries(this.projectRoot, limit);
  }

  async searchSessions(query: string, limit = 20): Promise<SessionMetadata[]> {
    return searchSessionSummaries(this.projectRoot, query, limit);
  }

  async exportToMarkdown(): Promise<string> {
    return transcriptToMarkdown(readTranscript(this.log.file), { id: this.sessionId });
  }

  async saveMarkdownExport(): Promise<string> {
    const markdown = await this.exportToMarkdown();
    ensureProjectStateDir(this.projectRoot);
    const exportPath = path.join(path.dirname(this.log.file), `${this.sessionId}.md`);
    await fs.ensureDir(path.dirname(exportPath));
    await fs.writeFile(exportPath, markdown, 'utf-8');
    return exportPath;
  }
}
