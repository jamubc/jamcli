import type { AgentEvent, RunResult } from '../types.js';
import type { HookRunObserver } from '../hooks/index.js';
import type { Observer, Span } from './observer.js';
import { CONTENT_LIMIT } from './instrument.js';

/** Characters of a prompt, an argument, or an output a debug log line keeps. */
export const DEBUG_TEXT_LIMIT = 4_000;

const bounded = (text: string) => (text.length > DEBUG_TEXT_LIMIT ? `${text.slice(0, DEBUG_TEXT_LIMIT)}... (${text.length - DEBUG_TEXT_LIMIT} more characters)` : text);

/** Characters of a failed call's first line of output that its warning keeps. */
const REASON_LIMIT = 200;

/** Why a call failed, in the first line of its output, for the warning that reports it at any level. */
const reasonOf = (output: string) => (output.split('\n').find((line) => line.trim()) ?? '').trim().slice(0, REASON_LIMIT);

/** How long a prompt may wait before a turn cancelled behind it is worth a warning. */
export const LONG_PROMPT_MS = 60_000;

export interface SessionObservation {
  /** The span model requests, hooks, and children are made under right now. */
  current(): Span;
  readonly session: Span;
  /** Every event a turn or a compaction emits passes through here. */
  event(event: AgentEvent): void;
  startTurn(prompt: string): void;
  endTurn(result: RunResult | undefined, error?: unknown): void;
  hookRun: HookRunObserver;
  close(status: string): Promise<void>;
}

/**
 * The spans and log lines of one session: a session span, a span for each turn, each
 * tool call, each hook, and each compaction, and a log line for each of them, with
 * prompts, arguments, and outputs only at debug level.
 */
export function observeSession(
  observer: Observer,
  facts: { sessionId: string; surface: string; provider: string; model: string; permissionMode: string; sandbox: string; parent?: Span; includeContent?: boolean }
): SessionObservation {
  const content = (text: string) => (text.length > CONTENT_LIMIT ? `${text.slice(0, CONTENT_LIMIT)}... (${text.length - CONTENT_LIMIT} more characters)` : text);
  const session = observer.startSpan('session', {
    parent: facts.parent,
    attributes: {
      'gen_ai.conversation.id': facts.sessionId,
      'jamcli.surface': facts.surface,
      'gen_ai.provider.name': facts.provider,
      'gen_ai.request.model': facts.model,
      'jamcli.permission_mode': facts.permissionMode,
      'jamcli.sandbox': facts.sandbox,
    },
  });
  observer.log('info', 'session started', {
    session: facts.sessionId,
    surface: facts.surface,
    model: `${facts.provider}:${facts.model}`,
    permission_mode: facts.permissionMode,
    sandbox: facts.sandbox,
  });
  let turn: Span | undefined;
  const tools = new Map<string, Span>();
  const current = () => turn ?? session;
  // The prompts shown this turn: when each was asked, and how long each answered one waited.
  const asked = new Map<string, { tool: string; since: number }>();
  let longestPrompt = 0;

  return {
    session,
    current,
    startTurn(prompt) {
      turn = observer.startSpan('invoke_agent jamcli', {
        parent: session,
        attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': 'jamcli', 'gen_ai.conversation.id': facts.sessionId },
      });
      observer.log('info', 'turn started', { session: facts.sessionId });
      if (observer.enabled('debug')) observer.log('debug', 'prompt', { session: facts.sessionId, text: bounded(prompt) });
    },
    endTurn(result, error) {
      const message = error ? ((error as Error)?.message ?? String(error)) : result?.status === 'error' ? result.error : undefined;
      turn?.end({
        ...(message ? { error: message } : {}),
        attributes: {
          'jamcli.turn.status': result?.status ?? 'error',
          'jamcli.turn.steps': result?.turns,
          'gen_ai.usage.input_tokens': result?.usage.prompt_tokens,
          'gen_ai.usage.output_tokens': result?.usage.completion_tokens,
        },
      });
      turn = undefined;
      for (const span of tools.values()) span.end({ error: 'the turn ended first' });
      tools.clear();
      // A prompt nobody answered, or a turn stopped after a long wait on one, is how a person
      // who could not reach a prompt shows up in the log.
      const now = Date.now();
      for (const [call, prompt] of asked) {
        observer.log('warn', 'prompt unanswered', { session: facts.sessionId, tool: prompt.tool, call, waited_ms: now - prompt.since, status: result?.status ?? 'error' });
        longestPrompt = Math.max(longestPrompt, now - prompt.since);
      }
      const stuck = result?.status === 'cancelled' && (asked.size > 0 || longestPrompt >= LONG_PROMPT_MS);
      observer.log(message ? 'error' : stuck ? 'warn' : 'info', 'turn ended', {
        session: facts.sessionId,
        status: result?.status ?? 'error',
        steps: result?.turns,
        ...(longestPrompt ? { longest_prompt_ms: longestPrompt } : {}),
        ...(message ? { error: message } : {}),
      });
      asked.clear();
      longestPrompt = 0;
      if (result?.response && observer.enabled('debug')) observer.log('debug', 'response', { session: facts.sessionId, text: bounded(result.response) });
    },
    event(event) {
      switch (event.type) {
        case 'tool_call': {
          tools.get(event.call.id)?.end({ error: 'called again' });
          tools.set(
            event.call.id,
            observer.startSpan(`execute_tool ${event.call.name}`, {
              parent: current(),
              attributes: {
                'gen_ai.operation.name': 'execute_tool',
                'gen_ai.tool.name': event.call.name,
                'gen_ai.tool.call.id': event.call.id,
                ...(facts.includeContent ? { 'gen_ai.tool.call.arguments': content(JSON.stringify(event.call.arguments ?? {})) } : {}),
              },
            })
          );
          if (observer.enabled('debug')) {
            observer.log('debug', 'tool arguments', { tool: event.call.name, call: event.call.id, arguments: bounded(JSON.stringify(event.call.arguments ?? {})) });
          }
          return;
        }
        case 'tool_result': {
          const result = event.result;
          const failed = result.status === 'error' || result.status === 'timeout';
          const id = result.callId ?? '';
          tools.get(id)?.end({
            ...(failed ? { error: result.status } : {}),
            attributes: {
              'jamcli.tool.status': result.status ?? (result.success ? 'ok' : 'error'),
              ...(facts.includeContent ? { 'gen_ai.tool.call.result': content(result.output ?? '') } : {}),
            },
          });
          tools.delete(id);
          observer.log(failed ? 'warn' : 'info', 'tool call', {
            tool: result.tool,
            call: result.callId,
            status: result.status,
            duration_ms: result.durationMs,
            ...(failed && reasonOf(result.output ?? '') ? { error: reasonOf(result.output ?? '') } : {}),
          });
          if (observer.enabled('debug')) observer.log('debug', 'tool output', { tool: result.tool, call: result.callId, output: bounded(result.output ?? '') });
          return;
        }
        case 'approval_request':
          asked.set(event.call.id, { tool: event.call.name, since: Date.now() });
          observer.log('info', 'approval requested', { tool: event.call.name, call: event.call.id, ...(event.request?.reason ? { reason: event.request.reason } : {}) });
          return;
        case 'approval_decision': {
          const prompt = asked.get(event.callId);
          asked.delete(event.callId);
          const waited = prompt ? Date.now() - prompt.since : undefined;
          if (waited !== undefined) longestPrompt = Math.max(longestPrompt, waited);
          observer.log('info', 'approval', {
            tool: event.tool,
            call: event.callId,
            allow: event.allow,
            by: event.by,
            ...(event.rule ? { rule: event.rule } : {}),
            ...(waited !== undefined ? { waited_ms: waited } : {}),
          });
          return;
        }
        case 'usage':
          observer.log('info', 'model usage', {
            model: event.model,
            input_tokens: event.usage.prompt_tokens,
            output_tokens: event.usage.completion_tokens,
            cached_tokens: event.usage.cached_tokens,
            cost_usd: event.cost,
            ...(event.delegatedSession ? { delegated_session: event.delegatedSession } : {}),
          });
          return;
        case 'retry':
          observer.log('warn', 'retry', { attempt: event.attempt, delay_ms: event.delayMs, reason: event.reason });
          return;
        case 'compaction': {
          const endMs = Date.now();
          observer
            .startSpan('compaction', {
              parent: current(),
              startMs: endMs - (event.durationMs ?? 0),
              attributes: {
                'jamcli.compaction.trigger': event.trigger,
                'jamcli.compaction.strategy': event.strategy,
                'jamcli.compaction.before_tokens': event.beforeTokens,
                'jamcli.compaction.after_tokens': event.afterTokens,
                'jamcli.compaction.replaced': event.replaced,
              },
            })
            .end({ endMs, ...(event.strategy === 'drop' ? { error: 'the summary failed, so messages were left out' } : {}) });
          observer.log('info', 'compaction', { trigger: event.trigger, strategy: event.strategy, before_tokens: event.beforeTokens, after_tokens: event.afterTokens });
          return;
        }
        case 'notice':
          observer.log(event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'info', event.message, event.code ? { code: event.code } : {});
          return;
        default:
          return;
      }
    },
    hookRun(run) {
      observer
        .startSpan(`hook ${run.event}`, { parent: current(), startMs: run.startMs, attributes: { 'jamcli.hook.event': run.event, 'jamcli.hook.handler': run.handler } })
        .end({ endMs: run.endMs, ...(run.error ? { error: run.error } : {}) });
      if (run.error) observer.log('warn', 'hook failed', { event: run.event, handler: run.handler, error: run.error });
    },
    async close(status) {
      session.end({ attributes: { 'jamcli.session.status': status } });
      observer.log('info', 'session ended', { session: facts.sessionId, status });
      await observer.flush();
    },
  };
}
