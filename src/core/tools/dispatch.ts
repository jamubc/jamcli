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
  /** Remember a grant the user chose at approval time. */
  grant?(call: ToolCall, scope: ApprovalScope, pattern?: string): void;
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
}

export interface BatchOutcome {
  /** One result per call, in the order the calls were made. */
  results: ToolResult[];
  /** Calls that actually executed. */
  ran: number;
  /** Calls not run because the per-turn cap was reached. */
  capped: number;
  /** Present when the user denied a call; carries any feedback they wrote. */
  denial?: { feedback?: string };
}

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
        requestApproval: ({ call: nested, request }) => {
          // A nested call is shown under the call it came from, so its id cannot collide.
          const scoped: ToolCall = { ...nested, id: `${call.id}/${nested.id}` };
          return waitForDecision(scoped, request && { ...request, id: scoped.id, call: scoped });
        },
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

  const waitForDecision = (call: ToolCall, prebuilt?: ApprovalRequest, reason?: string): Promise<ApprovalDecision | 'cancelled'> =>
    new Promise((resolve) => {
      if (ctx.signal.aborted) return resolve('cancelled');
      const onAbort = () => resolve('cancelled');
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      const request =
        prebuilt ??
        buildApprovalRequest(call, {
          projectRoot: ctx.projectRoot,
          policyClass: ctx.dispatcher.policyClass?.(call.name),
          reason: reason ?? ctx.dispatcher.approvalReason?.(call),
        });
      ctx.emit({
        type: 'approval_request',
        call,
        request,
        decide: (decision) => {
          ctx.signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
      });
    });

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

    const current = hooked.get(i)!.call;
    const verdict = decide(i);
    if (verdict.decision === 'deny') {
      // A rule or the mode said no. The model hears why, and the rest of the step goes on.
      ctx.emit({
        type: 'approval_decision',
        callId: call.id,
        tool: call.name,
        allow: false,
        scope: 'once',
        by: verdict.by ?? 'policy',
        ...(verdict.rule ? { rule: verdict.rule } : {}),
        ...(verdict.reason ? { reason: verdict.reason } : {}),
      });
      const result = resultFor(call, 'denied', `Not run: ${verdict.reason ?? 'the permission policy denies it'}.`);
      ctx.emit({ type: 'tool_result', result });
      settle(i, result);
      i += 1;
      continue;
    }
    if (verdict.decision === 'ask') {
      const decision = await waitForDecision(current, undefined, verdict.reason);
      if (decision === 'cancelled') {
        stopped = 'cancelled';
        continue;
      }
      const read = readDecision(decision);
      ctx.emit({
        type: 'approval_decision',
        callId: call.id,
        tool: call.name,
        allow: read.allow,
        scope: read.scope,
        by: read.by,
        ...(read.feedback ? { feedback: read.feedback } : {}),
        ...(read.pattern ? { rule: read.pattern } : {}),
      });
      if (!read.allow) {
        const output =
          read.by !== 'user'
            ? `Not run: ${read.feedback ?? `denied by ${read.by}`}`
            : read.feedback
              ? `Denied by the user, who said: ${read.feedback}`
              : 'Denied by the user. The call did not run.';
        const result = resultFor(call, 'denied', output);
        ctx.emit({ type: 'tool_result', result });
        settle(i, result);
        // Only a person saying no takes the rest of the step back.
        if (read.by === 'user') {
          denial = { feedback: read.feedback };
          stopped = 'denied';
        }
        i += 1;
        continue;
      }
      if (read.scope !== 'once') ctx.dispatcher.grant?.(current, read.scope, read.pattern);
    } else if (verdict.by && recorded(call)) {
      ctx.emit({
        type: 'approval_decision',
        callId: call.id,
        tool: call.name,
        allow: true,
        scope: 'once',
        by: verdict.by,
        ...(verdict.rule ? { rule: verdict.rule } : {}),
        ...(verdict.reason ? { reason: verdict.reason } : {}),
      });
    }
    if (!changing && changes(current)) {
      changing = true;
      await ctx.beforeChange?.(current).catch(() => undefined);
    }
    settle(i, await perform(i));
    ran += 1;
    if (remaining !== undefined) remaining -= 1;
    i += 1;
  }

  if (changing) await ctx.afterChange?.().catch(() => undefined);
  return { results, ran, capped, denial };
}
