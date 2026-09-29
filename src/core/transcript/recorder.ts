import type { AgentEvent, TokenUsage } from '../types.js';
import type { TranscriptEvent } from './events.js';
import type { NewTranscriptEvent, SessionLog } from './log.js';

export interface TranscriptRecorderOptions {
  /** The surface recorded with each decision: `cli`, `acp`, `tui`, or `task`. */
  surface: string;
  /** The model usage is attributed to until `switchModel` is called. */
  model?: string;
  /** Called once if the log cannot be written; recording stops after that. */
  onError?: (error: Error) => void;
}

const contextKey = (system: string | undefined, tools: unknown): string => JSON.stringify([system ?? null, tools ?? null]);

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
  /** The system prompt and tools last recorded, so a request that carries the same is not written again. */
  private context: string | undefined;
  /** The session so far, as the end event summarizes it. */
  private readonly totals = { promptTokens: 0, cachedTokens: 0, contexts: 0, gates: 0, steers: 0 };

  constructor(
    readonly log: SessionLog,
    private readonly options: TranscriptRecorderOptions
  ) {
    this.model = options.model;
    const events = log.events();
    this.started = events.some((event) => event.type === 'message');
    this.written = events.filter((event) => event.type !== 'session').length;
    for (const event of events) {
      if (event.type === 'context') this.context = contextKey(event.system, event.tools);
      this.count(event);
    }
  }

  /** What the session's requests carried, how much was cached, and how often the harness stepped in. */
  summary(): NonNullable<Extract<TranscriptEvent, { type: 'end' }>['summary']> {
    const { promptTokens, cachedTokens, contexts, gates, steers } = this.totals;
    return { promptTokens, cachedTokens, cacheBreaks: Math.max(0, contexts - 1), gates, steers };
  }

  private count(event: { type: string; usage?: TokenUsage; delegated?: string }): void {
    if (event.type === 'usage' && event.usage && !event.delegated) {
      this.totals.promptTokens += event.usage.prompt_tokens ?? 0;
      this.totals.cachedTokens += event.usage.cached_tokens ?? 0;
    } else if (event.type === 'context') this.totals.contexts += 1;
    else if (event.type === 'gate') this.totals.gates += 1;
    else if (event.type === 'steer') this.totals.steers += 1;
  }

  /**
   * Record a checkpoint, with where the current turn began. A checkpoint is worth a session
   * file on its own, such as for a change the person made before saying anything.
   */
  recordCheckpoint(checkpoint: { ref: string; files?: string[]; after?: string; label: string }): void {
    this.started = true;
    this.write({
      type: 'checkpoint',
      ref: checkpoint.ref,
      ...(checkpoint.files ? { files: checkpoint.files } : {}),
      ...(checkpoint.after ? { after: checkpoint.after } : {}),
      label: checkpoint.label,
      ...(this.turnStart !== undefined ? { turn: this.turnStart } : {}),
    });
  }

  /** Record a tester's note. A note is worth a session file on its own. */
  recordNote(text: string): void {
    this.started = true;
    this.write({ type: 'note', text });
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
          ...(event.source ? { source: event.source } : {}),
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
        this.write({ type: 'notice', level: event.level ?? 'info', message: event.message, ...(event.code ? { code: event.code } : {}), ...(event.detail !== undefined ? { detail: event.detail } : {}) });
        return;
      case 'request': {
        const key = contextKey(event.system, event.tools);
        if (key === this.context) return;
        this.context = key;
        this.write({ type: 'context', ...(event.system !== undefined ? { system: event.system } : {}), ...(event.tools ? { tools: event.tools } : {}) });
        return;
      }
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
      case 'gate':
        this.write({
          type: 'gate',
          tier: event.tier,
          name: event.name,
          command: event.command,
          ...(event.tree ? { tree: event.tree } : {}),
          status: event.status,
          durationMs: event.durationMs,
          ...(event.step ? { step: event.step } : {}),
          ...(event.byModel ? { byModel: true } : {}),
          shaped: event.shaped,
        });
        return;
      case 'elision':
        this.write({ type: 'elision', stage: event.stage, message: event.message, tokensRemoved: event.tokensRemoved, stub: event.stub });
        return;
      case 'steer':
        this.write({ type: 'steer', handler: event.handler, ...(event.callId ? { callId: event.callId } : {}), detail: event.detail });
        return;
      case 'handoff':
        this.write({ type: 'handoff', path: event.path, bytes: event.bytes, reason: event.reason });
        return;
      case 'turn_end':
        this.write({ type: 'end', status: event.status, summary: this.summary() });
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
        this.count(entry as { type: string; usage?: TokenUsage; delegated?: string });
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
