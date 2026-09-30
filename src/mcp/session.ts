import { createTwoFilesPatch } from 'diff';
import path from 'path';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { createAcpSession, type AcpSessionController, type CreateAcpSessionOptions } from '../acp/session.js';
import { UpdateMapper } from '../acp/updates.js';
import { entryText } from '../commands/host.js';
import type { ChoiceItem } from '../commands/types.js';
import type { AgentEvent, ApprovalAsker, ApprovalDecision, ApprovalPreview, RunStatus } from '../core/types.js';

/** What a delegated session waits on: a call to approve, or a list a command offered. */
export type Waiting =
  | {
      kind: 'approval';
      id: string;
      tool: string;
      summary: string;
      reason: string;
      preview?: ApprovalPreview;
      /** What allow_session may grant, narrowest first; none when no grant can cover the call. */
      suggestions: string[];
      /** The tool asks every time: only the person answers it. */
      personOnly: boolean;
      /** The child run that asks, when one does. */
      from?: ApprovalAsker;
    }
  | { kind: 'choice'; id: string; title: string; items: ChoiceItem[]; personOnly: boolean };

/** How a delegated session stands, for the calling agent. */
export interface SessionReport {
  session: string;
  /** `running` while a turn runs, `waiting` while it needs an answer, else `idle`. */
  status: 'running' | 'waiting' | 'idle';
  /** What happened since the caller last read it, as text. */
  output: string;
  waiting?: Waiting;
  /** How the last turn ended, once it has. */
  ended?: RunStatus;
  model: string;
  mode?: string;
}

/**
 * A JamCLI session another agent delegates work to. It holds the ACP session controller,
 * the same one an editor's session has, and keeps for the caller what MCP cannot push: the
 * output since it last read, the one thing the session waits on, and whether a turn runs.
 */
export class DelegatedSession {
  private output: string[] = [];
  /** Calls waiting for approval, oldest first: children asking at once each wait their turn. */
  private approvals: { waiting: Extract<Waiting, { kind: 'approval' }>; decide: (decision: ApprovalDecision) => void }[] = [];
  private turn: Promise<void> | undefined;
  private ended: RunStatus | undefined;
  private readonly changed = new Set<() => void>();
  private readonly mapper: UpdateMapper;

  private constructor(
    readonly controller: AcpSessionController,
    private readonly cwd: string
  ) {
    this.mapper = new UpdateMapper(cwd);
  }

  static async open(options: CreateAcpSessionOptions): Promise<DelegatedSession> {
    return new DelegatedSession(await createAcpSession(options), options.cwd);
  }

  get id(): string {
    return this.controller.id;
  }

  /** What the session waits on, when it does. */
  waiting(): Waiting | undefined {
    if (this.approvals.length) return this.approvals[0].waiting;
    const choice = this.controller.waitingChoice?.();
    return choice ? { kind: 'choice', id: `choice:${choice.title}`, ...choice } : undefined;
  }

  running(): boolean {
    return this.turn !== undefined;
  }

  /** Send a prompt or a command line; the turn runs on while the caller waits or does not. */
  send(text: string): void {
    if (this.turn) throw new Error('A turn is running. Wait for it with session_state, or stop it with session_stop.');
    // Anything else sent now would close the list unanswered, so the list is answered first.
    if (this.controller.waitingChoice?.() && !/^\/choose(\s|$)/.test(text.trim())) throw new Error('A list waits: answer it with session_answer choice <key or number>, or none, first.');
    this.ended = undefined;
    const run = async () => {
      if (this.controller.isCommand?.(text)) {
        // A list left waiting is shown by the report, in the words MCP answers it with; one that was settled is said here.
        const lists: string[] = [];
        await this.controller.runCommand!(text, {
          entry: (entry) => (entry.kind === 'event' ? this.onEvent(entry.event) : entry.kind === 'choice' ? lists.push(`${entryText(entry)}\n`) : this.say(`${entryText(entry)}\n`)),
          turn: async (prompt, turn) => this.finish(await this.controller.run(prompt, (event) => this.onEvent(event), turn)),
          mode: (mode) => this.say(`[mode ${mode}]\n`),
          refresh: () => undefined,
        });
        if (!this.controller.waitingChoice?.()) for (const list of lists) this.say(list);
      } else {
        this.finish(await this.controller.run(text, (event) => this.onEvent(event)));
      }
    };
    this.turn = run()
      .catch((error: any) => this.say(`Error: ${error?.message ?? error}\n`))
      .finally(() => {
        this.turn = undefined;
        this.ended ??= 'ok';
        this.notify();
      });
    this.notify();
  }

  /**
   * Answer the call waiting for approval. The person's is never answered here. A session
   * grant is one of the patterns the call offers, the narrowest when none is named, as the
   * interface's prompt offers them.
   */
  answerApproval(decision: 'allow_once' | 'allow_session' | 'deny', feedback?: string, pattern?: string): void {
    const pending = this.approvals[0];
    if (!pending) throw new Error('No call is waiting for approval.');
    if (pending.waiting.personOnly) throw new Error(`${pending.waiting.tool} always asks the person, so only they answer it.`);
    const offered = pending.waiting.suggestions;
    if (pattern !== undefined && decision !== 'allow_session') throw new Error('A pattern goes with allow_session.');
    if (pattern !== undefined && !offered.includes(pattern)) throw new Error(offered.length ? `${pattern} is not offered for this call. allow_session grants one of: ${offered.join(', ')}.` : 'No grant can cover this call, so it asks every time.');
    if (decision === 'deny') return this.decide({ allow: false, ...(feedback ? { feedback } : {}) });
    this.decide(decision === 'allow_session' ? { allow: true, scope: 'session', ...(pattern ? { pattern } : {}) } : { allow: true });
  }

  /** Answer the oldest waiting call, the person's own included, with what they said. */
  decide(decision: ApprovalDecision): void {
    const pending = this.approvals.shift();
    if (!pending) return;
    pending.decide(decision);
    this.notify();
  }

  /** Stop the running turn; every waiting call is answered no. */
  cancel(): void {
    for (const pending of this.approvals.splice(0)) pending.decide({ allow: false, feedback: 'the session was stopped' });
    this.controller.cancel();
  }

  /** Wait until the turn ends, the session needs an answer, `ms` pass, or `signal` aborts. */
  async settle(ms: number, signal?: AbortSignal, progress?: (text: string) => void): Promise<void> {
    const done = () => !this.turn || Boolean(this.waiting());
    if (done()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        signal?.removeEventListener('abort', finish);
        stop();
        resolve();
      }
      const stop = this.watch(() => {
        progress?.(this.output.join(''));
        if (done()) finish();
      });
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  /** How the session stands; the output is handed over, so the next report starts after it. */
  report(): SessionReport {
    const output = this.output.join('');
    this.output = [];
    const waiting = this.waiting();
    return {
      session: this.id,
      status: waiting ? 'waiting' : this.turn ? 'running' : 'idle',
      output,
      ...(waiting ? { waiting } : {}),
      ...(!this.turn && this.ended ? { ended: this.ended } : {}),
      model: this.controller.configOptions[0]?.currentValue as string,
      ...(this.controller.modes ? { mode: this.controller.modes.currentModeId } : {}),
    };
  }

  async close(): Promise<void> {
    this.cancel();
    await this.turn?.catch(() => undefined);
    await this.controller.close?.();
  }

  /** Called whenever something changes; returns how to stop. */
  watch(listener: () => void): () => void {
    this.changed.add(listener);
    return () => this.changed.delete(listener);
  }

  private notify(): void {
    for (const listener of [...this.changed]) listener();
  }

  private say(text: string): void {
    this.output.push(text);
    this.notify();
  }

  private finish(result: { status: RunStatus; error?: string }): void {
    this.ended = result.status;
    if (result.status === 'error' && result.error) this.say(`Error: ${result.error}\n`);
  }

  private onEvent(event: AgentEvent): void {
    if (event.type === 'approval_request') {
      this.approvals.push({
        waiting: {
          kind: 'approval',
          id: event.call.id,
          tool: event.call.name,
          summary: event.request?.summary ?? event.call.name,
          reason: event.request?.reason ?? 'this tool asks before it runs',
          ...(event.request?.preview ? { preview: event.request.preview } : {}),
          suggestions: event.request?.suggestions ?? [],
          personOnly: Boolean(event.request?.alwaysAsks),
          ...(event.request?.from ? { from: event.request.from } : {}),
        },
        decide: event.decide,
      });
      this.say(`? waiting: ${event.request?.summary ?? event.call.name}\n`);
      return;
    }
    // A waiting call decided without an answer here, as a grant made meanwhile can, no longer waits.
    if (event.type === 'approval_decision') this.approvals = this.approvals.filter((pending) => pending.waiting.id !== event.callId);
    // An MCP server's own question has nobody to reach here, so it is declined.
    if (event.type === 'elicitation_request') return event.respond({ action: 'decline' });
    for (const update of this.mapper.map(event)) this.say(describe(update, this.cwd));
  }
}

/** One ACP update as a line of text for the calling agent. */
function describe(update: SessionUpdate, cwd: string): string {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text' ? update.content.text : '';
    case 'tool_call':
      return `\n→ ${update.title}\n`;
    case 'tool_call_update': {
      if (update.status === 'pending' || !update.status) return '';
      const parts = (update.content ?? []).map((item) => {
        if (item.type === 'diff') return createTwoFilesPatch(path.relative(cwd, item.path), path.relative(cwd, item.path), item.oldText ?? '', item.newText, '', '', { context: 2 }).split('\n').slice(2).join('\n');
        return item.type === 'content' && item.content.type === 'text' ? item.content.text : '';
      });
      return `${update.status === 'failed' ? '✗ failed' : '✓ done'}${parts.length ? `\n${parts.join('\n').trimEnd()}` : ''}\n`;
    }
    case 'plan':
      return `Plan:\n${update.entries.map((entry) => `- [${entry.status}] ${entry.content}`).join('\n')}\n`;
    default:
      return '';
  }
}
