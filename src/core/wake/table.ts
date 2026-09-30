import type { TranscriptEvent } from '../transcript/events.js';

/** A prompt a session runs later: when a time comes, or when named sessions have all raised a flag. */
export interface Wake {
  id: string;
  prompt: string;
  /** Epoch ms it goes off at. */
  at?: number;
  /** Session ids that must each have `flag` raised. */
  when?: { sessions: string[]; flag: string };
  by: 'person' | 'model';
  /** Epoch ms it was set. */
  setAt: number;
}

/** A wake that went off, with the line that tells the model why. */
export interface FiredWake extends Wake {
  /** What the model reads: the harness's bracketed line, then the prompt. */
  text: string;
  /** What a person reads in place of that, as the message's display. */
  display: string;
}

export interface WakeSpec {
  prompt: string;
  afterSeconds?: number;
  /** Session references, as ids or names, and the flag each must raise. */
  when?: { sessions: string[]; flag: string };
  by: 'person' | 'model';
}

type WakeFact = { type: 'wake'; id: string; action: 'set' | 'cancel' | 'fire' | 'missed'; prompt?: string; at?: number; when?: { sessions: string[]; flag: string }; by?: 'person' | 'model' };

export interface WakeTableOptions {
  /** Append a `wake` event to the session log. */
  record(fact: WakeFact): void;
  /** A session reference as an id, or why it names none. */
  resolve(ref: string): { id: string } | { error: string };
  /** The flags a session has raised. */
  flags(session: string): Record<string, number>;
  /** Called whenever the pending wakes change. */
  changed?(): void;
  now?: () => number;
  /** How often what is due is checked. */
  intervalMs?: number;
}

export const WAKE_LIMITS = { minSeconds: 1, maxSeconds: 7 * 24 * 60 * 60, pending: 20 };

/** How often what is due is checked: a few small flag files read, so often is cheap. */
const CHECK_MS = 250;

const ago = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(0, Math.round(ms / 1000))} seconds ago`;
  if (minutes < 120) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  return `${Math.round(minutes / 60)} hours ago`;
};

/** A duration as a person writes one: `90`, `90s`, `10m`, `2h`, `1d`, or a sum such as `1h30m`. Seconds, or nothing. */
export function parseDuration(text: string): number | undefined {
  const trimmed = text.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // Longest words first, so `days` is not read as `d` and a stray `ays`.
  const parts = [...trimmed.matchAll(/(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)/g)];
  if (!parts.length || parts.map((part) => part[0]).join('').replace(/\s+/g, '') !== trimmed.replace(/\s+/g, '')) return undefined;
  const unit = (word: string) => (word.startsWith('d') ? 86_400 : word.startsWith('h') ? 3_600 : word.startsWith('m') ? 60 : 1);
  return parts.reduce((sum, part) => sum + Number(part[1]) * unit(part[2]), 0);
}

/** A wake as one line, for lists. */
export function describeWake(wake: Wake, now: number): string {
  const trigger = wake.at !== undefined ? `in ${Math.max(0, Math.ceil((wake.at - now) / 1000))} s` : `when ${wake.when!.sessions.join(', ')} raise ${wake.when!.flag}`;
  return `${wake.id}: ${trigger}, set by ${wake.by === 'person' ? 'the person' : 'the model'}: ${wake.prompt.replace(/\s+/g, ' ').slice(0, 120)}`;
}

/**
 * A session's wakes. Setting, cancelling, going off, and being missed are each recorded,
 * so a resumed session rebuilds the table from its log. What is due is checked four times
 * a second while anything is pending and something listens; with nobody to run it, a wake
 * waits.
 */
export class WakeTable {
  private readonly pending = new Map<string, Wake>();
  private readonly listeners = new Set<(wake: FiredWake) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private counter = 0;
  private readonly now: () => number;

  constructor(private readonly options: WakeTableOptions) {
    this.now = options.now ?? Date.now;
  }

  list(): Wake[] {
    return [...this.pending.values()];
  }

  set(spec: WakeSpec): { wake: Wake } | { error: string } {
    const prompt = spec.prompt.trim();
    if (!prompt) return { error: 'A wake needs a prompt to run.' };
    if ((spec.afterSeconds === undefined) === (spec.when === undefined)) return { error: 'A wake waits for a time or for flags: give one of the two.' };
    if (this.pending.size >= WAKE_LIMITS.pending) return { error: `${WAKE_LIMITS.pending} wakes are pending already; cancel one first.` };
    const now = this.now();
    let at: number | undefined;
    let when: Wake['when'];
    if (spec.afterSeconds !== undefined) {
      const seconds = spec.afterSeconds;
      if (!Number.isFinite(seconds) || seconds < WAKE_LIMITS.minSeconds || seconds > WAKE_LIMITS.maxSeconds) return { error: 'A timer runs from 1 second to 7 days.' };
      at = now + Math.round(seconds * 1000);
    } else {
      const refs = [...new Set(spec.when!.sessions.map((ref) => ref.trim()).filter(Boolean))];
      if (!refs.length) return { error: 'A flag wait names at least one session.' };
      const ids: string[] = [];
      for (const ref of refs) {
        const resolved = this.options.resolve(ref);
        if ('error' in resolved) return { error: resolved.error };
        ids.push(resolved.id);
      }
      when = { sessions: [...new Set(ids)], flag: spec.when!.flag };
    }
    this.counter += 1;
    const wake: Wake = { id: `w${this.counter}`, prompt, ...(at !== undefined ? { at } : {}), ...(when ? { when } : {}), by: spec.by, setAt: now };
    this.pending.set(wake.id, wake);
    this.options.record({ type: 'wake', id: wake.id, action: 'set', prompt, ...(at !== undefined ? { at } : {}), ...(when ? { when } : {}), by: spec.by });
    this.update();
    return { wake };
  }

  /** Remove a wake by id, or every one with `all`. Returns what was removed. */
  cancel(id: string): Wake[] {
    const removed = id === 'all' ? this.list() : this.pending.has(id) ? [this.pending.get(id)!] : [];
    for (const wake of removed) {
      this.pending.delete(wake.id);
      this.options.record({ type: 'wake', id: wake.id, action: 'cancel' });
    }
    if (removed.length) this.update();
    return removed;
  }

  /** Hear each wake as it goes off; returns how to stop. */
  onFire(listener: (wake: FiredWake) => void): () => void {
    this.listeners.add(listener);
    this.update();
    return () => {
      this.listeners.delete(listener);
      this.update();
    };
  }

  /**
   * Rebuild from a resumed session's log. Wakes still ahead are pending again; a timer
   * that came due while the session was closed is recorded as missed and not run. Returns
   * what to tell the person.
   */
  restore(events: TranscriptEvent[]): string[] {
    for (const event of events) {
      if (event.type !== 'wake') continue;
      this.counter = Math.max(this.counter, Number(event.id.slice(1)) || 0);
      if (event.action === 'set' && event.prompt) {
        this.pending.set(event.id, { id: event.id, prompt: event.prompt, ...(event.at !== undefined ? { at: event.at } : {}), ...(event.when ? { when: event.when } : {}), by: event.by ?? 'person', setAt: event.ts });
      } else this.pending.delete(event.id);
    }
    const now = this.now();
    const told: string[] = [];
    for (const wake of this.list()) {
      if (wake.at === undefined || wake.at > now) continue;
      this.pending.delete(wake.id);
      this.options.record({ type: 'wake', id: wake.id, action: 'missed' });
      told.push(`Wake ${wake.id} came due while this session was closed, so it did not run: ${wake.prompt.slice(0, 120)}`);
    }
    this.update();
    return told;
  }

  /** Fire what is due now. */
  check(): void {
    if (!this.listeners.size) return;
    const now = this.now();
    for (const wake of this.list()) {
      const reason = this.dueReason(wake, now);
      if (!reason) continue;
      this.pending.delete(wake.id);
      this.options.record({ type: 'wake', id: wake.id, action: 'fire' });
      const setter = wake.by === 'person' ? 'the person' : 'the model';
      const fired: FiredWake = {
        ...wake,
        text: `[Wake ${wake.id} went off: ${reason}. ${setter[0].toUpperCase()}${setter.slice(1)} set it ${ago(now - wake.setAt)}. Its prompt follows.]\n\n${wake.prompt}`,
        display: `⏰ ${wake.id} · ${wake.prompt}`,
      };
      for (const listener of [...this.listeners]) listener(fired);
    }
    this.update();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  private dueReason(wake: Wake, now: number): string | undefined {
    if (wake.at !== undefined) return wake.at <= now ? 'its timer ran out' : undefined;
    const { sessions, flag } = wake.when!;
    if (!sessions.every((session) => this.options.flags(session)[flag] !== undefined)) return undefined;
    return `${sessions.join(' and ')} ${sessions.length === 1 ? 'has' : 'have'} raised ${flag}`;
  }

  private update(): void {
    const ticking = this.pending.size > 0 && this.listeners.size > 0;
    if (ticking && !this.timer) {
      this.timer = setInterval(() => this.check(), this.options.intervalMs ?? CHECK_MS);
      // A pending wake alone does not keep the process alive; a surface that waits on one holds it.
      this.timer.unref?.();
    } else if (!ticking && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.options.changed?.();
  }
}
