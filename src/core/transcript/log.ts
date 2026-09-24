import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { ChatMessage, JamSession, TokenUsage } from '../types.js';
import { createSession } from '../state.js';
import type { TranscriptEvent } from './events.js';
import { projectMessages, readTranscript } from './read.js';
import { historyDirFor, recordSessionSummary, sessionFileFor } from './sessions.js';
import { JAMCLI_VERSION } from '../version.js';

type Distribute<T> = T extends unknown ? Omit<T, 'v' | 'ts'> & { ts?: number } : never;
export type NewTranscriptEvent = Distribute<TranscriptEvent>;

const GITIGNORE = '# Created by JamCLI. This directory holds local state and is never committed.\n*\n';

/**
 * The project's `.jamcli` directory, created on first use with a `.gitignore` that
 * ignores the directory itself, so it stays out of any repository it lands in.
 */
export function ensureProjectStateDir(projectRoot: string): string {
  const dir = path.join(projectRoot, '.jamcli');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitignore'), GITIGNORE);
  }
  return dir;
}

export const newSessionId = (): string => `${new Date().toISOString().slice(0, 10)}-${randomUUID().split('-')[0]}`;

/** A message as it is stored: display-only state such as `streaming` is dropped. */
const stored = (message: ChatMessage): ChatMessage => {
  const { streaming: _streaming, ...rest } = message;
  return rest;
};

const addTo = (total: TokenUsage, usage: TokenUsage): TokenUsage => ({
  prompt_tokens: total.prompt_tokens + (usage.prompt_tokens || 0),
  completion_tokens: total.completion_tokens + (usage.completion_tokens || 0),
  total_tokens: total.total_tokens + (usage.total_tokens || 0),
});

interface CreateOptions {
  id?: string;
  cwd?: string;
  surface: string;
  parent?: { session: string; event: number };
  delegatedBy?: string;
  permissionMode?: string;
}

/**
 * One session's append-only log under `.jamcli/history/<id>.jsonl`. The header is
 * written with the first real event, so a session nobody used leaves no file behind.
 */
export class SessionLog {
  private headerPending: NewTranscriptEvent | null;
  private readonly createdAt = Date.now();

  private constructor(
    readonly projectRoot: string,
    readonly id: string,
    header: NewTranscriptEvent | null
  ) {
    this.headerPending = header;
  }

  get file(): string {
    return sessionFileFor(this.projectRoot, this.id);
  }

  static create(projectRoot: string, options: CreateOptions): SessionLog {
    const id = options.id ?? newSessionId();
    return new SessionLog(projectRoot, id, {
      type: 'session',
      id,
      projectRoot,
      cwd: options.cwd ?? projectRoot,
      surface: options.surface,
      jamcli: JAMCLI_VERSION,
      ...(options.parent ? { parent: options.parent } : {}),
      ...(options.delegatedBy ? { delegatedBy: options.delegatedBy } : {}),
      ...(options.permissionMode ? { permissionMode: options.permissionMode } : {}),
    });
  }

  /** Open an existing session to read or continue it. */
  static open(projectRoot: string, id: string): SessionLog {
    if (!SessionLog.exists(projectRoot, id)) {
      throw new Error(`No session named ${id} in ${historyDirFor(projectRoot)}.`);
    }
    return new SessionLog(projectRoot, id, null);
  }

  /** Continue a session if it has a file, or start it under that id if it does not. */
  static openOrCreate(projectRoot: string, id: string, options: Omit<CreateOptions, 'id'>): SessionLog {
    return SessionLog.exists(projectRoot, id) ? SessionLog.open(projectRoot, id) : SessionLog.create(projectRoot, { ...options, id });
  }

  static exists(projectRoot: string, id: string): boolean {
    return fs.existsSync(sessionFileFor(projectRoot, id));
  }

  /**
   * Copy a session's events, up to an index, into a new session whose header names its
   * parent. The source file is not touched.
   */
  static fork(projectRoot: string, sourceId: string, options: { atEvent?: number; surface: string }): SessionLog {
    const events = SessionLog.open(projectRoot, sourceId)
      .events()
      .filter((event) => event.type !== 'session');
    const cut = options.atEvent === undefined ? events.length : Math.max(0, Math.min(options.atEvent, events.length));
    const fork = SessionLog.create(projectRoot, { surface: options.surface, parent: { session: sourceId, event: cut } });
    for (const event of events.slice(0, cut)) {
      const { v: _v, ...rest } = event;
      fork.append(rest as NewTranscriptEvent);
    }
    fork.updateIndex();
    return fork;
  }

  append(event: NewTranscriptEvent): void {
    const lines: string[] = [];
    if (this.headerPending) {
      ensureProjectStateDir(this.projectRoot);
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      lines.push(JSON.stringify({ v: 2, ts: this.createdAt, ...this.headerPending }));
      this.headerPending = null;
    }
    const body = event.type === 'message' ? { ...event, message: stored(event.message) } : event;
    lines.push(JSON.stringify({ v: 2, ts: event.ts ?? Date.now(), ...body }));
    fs.appendFileSync(this.file, `${lines.join('\n')}\n`, 'utf8');
  }

  events(): TranscriptEvent[] {
    return readTranscript(this.file);
  }

  messages(): ChatMessage[] {
    return projectMessages(this.events());
  }

  /** Rebuild the in-memory session: its conversation and its usage by model. */
  toSession(): JamSession {
    const events = this.events();
    const session = createSession(this.projectRoot, this.id);
    session.messages = projectMessages(events);
    for (const event of events) {
      // A delegated session's requests are its own conversation's; they count toward cost, not this context.
      if (event.type !== 'usage' || event.delegated) continue;
      session.usage = addTo(session.usage, event.usage);
      if (event.model) {
        const current = session.modelUsage[event.model] ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        session.modelUsage[event.model] = addTo(current, event.usage);
      }
    }
    return session;
  }

  /** Record this session in the global index that session pickers and `jamcli sessions` read. */
  updateIndex(): void {
    recordSessionSummary(this.projectRoot, this.id, this.events());
  }
}
