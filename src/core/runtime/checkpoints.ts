import { describeCall } from '../approval.js';
import { CheckpointStore, filesOfCall, type Checkpoint, type RestorePreview } from '../git/checkpoints.js';
import type { TranscriptEvent } from '../transcript/index.js';
import type { ToolCall } from '../types.js';

/** A checkpoint as the session log records it, numbered from 1. */
export interface CheckpointInfo extends Checkpoint {
  n: number;
  label: string;
  ts: number;
  /** Where the turn that made the change began, for forking the conversation back to it. */
  turn?: number;
}

export interface SessionCheckpointsOptions {
  /** Where the tools work: the working copy that is checkpointed. */
  workRoot: string;
  sessionId: string;
  /** The session log's events, where every checkpoint is recorded. */
  events: () => TranscriptEvent[];
  /** Record a checkpoint in the session log. */
  record: (checkpoint: { ref: string; files?: string[]; after?: string; label: string }) => void;
  /** Tell the person something went wrong, when a turn is there to show it. */
  warn: (message: string) => void;
  /** Whether a turn is running, which a restore or a person's change waits for. */
  busy: () => boolean;
}

/**
 * The session's checkpoints: one taken before a step's first change and recorded once the
 * step is done, a person's change taken between two of them, and a restore to any of them.
 * It owns what verification and steering key on: the tree the last changing step left, and
 * whether the running turn changed anything.
 */
export class SessionCheckpoints {
  private readonly store: CheckpointStore;
  private failed = false;
  /** The step's checkpoint, taken before its first change and recorded once the step is done. */
  private pending: { taken: Checkpoint; label: string } | undefined;
  private tree: string | undefined;
  private changed = false;

  constructor(private readonly options: SessionCheckpointsOptions) {
    this.store = new CheckpointStore(options.workRoot, options.sessionId);
  }

  /** The working copy the last changing step left, as its checkpoint keyed it. */
  get lastTree(): string | undefined {
    return this.tree;
  }

  /** Whether the running turn changed the working copy. */
  get changedThisTurn(): boolean {
    return this.changed;
  }

  /** A turn begins, and nothing it did has changed the working copy yet. */
  startTurn(): void {
    this.changed = false;
  }

  /** Before a step's first change: a checkpoint of the working copy. */
  async take(call: ToolCall): Promise<void> {
    if (this.failed) return;
    const label = describeCall(call);
    try {
      const taken = await this.store.take(label, filesOfCall(call, this.options.workRoot));
      this.pending = taken ? { taken, label } : undefined;
    } catch (error) {
      this.off(error);
    }
  }

  /** Once the step is done: what it changed, recorded in the log; a step that changed nothing leaves no checkpoint. */
  async settle(): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return;
    try {
      const after = await this.store.settle(pending.taken, pending.label);
      if (pending.taken.kind === 'git' && !after) return;
      const { taken, label } = pending;
      this.tree = after ?? taken.ref;
      this.changed = true;
      this.options.record({ ref: taken.ref, ...(taken.files ? { files: taken.files } : {}), ...(after ? { after } : {}), label });
    } catch (error) {
      this.off(error);
    }
  }

  /** The checkpoints the session log holds, oldest first. */
  list(): CheckpointInfo[] {
    return this.options
      .events()
      .filter((event): event is Extract<TranscriptEvent, { type: 'checkpoint' }> => event.type === 'checkpoint')
      .map((event, index) => ({
        n: index + 1,
        ref: event.ref,
        kind: event.files ? 'files' : 'git',
        ...(event.files ? { files: event.files } : {}),
        ...(event.after ? { after: event.after } : {}),
        label: event.label ?? 'a change',
        ts: event.ts,
        ...(event.turn !== undefined ? { turn: event.turn } : {}),
      }));
  }

  /** What restoring checkpoint `n` would change in the working copy. */
  async preview(n: number): Promise<RestorePreview> {
    return this.store.preview(this.numbered(n));
  }

  /** Put the working copy back as checkpoint `n` found it; what the restore replaces is checkpointed too, so it can be undone. */
  async restore(n: number): Promise<string[]> {
    const target = this.numbered(n);
    return this.withCheckpoint(`before restoring checkpoint ${n}`, () => this.store.restore(target), target.files ?? []);
  }

  /** A change the person asked for, between two checkpoints, recorded like a step's. */
  async withCheckpoint<T>(label: string, change: () => Promise<T>, files: string[] = []): Promise<T> {
    if (this.options.busy()) throw new Error('A turn is running; wait for it to end.');
    const before = await this.store.take(label, files);
    const result = await change();
    const after = before ? await this.store.settle(before, label) : undefined;
    if (before && (before.kind === 'files' || after)) this.options.record({ ref: before.ref, ...(before.files ? { files: before.files } : {}), ...(after ? { after } : {}), label });
    return result;
  }

  private numbered(n: number): CheckpointInfo {
    const found = this.list().find((entry) => entry.n === n);
    if (!found) throw new Error(`This session has no checkpoint ${n}.`);
    return found;
  }

  private off(error: unknown): void {
    this.failed = true;
    this.pending = undefined;
    this.options.warn(`Checkpoints are off for this session, so /undo cannot restore its changes: ${(error as Error)?.message ?? error}`);
  }
}
