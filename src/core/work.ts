/**
 * What runs beside the turn: background commands and child agents. One table per
 * session owns them, so the person can see and stop them from any surface, and the
 * model hears when one ends without asking.
 */

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
}

export interface WorkEntry<T = unknown> extends WorkItem {
  stop: () => void;
  /** The tool's own record of it, such as a job's process and output. */
  record: T;
  /** Whether the model has been told it ended. */
  told: boolean;
}

/** Ended entries kept for listing, oldest forgotten first. */
const KEEP_ENDED = 20;

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

  constructor() {
    tables.add(this);
    installExitHook();
  }

  add<T>(entry: Omit<WorkEntry<T>, 'startedAt' | 'told' | 'endedAt' | 'outcome'> & { startedAt?: number; told?: boolean }): WorkEntry<T> {
    const full = { startedAt: Date.now(), told: false, ...entry } as WorkEntry<T>;
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
    this.prune();
    this.notify();
  }

  get<T = unknown>(id: string): WorkEntry<T> | undefined {
    return this.entries.get(id) as WorkEntry<T> | undefined;
  }

  /** Forget an entry the model has collected, such as a task whose result was read. */
  forget(id: string): void {
    if (this.entries.delete(id)) this.notify();
  }

  list(): WorkItem[] {
    return [...this.entries.values()].map(({ stop: _stop, record: _record, told: _told, ...item }) => item);
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
    return ended.map(({ stop: _stop, record: _record, told: _told, ...item }) => item);
  }

  private prune(): void {
    const ended = [...this.entries.values()].filter((entry) => entry.endedAt !== undefined && entry.told).sort((a, b) => a.endedAt! - b.endedAt!);
    while (ended.length > KEEP_ENDED) this.entries.delete(ended.shift()!.id);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** One ended entry as the model reads it, naming the tool that has the rest. */
export const workNews = (item: WorkItem): string => {
  const ran = item.endedAt !== undefined ? ` after ${seconds(item.endedAt - item.startedAt)}` : '';
  const read = item.kind === 'job' ? 'Read its output with command_output.' : 'Collect it with task_result.';
  return `${item.id} (${item.label}) ${item.outcome ?? 'ended'}${ran}. ${read}`;
};
