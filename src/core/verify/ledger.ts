import type { TranscriptEvent } from '../transcript/events.js';
import type { GateTier } from './gates.js';

export type GateStatus = 'passed' | 'failed' | 'skipped';

/** One gate run, as the session log records it. */
export interface GateRow {
  tier: GateTier;
  name: string;
  command: string;
  /** The working copy it ran on: the checkpoint's after tree. */
  tree?: string;
  status: GateStatus;
  durationMs: number;
  step?: number;
  /** The model ran it itself, and the harness recognized the command. */
  byModel?: boolean;
  ts: number;
}

const short = (tree: string | undefined) => (tree ? tree.slice(0, 7) : 'no tree');

/**
 * Which gates ran on which trees: a projection of the log's gate events, so a resumed
 * session knows what already passed. Keyed by tree, never by time or file list.
 */
export class Ledger {
  private rows: GateRow[] = [];

  static fromEvents(events: TranscriptEvent[]): Ledger {
    const ledger = new Ledger();
    for (const event of events) {
      if (event.type !== 'gate') continue;
      ledger.record({ tier: event.tier, name: event.name, command: event.command, tree: event.tree, status: event.status, durationMs: event.durationMs, step: event.step, byModel: event.byModel, ts: event.ts });
    }
    return ledger;
  }

  record(row: GateRow): void {
    this.rows.push(row);
  }

  all(): GateRow[] {
    return [...this.rows];
  }

  /** Whether any run of this tier, passed or not, was made on the tree. */
  has(tree: string, tier: GateTier): boolean {
    return this.rows.some((row) => row.tree === tree && row.tier === tier && row.status !== 'skipped');
  }

  passed(tree: string, tier: GateTier): boolean {
    return this.rows.some((row) => row.tree === tree && row.tier === tier && row.status === 'passed');
  }

  /** How long the gate took the last time it ran to completion. */
  lastDuration(name: string): number | undefined {
    return this.rows.filter((row) => row.name === name && row.status !== 'skipped').at(-1)?.durationMs;
  }

  /** The latest row per gate name, in first-seen order. */
  latest(): GateRow[] {
    const byName = new Map<string, GateRow>();
    for (const row of this.rows) byName.set(row.name, row);
    return [...byName.values()];
  }

  /** One line per gate, as a summary's pinned block and the handoff carry them. */
  tail(): string[] {
    return this.latest().map((row) => `${row.name} ${row.status} on tree ${short(row.tree)}${row.step ? ` at step ${row.step}` : ''}${row.byModel ? ' (run by the model)' : ''}`);
  }
}
