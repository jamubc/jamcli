import fs from 'fs';
import path from 'path';
import type { Runtime } from '../../core/runtime/index.js';
import type { PermissionMode } from '../../core/permissions/modes.js';
import type { AgentEvent, ApprovalDecision, ApprovalScope } from '../../core/types.js';
import type { StatusData, ViewAction } from '../state/view.js';

/** The modes Shift+Tab moves through, in order. Bypass is reached only from its flag. */
export const MODE_CYCLE: PermissionMode[] = ['default', 'accept-edits', 'plan', 'auto'];

/** The answer to a permission prompt: once, for the session or the project with a pattern, or no. */
export type PromptChoice = { allow: true; scope: ApprovalScope; pattern?: string } | { allow: false; feedback?: string };

/** The branch checked out in `root`, read from `.git/HEAD` without starting git. */
export function gitBranch(root: string): string | undefined {
  try {
    let dir = root;
    for (;;) {
      const head = path.join(dir, '.git', 'HEAD');
      if (fs.existsSync(head)) {
        const text = fs.readFileSync(head, 'utf8').trim();
        return text.startsWith('ref: refs/heads/') ? text.slice('ref: refs/heads/'.length) : text.slice(0, 7);
      }
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  } catch {
    return undefined;
  }
}

/**
 * Connects a runtime to the view: sends what the person types, folds every event into
 * the view, holds each pending approval's answer until the person gives it, and keeps
 * the status line current. It knows nothing of rendering.
 */
export class SessionController {
  private readonly decisions = new Map<string, (decision: ApprovalDecision) => void>();

  constructor(
    private readonly runtime: Runtime,
    private readonly dispatch: (action: ViewAction) => void
  ) {}

  get running(): boolean {
    return this.busy;
  }
  private busy = false;

  /** The status line's facts that come from the runtime rather than from events. */
  status(): Partial<StatusData> {
    const usage = this.runtime.contextUsage();
    const spend = this.runtime.spend();
    return {
      mode: this.runtime.permissionMode,
      model: `${this.runtime.model.provider}:${this.runtime.model.model}`,
      sandbox: this.runtime.sandbox.kind,
      contextPercent: usage.budget > 0 ? Math.min(100, (usage.used / usage.budget) * 100) : undefined,
      costUsd: spend.requests > 0 && spend.unpriced === spend.requests ? null : spend.requests ? spend.cost : null,
      unpriced: spend.unpriced,
      mcpServers: new Set(this.runtime.tools.filter((tool) => tool.source === 'mcp').map((tool) => tool.server)).size,
    };
  }

  refresh(): void {
    this.dispatch({ type: 'status', patch: this.status() });
  }

  /** Send a message and run a turn on it. Resolves when the turn ends. */
  async submit(text: string): Promise<void> {
    if (this.busy) {
      this.dispatch({ type: 'notice', level: 'warn', text: 'A turn is running; wait for it, or press Escape to stop it.' });
      return;
    }
    this.busy = true;
    this.dispatch({ type: 'submit', text });
    try {
      const result = await this.runtime.run(text, (event: AgentEvent) => {
        if (event.type === 'approval_request') this.decisions.set(event.call.id, event.decide);
        this.dispatch({ type: 'event', event });
      });
      // A turn that did not finish says why, since no reply may have been written.
      if (result.status === 'refused' || result.status === 'limit') this.dispatch({ type: 'notice', level: 'warn', text: result.response || result.error || 'The turn stopped.' });
      else if (result.status === 'cancelled') this.dispatch({ type: 'notice', level: 'info', text: 'Stopped.' });
      else if (result.status === 'error' && result.error) this.dispatch({ type: 'notice', level: 'error', text: result.error });
    } catch (error: any) {
      this.dispatch({ type: 'notice', level: 'error', text: error?.message ?? String(error) });
    } finally {
      this.busy = false;
      this.dispatch({ type: 'event', event: { type: 'turn_end', status: 'ok' } });
      this.refresh();
    }
  }

  /** Answer the prompt for one call. */
  answer(callId: string, choice: PromptChoice): void {
    const decide = this.decisions.get(callId);
    if (!decide) return;
    this.decisions.delete(callId);
    // A decision with no `by` is the person's.
    decide(
      choice.allow
        ? { allow: true, scope: choice.scope, ...(choice.pattern ? { pattern: choice.pattern } : {}) }
        : { allow: false, ...(choice.feedback ? { feedback: choice.feedback } : {}) }
    );
  }

  /** Stop the running turn. Pending prompts are answered no. */
  cancel(): void {
    for (const callId of [...this.decisions.keys()]) this.answer(callId, { allow: false, feedback: 'the person stopped the turn' });
    this.runtime.cancel();
  }

  /** Move to the next mode that is available here, and say why one was skipped. */
  cycleMode(): void {
    const start = Math.max(0, MODE_CYCLE.indexOf(this.runtime.permissionMode as PermissionMode));
    for (let step = 1; step <= MODE_CYCLE.length; step += 1) {
      const next = MODE_CYCLE[(start + step) % MODE_CYCLE.length];
      if (this.runtime.setPermissionMode(next) === undefined) break;
    }
    this.refresh();
  }
}
