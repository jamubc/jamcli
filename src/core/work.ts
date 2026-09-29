/**
 * What runs beside the turn: background commands and child agents. One table per
 * session owns them, so the person can see and stop them from any surface, and the
 * model hears when one ends without asking.
 */

import { describeCall } from './approval.js';
import type { AgentEvent } from './types.js';

export type WorkKind = 'job' | 'task';

/** One thing running beside the turn, as the person and the model are told of it. */
export interface WorkItem {
  id: string;
  kind: WorkKind;
  /** The command, or the agent and what it was asked. */
  label: string;
  startedAt: number;
  endedAt?: number;
  /** How it ended, in words, once it has. */
  outcome?: string;
  /** A child agent: the agent it runs as, once resolved. */
  agent?: string;
  /** A child agent: the model it runs on, as `provider:model`, once resolved. */
  model?: string;
  /** A child agent: its own session, which holds its whole log. */
  sessionId?: string;
  /** What it is doing right now, in one line: the call it is making, or the last line it said. */
  detail?: string;
  /** Tokens a child agent's requests have used so far. */
  tokens?: number;
  /** What a child agent's requests have cost so far, in US dollars, when each had a known price. */
  cost?: number;
}

export interface WorkEntry<T = unknown> extends WorkItem {
  stop: () => void;
  /** The tool's own record of it, such as a job's process and output. */
  record: T;
  /** Whether the model has been told it ended. */
  told: boolean;
  /** A child agent's events so far, oldest first, bounded, for looking in on it. */
  events: AgentEvent[];
  /** Who hears each further event. */
  taps: Set<(event: AgentEvent) => void>;
  /** What the person watching has said to the child, not yet read by it. */
  said: string[];
}

/** Ended entries kept for listing, oldest forgotten first. */
const KEEP_ENDED = 20;
/** Events kept per child. A viewer opened later sees this much of the past. */
const KEEP_EVENTS = 4_000;
/** How long the table waits to tell its watchers of activity, so streaming does not redraw per token. */
const ACTIVITY_MS = 120;
/** Characters of activity kept on a line. */
const DETAIL_CHARS = 160;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, DETAIL_CHARS);

/** The last line said so far that has words in it. */
const lastLine = (text: string): string | undefined => {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length ? oneLine(lines[lines.length - 1]) : undefined;
};

const tables = new Set<WorkTable>();
let exitHookInstalled = false;
const installExitHook = () => {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const table of tables) table.stopAll();
  });
};

export class WorkTable {
  private readonly entries = new Map<string, WorkEntry>();
  private readonly listeners = new Set<() => void>();
  /** The text a child has said in its current reply, per entry, for its activity line. */
  private readonly said = new Map<string, string>();
  private activityTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    tables.add(this);
    installExitHook();
  }

  add<T>(entry: Omit<WorkEntry<T>, 'startedAt' | 'told' | 'endedAt' | 'outcome' | 'events' | 'taps' | 'said'> & { startedAt?: number; told?: boolean }): WorkEntry<T> {
    const full = { startedAt: Date.now(), told: false, events: [], taps: new Set(), said: [], ...entry } as WorkEntry<T>;
    this.entries.set(full.id, full as WorkEntry);
    this.notify();
    return full;
  }

  /** Mark an entry ended, with how. A second end changes nothing. */
  end(id: string, outcome: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.endedAt !== undefined) return;
    entry.endedAt = Date.now();
    entry.outcome = outcome;
    this.said.delete(id);
    this.prune();
    this.notify();
  }

  /** Set what is known of an entry, such as the agent and model a child resolved to. */
  update(id: string, patch: Partial<Pick<WorkItem, 'agent' | 'model' | 'sessionId' | 'detail' | 'label'>>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    Object.assign(entry, patch);
    this.notify();
  }

  /**
   * Take one of a child's events: keep it for a viewer, hand it to whoever watches the
   * child now, and read its activity, tokens, and cost from it.
   */
  record(id: string, event: AgentEvent): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (event.type !== 'request' && event.type !== 'message') {
      entry.events.push(event);
      if (entry.events.length > KEEP_EVENTS) entry.events.splice(0, entry.events.length - KEEP_EVENTS);
    }
    for (const tap of [...entry.taps]) tap(event);
    let changed = false;
    const detail = (text: string | undefined) => {
      if (text && text !== entry.detail) {
        entry.detail = text;
        changed = true;
      }
    };
    switch (event.type) {
      case 'step_start':
        this.said.set(id, '');
        detail('thinking');
        break;
      case 'reasoning':
        if (!this.said.get(id)) detail('thinking');
        break;
      case 'text': {
        const said = `${this.said.get(id) ?? ''}${event.delta}`;
        this.said.set(id, said);
        detail(lastLine(said));
        break;
      }
      case 'tool_call':
        this.said.set(id, '');
        detail(describeCall(event.call));
        break;
      case 'approval_request':
        detail(`asking to ${describeCall(event.call)}`);
        break;
      case 'usage':
        entry.tokens = (entry.tokens ?? 0) + (event.usage.total_tokens || (event.usage.prompt_tokens || 0) + (event.usage.completion_tokens || 0));
        if (event.cost !== undefined) entry.cost = (entry.cost ?? 0) + event.cost;
        changed = true;
        break;
      case 'notice':
        if (event.level !== 'info') detail(`${event.level}: ${oneLine(event.message)}`);
        break;
      case 'retry':
        detail(`retrying: ${oneLine(event.reason)}`);
        break;
      default:
        break;
    }
    if (changed) this.notifySoon();
  }

  /**
   * Say something to a running child. It reads it with its next step's results, so the
   * person can steer or question it while it works. False when nothing by that id runs.
   */
  say(id: string, text: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.endedAt !== undefined) return false;
    entry.said.push(text);
    // Whoever looks in on the child sees what was said, where it was said.
    this.record(id, { type: 'notice', level: 'info', message: `You said: ${text}` });
    return true;
  }

  /** What was said to a child since it last read, each once. */
  drainSaid(id: string): string[] {
    const entry = this.entries.get(id);
    return entry ? entry.said.splice(0) : [];
  }

  /** A child's events so far, oldest first. Nothing for an unknown id. */
  events(id: string): AgentEvent[] {
    return [...(this.entries.get(id)?.events ?? [])];
  }

  /** Hear each further event of one child; returns how to stop. Nothing to hear for an unknown id. */
  watchEvents(id: string, listener: (event: AgentEvent) => void): () => void {
    const entry = this.entries.get(id);
    if (!entry) return () => undefined;
    entry.taps.add(listener);
    return () => entry.taps.delete(listener);
  }

  get<T = unknown>(id: string): WorkEntry<T> | undefined {
    return this.entries.get(id) as WorkEntry<T> | undefined;
  }

  /**
   * Mark an ended entry the model has collected, such as a task whose result was read, so it
   * is not told of it again. It stays listed, for the person to see how it ended and to look
   * in, until the board's window and the table's cap drop it; a running entry is unchanged.
   */
  collect(id: string): void {
    const entry = this.entries.get(id);
    if (!entry || entry.endedAt === undefined || entry.told) return;
    entry.told = true;
    this.prune();
    this.notify();
  }

  list(): WorkItem[] {
    return [...this.entries.values()].map(itemOf);
  }

  running(kind?: WorkKind): number {
    return [...this.entries.values()].filter((entry) => entry.endedAt === undefined && (!kind || entry.kind === kind)).length;
  }

  /** Ask one entry to stop. False when there is no such entry, or it has ended. It ends when its tool reports so. */
  stop(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.endedAt !== undefined) return false;
    entry.stop();
    return true;
  }

  stopAll(): void {
    for (const entry of this.entries.values()) if (entry.endedAt === undefined) entry.stop();
  }

  /** Called whenever an entry is added, ends, or is forgotten; returns how to stop. */
  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The entries that ended and were not yet told, each once. */
  drainEnded(): WorkItem[] {
    const ended = [...this.entries.values()].filter((entry) => entry.endedAt !== undefined && !entry.told);
    for (const entry of ended) entry.told = true;
    return ended.map(itemOf);
  }

  private prune(): void {
    const ended = [...this.entries.values()].filter((entry) => entry.endedAt !== undefined && entry.told).sort((a, b) => a.endedAt! - b.endedAt!);
    while (ended.length > KEEP_ENDED) this.entries.delete(ended.shift()!.id);
  }

  private notify(): void {
    if (this.activityTimer) {
      clearTimeout(this.activityTimer);
      this.activityTimer = undefined;
    }
    for (const listener of [...this.listeners]) listener();
  }

  /** Tell the watchers once activity has settled for a moment, not once per token. */
  private notifySoon(): void {
    if (this.activityTimer) return;
    this.activityTimer = setTimeout(() => {
      this.activityTimer = undefined;
      for (const listener of [...this.listeners]) listener();
    }, ACTIVITY_MS);
  }
}

/** An entry as the person and the model see it: without what only its tool needs. */
const itemOf = ({ stop: _stop, record: _record, told: _told, events: _events, taps: _taps, said: _said, ...item }: WorkEntry): WorkItem => item;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** One ended entry as the model reads it, naming the tool that has the rest. */
export const workNews = (item: WorkItem): string => {
  const ran = item.endedAt !== undefined ? ` after ${seconds(item.endedAt - item.startedAt)}` : '';
  const read = item.kind === 'job' ? 'Read its output with command_output.' : 'Collect it with task_result.';
  return `${item.id} (${item.label}) ${item.outcome ?? 'ended'}${ran}. ${read}`;
};
