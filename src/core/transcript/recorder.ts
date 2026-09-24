import type { AgentEvent } from '../types.js';
import type { NewTranscriptEvent, SessionLog } from './log.js';

export interface TranscriptRecorderOptions {
  /** The surface recorded with each decision: `cli`, `acp`, `tui`, or `task`. */
  surface: string;
  /** The model usage is attributed to until `switchModel` is called. */
  model?: string;
  /** Called once if the log cannot be written; recording stops after that. */
  onError?: (error: Error) => void;
}

/**
 * Writes engine events to a session log as they happen: every message, approval
 * decision, usage report, notice, and turn end. Nothing is written until the session
 * has its first message, so a run that fails before it starts leaves no file.
 */
export class TranscriptRecorder {
  private model: string | undefined;
  private started: boolean;
  private failed = false;
  private readonly pending: NewTranscriptEvent[] = [];
  /** Events in the log after its header, as a fork counts them. */
  private written: number;
  /** Where the message that began the current turn is, in that count. */
  private turnStart: number | undefined;

  constructor(
    readonly log: SessionLog,
    private readonly options: TranscriptRecorderOptions
  ) {
    this.model = options.model;
    const events = log.events();
    this.started = events.some((event) => event.type === 'message');
    this.written = events.filter((event) => event.type !== 'session').length;
  }

  /** Record a checkpoint taken during the current turn, with where that turn began. */
  recordCheckpoint(checkpoint: { ref: string; files?: string[]; after?: string; label: string }): void {
    this.write({
      type: 'checkpoint',
      ref: checkpoint.ref,
      ...(checkpoint.files ? { files: checkpoint.files } : {}),
      ...(checkpoint.after ? { after: checkpoint.after } : {}),
      label: checkpoint.label,
      ...(this.turnStart !== undefined ? { turn: this.turnStart } : {}),
    });
  }

  readonly handle = (event: AgentEvent): void => {
    switch (event.type) {
      case 'message':
        this.started = true;
        this.write({ type: 'message', message: event.message });
        return;
      case 'approval_decision':
        this.write({
          type: 'approval',
          callId: event.callId,
          tool: event.tool,
          allow: event.allow,
          scope: event.scope,
          by: event.by,
          surface: this.options.surface,
          ...(event.rule ? { rule: event.rule } : {}),
          ...(event.feedback ? { feedback: event.feedback } : {}),
          ...(event.reason ? { reason: event.reason } : {}),
        });
        return;
      case 'usage': {
        const model = event.model ?? this.model;
        this.write({
          type: 'usage',
          ...(model ? { model } : {}),
          usage: event.usage,
          ...(event.cost !== undefined ? { cost: event.cost } : {}),
          ...(event.delegatedSession ? { delegated: event.delegatedSession } : {}),
        });
        return;
      }
      case 'notice':
        this.write({ type: 'notice', level: event.level ?? 'info', message: event.message, ...(event.code ? { code: event.code } : {}) });
        return;
      case 'compaction':
        this.write({
          type: 'compaction',
          summary: event.summary,
          replaced: event.replaced,
          before: event.beforeTokens,
          after: event.afterTokens,
          strategy: event.strategy,
          trigger: event.trigger,
        });
        return;
      case 'turn_end':
        this.write({ type: 'end', status: event.status });
        if (this.started) this.guard(() => this.log.updateIndex());
        return;
      default:
        return;
    }
  };

  /** Record a change of permission mode. */
  switchPermissionMode(from: string, to: string): void {
    if (from !== to) this.write({ type: 'permission_mode', from, to });
  }

  /** Record a model switch; later usage is attributed to the new model. */
  switchModel(to: string): void {
    if (to === this.model) return;
    this.write({ type: 'model', ...(this.model ? { from: this.model } : {}), to });
    this.model = to;
  }

  private write(event: NewTranscriptEvent): void {
    if (!this.started) {
      this.pending.push(event);
      return;
    }
    const batch = [...this.pending.splice(0), event];
    this.guard(() => {
      for (const entry of batch) {
        this.log.append(entry);
        if (entry.type === 'message' && entry.message.role === 'user') this.turnStart = this.written;
        this.written += 1;
      }
    });
  }

  private guard(action: () => void): void {
    if (this.failed) return;
    try {
      action();
    } catch (error: any) {
      this.failed = true;
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
