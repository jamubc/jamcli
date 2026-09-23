import type {
  AgentEvent,
  ApprovalDecision,
  ApprovalScope,
  JamSession,
  PolicyClass,
  ToolCall,
  ToolResult,
  ToolStatus,
} from '../types.js';
import { readDecision } from '../types.js';
import { buildApprovalRequest } from '../approval.js';
import { emitHookEvent, type HookBus } from '../hooks/index.js';

export interface DispatchableTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface DispatchContext {
  signal?: AbortSignal;
  /** Streams partial output, such as a running command's, to the surface. */
  onProgress?: (chunk: string) => void;
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

  const announce = async (call: ToolCall) => {
    ctx.emit({ type: 'tool_call', call });
    await emitHookEvent(ctx.hooks, 'pre_tool', { session: ctx.session, call }, ctx.emit);
  };

  const perform = async (call: ToolCall): Promise<ToolResult> => {
    const started = Date.now();
    let result: ToolResult;
    try {
      result = await ctx.dispatcher.execute(call, {
        signal: ctx.signal,
        onProgress: (chunk) => ctx.emit({ type: 'tool_progress', callId: call.id, tool: call.name, chunk }),
      });
    } catch (error: any) {
      const cancelled = ctx.signal.aborted || error?.name === 'AbortError';
      result = resultFor(call, cancelled ? 'cancelled' : 'error', `Tool ${call.name} failed: ${error?.message ?? error}`, Date.now() - started);
    }
    const status = result.status ?? (result.success ? 'ok' : 'error');
    const settled: ToolResult = { ...result, tool: call.name, callId: call.id, status, success: status === 'ok' };
    ctx.emit({ type: 'tool_result', result: settled });
    return settled;
  };

  const settle = (index: number, result: ToolResult) => {
    results[index] = result;
  };

  const readOnly = (call: ToolCall) =>
    Boolean(ctx.dispatcher.isReadOnly?.(call.name)) && !ctx.dispatcher.requiresApproval(call.name, call);

  const waitForDecision = (call: ToolCall): Promise<ApprovalDecision | 'cancelled'> =>
    new Promise((resolve) => {
      if (ctx.signal.aborted) return resolve('cancelled');
      const onAbort = () => resolve('cancelled');
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      const request = buildApprovalRequest(call, {
        projectRoot: ctx.projectRoot,
        policyClass: ctx.dispatcher.policyClass?.(call.name),
        reason: ctx.dispatcher.approvalReason?.(call),
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

    if (readOnly(call)) {
      const group: number[] = [];
      for (let j = i; j < calls.length && readOnly(calls[j]); j += 1) {
        if (remaining !== undefined && group.length >= remaining) break;
        group.push(j);
      }
      for (const index of group) await announce(calls[index]);
      const done = await Promise.all(group.map((index) => perform(calls[index])));
      group.forEach((index, k) => settle(index, done[k]));
      ran += group.length;
      if (remaining !== undefined) remaining -= group.length;
      i += group.length;
      continue;
    }

    await announce(call);
    if (ctx.dispatcher.requiresApproval(call.name, call)) {
      const decision = await waitForDecision(call);
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
        by: 'user',
        ...(read.feedback ? { feedback: read.feedback } : {}),
        ...(read.pattern ? { rule: read.pattern } : {}),
      });
      if (!read.allow) {
        const output = read.feedback
          ? `Denied by the user, who said: ${read.feedback}`
          : 'Denied by the user. The call did not run.';
        const result = resultFor(call, 'denied', output);
        ctx.emit({ type: 'tool_result', result });
        settle(i, result);
        denial = { feedback: read.feedback };
        stopped = 'denied';
        i += 1;
        continue;
      }
      if (read.scope !== 'once') ctx.dispatcher.grant?.(call, read.scope, read.pattern);
    }
    settle(i, await perform(call));
    ran += 1;
    if (remaining !== undefined) remaining -= 1;
    i += 1;
  }

  return { results, ran, capped, denial };
}
