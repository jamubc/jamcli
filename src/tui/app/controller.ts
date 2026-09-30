import fs from 'fs';
import path from 'path';
import type { RunOptions, Runtime } from '../../core/runtime/index.js';
import { choiceOf } from '../../core/routing/capabilities.js';
import type { PermissionMode } from '../../core/permissions/modes.js';
import type { AgentEvent, ApprovalDecision, ApprovalScope } from '../../core/types.js';
import type { StatusData, ViewAction } from '../state/view.js';

/** The modes Shift+Tab moves through, in order. Bypass is reached only from its flag. */
export const MODE_CYCLE: PermissionMode[] = ['default', 'accept-edits', 'plan', 'auto'];

/** The answer to a permission prompt: once, for the session or the project with a pattern, or no. */
export type PromptChoice = { allow: true; scope: ApprovalScope; pattern?: string } | { allow: false; feedback?: string; proceed?: boolean };

/**
 * The branch checked out in `root`, read from `.git/HEAD` without starting git. In a
 * worktree `.git` is a file naming the worktree's own directory, whose HEAD is read.
 */
export function gitBranch(root: string): string | undefined {
  try {
    let dir = root;
    for (;;) {
      const dotGit = path.join(dir, '.git');
      const linked = fs.existsSync(dotGit) && fs.statSync(dotGit).isFile() ? /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'))?.[1].trim() : undefined;
      const head = linked ? path.join(path.resolve(dir, linked), 'HEAD') : path.join(dotGit, 'HEAD');
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
/** The status line's facts, read from the runtime. */
/** What the session has cost, from the runtime's ledger, which children's requests reach even between turns. */
export function spendOf(runtime: Runtime): Pick<StatusData, 'costUsd' | 'unpriced'> {
  const spend = runtime.spend();
  return {
    costUsd: spend.requests > 0 && spend.unpriced === spend.requests ? null : spend.requests ? spend.cost : null,
    unpriced: spend.unpriced,
  };
}

/** How full a request of `used` tokens is, 0 to 100, when the window is known. */
const shareOf = (used: number, budget: number): number | undefined => (budget > 0 ? Math.min(100, (used / budget) * 100) : undefined);

export function statusOf(runtime: Runtime): Partial<StatusData> {
  const usage = runtime.contextUsage();
  // With no model chosen there is no window to measure against, so neither is shown.
  const chosen = Boolean(runtime.model.model);
  return {
    mode: runtime.permissionMode,
    // The effort shows beside the model once it is anything but the model's own default.
    model: chosen ? `${runtime.model.provider}:${runtime.model.model}${choiceOf(runtime.thinking) === 'auto' ? '' : ` (${choiceOf(runtime.thinking)})`}` : '',
    sandbox: runtime.sandbox.kind,
    contextPercent: chosen ? shareOf(usage.used, usage.budget) : undefined,
    ...spendOf(runtime),
    mcpServers: new Set(runtime.tools.filter((tool) => tool.source === 'mcp').map((tool) => tool.server)).size,
    lspServers: runtime.lspServers.length,
  };
}

export class SessionController {
  private readonly decisions = new Map<string, (decision: ApprovalDecision) => void>();

  constructor(
    private readonly runtime: Runtime,
    private readonly dispatch: (action: ViewAction) => void,
    /** Hears every event before the view does, such as the ACP observer. It must not throw or wait. */
    private readonly tap?: (event: AgentEvent) => void
  ) {}

  /** Asks the person what an MCP server asked for; the interface sets it. */
  onElicitation?: (event: Extract<AgentEvent, { type: 'elicitation_request' }>) => void;

  get running(): boolean {
    return this.busy;
  }
  private busy = false;
  /** Messages sent while a turn ran, oldest first, each sent in turn once the one before it ends. */
  private queue: { text: string; options: RunOptions & { display?: string } }[] = [];

  private showQueue(): void {
    this.dispatch({ type: 'queued', items: this.queue.map((entry) => entry.options.display ?? entry.text) });
  }

  /** Set while the session works outside a turn, as a compaction does: messages wait for it too. */
  private held = false;

  /** Hold messages while the session works outside a turn, and send what waited once it is done. */
  hold(on: boolean): void {
    this.held = on;
    if (!on) void this.sendNext();
  }

  /** Send the oldest queued message, when nothing holds it back. */
  private async sendNext(): Promise<void> {
    if (this.busy || this.held) return;
    const next = this.queue.shift();
    if (!next) return;
    this.showQueue();
    await this.submit(next.text, next.options);
  }

  /** Take back the last queued message, unsent, as it was typed. */
  takeQueued(): string | undefined {
    const entry = this.queue.pop();
    this.showQueue();
    return entry && (entry.options.display ?? entry.text);
  }

  /** The status line's facts that come from the runtime rather than from events. */
  status(): Partial<StatusData> {
    return statusOf(this.runtime);
  }

  refresh(): void {
    this.dispatch({ type: 'status', patch: this.status() });
  }

  /** Keep the view told of what runs beside the turn, from now until the returned function is called. */
  watchWork(): () => void {
    // A background child spends between turns, so the cost is read again with what it is doing.
    const tell = () => {
      this.dispatch({ type: 'work', items: this.runtime.work() });
      this.dispatch({ type: 'status', patch: spendOf(this.runtime) });
    };
    tell();
    return this.runtime.watchWork(tell);
  }

  /**
   * Send a message and run a turn on it. Resolves when the turn ends. A custom command
   * shows what was typed, `display`, and sends its prompt with its model and tools.
   */
  async submit(text: string, options: RunOptions & { display?: string } = {}): Promise<void> {
    // A message sent while a turn runs, or while the session compacts, waits for it to end, and can be taken back until then.
    if (this.busy || this.held) {
      this.queue.push({ text, options });
      this.showQueue();
      return;
    }
    this.busy = true;
    const { display, ...turn } = options;
    this.dispatch({ type: 'submit', text: display ?? text });
    // Errors already shown as a `notice` during the turn are not repeated as the final result's error.
    const shownErrors = new Set<string>();
    const sessionModel = `${this.runtime.model.provider}:${this.runtime.model.model}`;
    const budget = this.runtime.contextUsage().budget;
    try {
      const result = await this.runtime.run(
        text,
        (event: AgentEvent) => {
          this.tap?.(event);
          if (event.type === 'approval_request') this.decisions.set(event.call.id, event.decide);
          // A call decided without this prompt's answer, as a grant made meanwhile can, has nothing left to answer.
          if (event.type === 'approval_decision') this.decisions.delete(event.callId);
          if (event.type === 'elicitation_request') {
            // With nobody set to ask, the server hears no rather than waiting forever.
            if (!this.onElicitation) return event.respond({ action: 'decline' });
            // While the person answers, the turn waits on them, as it does behind a permission prompt.
            this.dispatch({ type: 'status', patch: { phase: 'waiting' } });
            this.onElicitation({
              ...event,
              respond: (answer) => {
                this.dispatch({ type: 'status', patch: { phase: this.busy ? 'tool' : 'idle' } });
                event.respond(answer);
              },
            });
            return;
          }
          if (event.type === 'notice' && event.level === 'error') shownErrors.add(event.message);
          this.dispatch({ type: 'event', event });
          // A long turn grows the context with every request, and the runtime keeps the conversation only when the turn ends, so meanwhile the share is what this session's last request carried, plus the reply it drew.
          if (event.type === 'usage' && !event.delegatedSession && !event.unreported && (!event.model || event.model === sessionModel)) {
            const share = shareOf(event.usage.prompt_tokens + event.usage.completion_tokens, budget);
            if (share !== undefined) this.dispatch({ type: 'status', patch: { contextPercent: share } });
          }
        },
        turn
      );
      // A turn that did not finish says why, since no reply may have been written.
      if (result.status === 'refused' || result.status === 'limit') this.dispatch({ type: 'notice', level: 'warn', text: result.response || result.error || 'The turn stopped.' });
      else if (result.status === 'cancelled') this.dispatch({ type: 'notice', level: 'info', text: 'Stopped.' });
      else if (result.status === 'error' && result.error && !shownErrors.has(result.error)) this.dispatch({ type: 'notice', level: 'error', text: result.error });
    } catch (error: any) {
      this.dispatch({ type: 'notice', level: 'error', text: error?.message ?? String(error) });
    } finally {
      this.busy = false;
      this.dispatch({ type: 'event', event: { type: 'turn_end', status: 'ok' } });
      this.refresh();
    }
    // The next queued message is sent once this turn ends. Stopping the turn has already
    // handed the queue back to the composer, so what is here was sent after that.
    await this.sendNext();
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
        : { allow: false, ...(choice.feedback ? { feedback: choice.feedback } : {}), ...(choice.proceed ? { proceed: true } : {}) }
    );
  }

  /**
   * Stop the running turn. Pending prompts are answered no. What was queued behind it is
   * returned, unsent, as it was typed, one message to a line, for the composer to hold.
   */
  cancel(): string | undefined {
    const queued = this.queue.map((entry) => entry.options.display ?? entry.text);
    this.queue = [];
    if (queued.length) this.showQueue();
    for (const callId of [...this.decisions.keys()]) this.answer(callId, { allow: false, feedback: 'the person stopped the turn' });
    this.runtime.cancel();
    return queued.length ? queued.join('\n') : undefined;
  }

  /**
   * Switch to a mode, saying why when it is not available here. Bypass needs the person's
   * confirmation, which the caller has asked for.
   */
  setMode(mode: PermissionMode, options: { bypassConfirmed?: boolean } = {}): boolean {
    const refusal = this.runtime.setPermissionMode(mode, options);
    if (refusal) this.dispatch({ type: 'notice', level: 'warn', text: `Not switched to ${mode} mode: ${refusal}` });
    else if (mode === 'bypass') this.dispatch({ type: 'notice', level: 'warn', text: 'Bypass mode is on: nothing asks before it runs, and only deny rules stop a call.' });
    this.refresh();
    return refusal === undefined;
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
