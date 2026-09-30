import type {
  AgentEvent,
  ApprovalBy,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalScope,
  JamSession,
  PolicyClass,
  ToolCall,
  ToolResult,
  ToolStatus,
} from '../types.js';
import { readDecision } from '../types.js';
import { buildApprovalRequest } from '../approval.js';
import { hookVerdict, type HookBus, type HookVerdict } from '../hooks/index.js';
import { validateAgainstSchema } from './registry.js';
import type { JsonSchema } from '../../types/tools.js';
import type { NestedApproval } from '../delegation/types.js';

export interface DispatchableTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface DispatchContext {
  signal?: AbortSignal;
  /** Streams partial output, such as a running command's, to the surface. */
  onProgress?: (chunk: string) => void;
  /** Asks the surface about a call nested inside this one, such as a child run's. */
  requestApproval?: NestedApproval;
  /** What a nested call the surface was asked about went on to do, so it is shown there too. */
  onNestedResult?: (result: ToolResult) => void;
}

export interface ToolDispatcher {
  listTools(): DispatchableTool[];
  execute(call: ToolCall, context?: DispatchContext): Promise<ToolResult>;
  /** Whether this call needs a decision before it runs. */
  requiresApproval(name: string, call?: ToolCall): boolean;
  /** Read-only calls may run concurrently with each other. */
  isReadOnly?(name: string): boolean;
  /** Why the call needs a decision, shown in the approval prompt. */
  approvalReason?(call: ToolCall): string;
  policyClass?(name: string): PolicyClass | 'unknown';
  /** Whether the tool asks every time, whatever the rules and mode. */
  alwaysAsks?(name: string): boolean;
  /** Remember a grant the user chose at approval time. */
  grant?(call: ToolCall, scope: ApprovalScope, pattern?: string): void;
  /** Hear each rule added from now on, a grant included, so an ask still waiting can be decided again. Returns how to stop. */
  onGrant?(listener: () => void): () => void;
  /** For a state-changing call that runs without asking: who allowed it, and by which rule. */
  autoApproval?(call: ToolCall): { by: ApprovalBy; rule?: string } | undefined;
  /**
   * The whole decision for one call, with who made it and why. When present it replaces
   * `requiresApproval`, `approvalReason`, and `autoApproval`.
   */
  decide?(call: ToolCall): DispatchVerdict;
}

export interface DispatchVerdict {
  decision: 'allow' | 'ask' | 'deny';
  by?: ApprovalBy;
  rule?: string;
  /** Where the deciding rule came from, such as the file and key that hold it. */
  source?: string;
  reason?: string;
}

export interface BatchContext {
  dispatcher: ToolDispatcher;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
  projectRoot: string;
  session: JamSession;
  hooks?: HookBus;
  /** Calls that may still run this turn. Undefined means no cap. */
  remaining?: number;
  /** The cap itself, for the message a capped call receives. */
  cap?: number;
  /** Applied to every result and progress chunk before anything else sees it. */
  redact?: (text: string) => string;
  /**
   * Called once per step, before the first call that may change something runs, such as
   * to take a checkpoint. A failure is the caller's to report; the call runs regardless.
   */
  beforeChange?: (call: ToolCall) => Promise<void>;
  /** Called once the step's calls are done, when `beforeChange` was, such as to settle the checkpoint. */
  afterChange?: () => Promise<void>;
  /** The session's waiting asks, so one answer settles every identical one. */
  waiting?: WaitingAsks;
}

/**
 * The asks of one session waiting for an answer, by key, so an answer to one settles every
 * other that asks the same: ten children asking to run one command are answered once. It
 * belongs to the runtime, not to a batch, because a background child still asks through the
 * batch that started it after that batch returned.
 */
export class WaitingAsks {
  private readonly waiting = new Map<string, Set<(decision: ApprovalDecision) => void>>();

  /** Wait under `key` until settled. Returns how to stop waiting. */
  add(key: string, settle: (decision: ApprovalDecision) => void): () => void {
    const same = this.waiting.get(key) ?? new Set();
    same.add(settle);
    this.waiting.set(key, same);
    return () => {
      same.delete(settle);
      if (!same.size) this.waiting.delete(key);
    };
  }

  /** Settle every ask still waiting under `key` with the answer one of them was given. */
  answer(key: string, decision: ApprovalDecision): void {
    for (const settle of [...(this.waiting.get(key) ?? [])]) settle(decision);
  }
}

export interface BatchOutcome {
  /** One result per call, in the order the calls were made. */
  results: ToolResult[];
  /** Calls that actually executed. */
  ran: number;
  /** Calls not run because the per-turn cap was reached. */
  capped: number;
  /** Present when the user denied a call. With their feedback, or `proceed`, the turn goes on; bare, it stops. */
  denial?: { feedback?: string; proceed: boolean };
}

/** How a call that asked was answered, as the surfaces and the transcript hear it. */
const answered = (call: ToolCall, read: ReturnType<typeof readDecision>): AgentEvent => ({
  type: 'approval_decision',
  callId: call.id,
  tool: call.name,
  allow: read.allow,
  scope: read.scope,
  by: read.by,
  ...(read.feedback ? { feedback: read.feedback } : {}),
  ...(read.pattern ? { rule: read.pattern } : {}),
});

/** A decision a rule, the mode, or a hook made, with what decided and why, as the surfaces and the transcript hear it. */
const byVerdict = (call: ToolCall, allow: boolean, verdict: DispatchVerdict): AgentEvent => ({
  type: 'approval_decision',
  callId: call.id,
  tool: call.name,
  allow,
  scope: 'once',
  by: verdict.by ?? 'policy',
  ...(verdict.rule ? { rule: verdict.rule } : {}),
  ...(verdict.source ? { source: verdict.source } : {}),
  ...(verdict.reason ? { reason: verdict.reason } : {}),
});

/** How a wait for a decision ended: its answer, the turn's end, or the verdict it was settled with, unasked. */
type Answer = ApprovalDecision | 'cancelled' | { settled: DispatchVerdict };

const isSettled = (answer: Answer): answer is { settled: DispatchVerdict } => typeof answer === 'object' && 'settled' in answer;

export const resultFor = (call: ToolCall, status: ToolStatus, output: string, durationMs = 0): ToolResult => ({
  tool: call.name,
  callId: call.id,
  status,
  success: status === 'ok',
  output,
  durationMs,
});

/**
 * Run the calls a model made in one step. Every call gets exactly one result, in order:
 * it ran, failed, was denied, timed out, or was cancelled. Consecutive read-only calls
 * run together; anything that needs approval runs alone, after its decision. A denial or
 * a cancellation answers the remaining calls instead of dropping them.
 */
export async function executeBatch(calls: ToolCall[], ctx: BatchContext): Promise<BatchOutcome> {
  const results: ToolResult[] = new Array(calls.length);
  let remaining = ctx.remaining;
  let ran = 0;
  let capped = 0;
  let denial: BatchOutcome['denial'];
  let stopped: 'denied' | 'cancelled' | undefined;

  /**
   * Each call as the pre_tool hooks leave it, with their verdict. The hooks run once per
   * call, before it is decided; replacement arguments are checked against the tool's
   * schema, and the call is announced as it will run.
   */
  const hooked = new Map<number, { call: ToolCall; verdict: HookVerdict }>();
  const announce = async (index: number) => {
    const known = hooked.get(index);
    if (known) return known;
    const original = calls[index];
    let verdict = await hookVerdict(ctx.hooks, 'pre_tool', { session: ctx.session, call: original }, ctx.emit);
    let call = original;
    if (verdict.updatedInput && verdict.block === undefined && verdict.decision !== 'deny') {
      const schema = ctx.dispatcher.listTools().find((tool) => tool.name === original.name)?.parameters as JsonSchema | undefined;
      const checked = validateAgainstSchema(schema, verdict.updatedInput);
      if (checked.valid) call = { ...original, arguments: verdict.updatedInput };
      else verdict = { ...verdict, block: `it replaced the arguments with ones the tool does not take (${checked.errors.join('; ')})` };
    }
    ctx.emit({ type: 'tool_call', call });
    if (call !== original) ctx.emit({ type: 'notice', level: 'info', message: `A pre_tool hook changed the arguments of ${call.name} (${call.id}).` });
    const entry = { call, verdict };
    hooked.set(index, entry);
    return entry;
  };

  const redact = ctx.redact ?? ((text: string) => text);

  const perform = async (index: number): Promise<ToolResult> => {
    const { call, verdict: hook } = hooked.get(index)!;
    const started = Date.now();
    let result: ToolResult;
    try {
      result = await ctx.dispatcher.execute(call, {
        signal: ctx.signal,
        onProgress: (chunk) => ctx.emit({ type: 'tool_progress', callId: call.id, tool: call.name, chunk: redact(chunk) }),
        requestApproval: async ({ call: nested, request, withdrawn }) => {
          // A nested call is shown under the call it came from, so its id cannot collide.
          const scoped: ToolCall = { ...nested, id: `${call.id}/${nested.id}` };
          const decision = await waitForDecision(scoped, request && { ...request, id: scoped.id, call: scoped }, undefined, withdrawn ? { withdrawn } : {});
          if (decision === 'cancelled') return decision;
          // The answer, or the verdict the child settled it with, is announced as for the session's own calls, so the surface takes the prompt down.
          if (isSettled(decision)) {
            ctx.emit(byVerdict(scoped, true, decision.settled));
            return { allow: true, by: decision.settled.by ?? 'policy' };
          }
          ctx.emit(answered(scoped, readDecision(decision)));
          return decision;
        },
        onNestedResult: (result) => ctx.emit({ type: 'tool_result', result: { ...result, callId: `${call.id}/${result.callId ?? result.tool}` } }),
      });
    } catch (error: any) {
      const cancelled = ctx.signal.aborted || error?.name === 'AbortError';
      result = resultFor(call, cancelled ? 'cancelled' : 'error', `Tool ${call.name} failed: ${error?.message ?? error}`, Date.now() - started);
    }
    const status = result.status ?? (result.success ? 'ok' : 'error');
    // What a pre_tool hook adds reaches the model with the call's result.
    const added = hook.context.length ? `\n\n${hook.context.join('\n')}` : '';
    const settled: ToolResult = {
      ...result,
      output: redact(`${result.output ?? ''}${added}`),
      tool: call.name,
      callId: call.id,
      status,
      success: status === 'ok',
    };
    ctx.emit({ type: 'tool_result', result: settled });
    return settled;
  };

  const settle = (index: number, result: ToolResult) => {
    results[index] = result;
  };

  const verdictOf = (call: ToolCall): DispatchVerdict => {
    if (ctx.dispatcher.decide) return ctx.dispatcher.decide(call);
    if (ctx.dispatcher.requiresApproval(call.name, call)) return { decision: 'ask', reason: ctx.dispatcher.approvalReason?.(call) };
    const auto = ctx.dispatcher.autoApproval?.(call);
    return { decision: 'allow', ...(auto ?? {}) };
  };

  /** Whether a call may change files or run something: anything but a read or the agent's own plan. */
  const changes = (call: ToolCall) => {
    const policyClass = ctx.dispatcher.policyClass?.(call.name);
    return policyClass ? policyClass !== 'read' && policyClass !== 'state' && policyClass !== 'network' : !ctx.dispatcher.isReadOnly?.(call.name);
  };
  let changing = false;

  /**
   * A call's decision with its pre_tool hooks' as one more rule source, deny first: a
   * block or a deny from a hook denies; a deny from a rule or the mode stands; a hook
   * asking asks; a hook allowing answers only what the mode alone would have asked.
   */
  const decide = (index: number): DispatchVerdict => {
    const { call, verdict: hook } = hooked.get(index)!;
    const why = (text: string, reason?: string) => (reason ? `${text}: ${reason}` : text);
    if (hook.block !== undefined) return { decision: 'deny', by: 'hook', reason: why('a pre_tool hook blocked it', hook.block) };
    if (hook.decision === 'deny') return { decision: 'deny', by: 'hook', reason: why('a pre_tool hook denied it', hook.reason) };
    const verdict = verdictOf(call);
    if (verdict.decision === 'deny') return verdict;
    if (hook.decision === 'ask') return { decision: 'ask', by: 'hook', reason: why('a pre_tool hook asks first', hook.reason) };
    if (hook.decision === 'allow' && verdict.decision === 'ask' && verdict.by === 'mode') return { decision: 'allow', by: 'hook', reason: why('a pre_tool hook allowed it', hook.reason) };
    return verdict;
  };

  const readOnly = (index: number) => Boolean(ctx.dispatcher.isReadOnly?.(calls[index].name)) && decide(index).decision === 'allow';

  /** Reads and the agent's own plan are not decisions worth recording; everything else is. */
  const recorded = (call: ToolCall) => {
    const policyClass = ctx.dispatcher.policyClass?.(call.name);
    return policyClass ? policyClass !== 'read' && policyClass !== 'state' : !ctx.dispatcher.isReadOnly?.(call.name);
  };

  /**
   * Ask about a call and wait. The wait also ends when the turn does; when a grant made
   * meanwhile lets `redecide` allow it; and when the run that asked, further down, withdraws
   * it. A wait settled without an answer aborts its own event's `withdrawn`, so a prompt
   * shown further up is taken down too.
   */
  const waitForDecision = (
    call: ToolCall,
    prebuilt?: ApprovalRequest,
    reason?: string,
    options: { redecide?: () => DispatchVerdict; withdrawn?: AbortSignal } = {}
  ): Promise<Answer> =>
    new Promise((resolve) => {
      if (ctx.signal.aborted) return resolve('cancelled');
      const { redecide, withdrawn } = options;
      if (withdrawn?.aborted) return resolve({ settled: withdrawn.reason as DispatchVerdict });
      const withdraw = new AbortController();
      const stops: (() => void)[] = [];
      let done = false;
      const finish = (answer: Answer) => {
        if (done) return;
        done = true;
        for (const stop of stops) stop();
        if (isSettled(answer)) withdraw.abort(answer.settled);
        resolve(answer);
      };
      const onAbort = () => finish('cancelled');
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      stops.push(() => ctx.signal.removeEventListener('abort', onAbort));
      if (withdrawn) {
        const onWithdrawn = () => finish({ settled: withdrawn.reason as DispatchVerdict });
        withdrawn.addEventListener('abort', onWithdrawn, { once: true });
        stops.push(() => withdrawn.removeEventListener('abort', onWithdrawn));
      }
      if (redecide && ctx.dispatcher.onGrant) {
        stops.push(
          ctx.dispatcher.onGrant(() => {
            const verdict = redecide();
            if (verdict.decision === 'allow') finish({ settled: verdict });
          })
        );
      }
      const request =
        prebuilt ??
        buildApprovalRequest(call, {
          projectRoot: ctx.projectRoot,
          policyClass: ctx.dispatcher.policyClass?.(call.name),
          reason: reason ?? ctx.dispatcher.approvalReason?.(call),
          alwaysAsks: ctx.dispatcher.alwaysAsks?.(call.name),
        });
      const key = request.key;
      if (key && ctx.waiting) stops.push(ctx.waiting.add(key, finish));
      ctx.emit({
        type: 'approval_request',
        call,
        request,
        withdrawn: withdraw.signal,
        decide: (decision) => {
          finish(decision);
          // The same answer goes to every other ask of the same call, each recorded by its own run.
          if (key) ctx.waiting?.answer(key, decision);
        },
      });
    });

  const delegates = (index: number) => ctx.dispatcher.policyClass?.(calls[index].name) === 'delegate';

  /** Take the step's checkpoint before its first call that may change something. */
  const changeAhead = async (index: number) => {
    const current = hooked.get(index)!.call;
    if (changing || !changes(current)) return;
    changing = true;
    await ctx.beforeChange?.(current).catch(() => undefined);
  };

  /**
   * Decide one call and act on everything but running it: a denial is answered and settled,
   * a question is put to whoever answers, a grant is remembered. `run` means it may run now;
   * `settled` means it has its result; `cancelled` means the turn ended while it waited, and
   * it has no result yet.
   */
  const settleDecision = async (index: number): Promise<'run' | 'settled' | 'cancelled'> => {
    const call = calls[index];
    const current = hooked.get(index)!.call;
    const verdict = decide(index);
    if (verdict.decision === 'deny') {
      // A rule or the mode said no. The model hears why, and the rest of the step goes on.
      ctx.emit(byVerdict(call, false, verdict));
      const result = resultFor(call, 'denied', `Not run: ${verdict.reason ?? 'the permission policy denies it'}.`);
      ctx.emit({ type: 'tool_result', result });
      settle(index, result);
      return 'settled';
    }
    if (verdict.decision === 'ask') {
      const decision = await waitForDecision(current, undefined, verdict.reason, { redecide: () => decide(index) });
      if (decision === 'cancelled') {
        stopped = 'cancelled';
        return 'cancelled';
      }
      // A grant made while it waited allows it now: it runs, recorded with the rule that allowed it.
      if (isSettled(decision)) {
        ctx.emit(byVerdict(call, true, decision.settled));
        return 'run';
      }
      const read = readDecision(decision);
      ctx.emit(answered(call, read));
      if (!read.allow) {
        const output =
          read.by !== 'user'
            ? `Not run: ${read.feedback ?? `denied by ${read.by}`}`
            : read.feedback
              ? `Tool call was denied, feedback: ${read.feedback}`
              : 'Tool call was denied.';
        const result = resultFor(call, 'denied', output);
        ctx.emit({ type: 'tool_result', result });
        settle(index, result);
        // Only a person saying no takes the rest of the step back.
        if (read.by === 'user') {
          denial = { feedback: read.feedback, proceed: read.proceed };
          stopped = 'denied';
        }
        return 'settled';
      }
      if (read.scope !== 'once') ctx.dispatcher.grant?.(current, read.scope, read.pattern);
    } else if (verdict.by && recorded(call)) {
      ctx.emit(byVerdict(call, true, verdict));
    }
    return 'run';
  };

  for (let i = 0; i < calls.length; ) {
    const call = calls[i];
    if (!stopped && ctx.signal.aborted) stopped = 'cancelled';
    if (stopped) {
      const reason = stopped === 'denied' ? 'Not run: an earlier call in this step was denied.' : 'Not run: the turn was cancelled.';
      const result = resultFor(call, 'cancelled', reason);
      ctx.emit({ type: 'tool_result', result });
      settle(i, result);
      i += 1;
      continue;
    }
    if (remaining !== undefined && remaining <= 0) {
      const result = resultFor(call, 'cancelled', `Not run: the limit of ${ctx.cap} tool calls per turn was reached.`);
      ctx.emit({ type: 'tool_result', result });
      settle(i, result);
      capped += 1;
      i += 1;
      continue;
    }

    await announce(i);
    if (readOnly(i)) {
      const group: number[] = [];
      for (let j = i; j < calls.length; j += 1) {
        if (remaining !== undefined && group.length >= remaining) break;
        await announce(j);
        if (!readOnly(j)) break;
        group.push(j);
      }
      const done = await Promise.all(group.map((index) => perform(index)));
      group.forEach((index, k) => settle(index, done[k]));
      ran += group.length;
      if (remaining !== undefined) remaining -= group.length;
      i += group.length;
      continue;
    }

    // Consecutive delegations are decided one after another, then run together: a fan-out is a fan-out.
    if (delegates(i)) {
      const group: number[] = [];
      for (let j = i; j < calls.length; j += 1) {
        if (remaining !== undefined && group.length >= remaining) break;
        await announce(j);
        if (!delegates(j)) break;
        group.push(j);
      }
      const runnable: number[] = [];
      let next = i;
      for (const j of group) {
        const fate = await settleDecision(j);
        next = fate === 'cancelled' ? j : j + 1;
        if (fate === 'run') runnable.push(j);
        if (stopped) break;
      }
      if (runnable.length) {
        await changeAhead(runnable[0]);
        const done = await Promise.all(runnable.map((index) => perform(index)));
        runnable.forEach((index, k) => settle(index, done[k]));
        ran += runnable.length;
        if (remaining !== undefined) remaining -= runnable.length;
      }
      i = next;
      continue;
    }

    const fate = await settleDecision(i);
    if (fate === 'cancelled') continue;
    if (fate === 'run') {
      await changeAhead(i);
      settle(i, await perform(i));
      ran += 1;
      if (remaining !== undefined) remaining -= 1;
    }
    i += 1;
  }

  if (changing) await ctx.afterChange?.().catch(() => undefined);
  return { results, ran, capped, denial };
}
