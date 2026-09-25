import type { AgentEvent, ChatMessage, JamSession, ToolCall, ToolResult } from '../types.js';

export type HookEventName =
  | 'session_start'
  | 'user_prompt_submit'
  | 'turn_start'
  | 'pre_tool'
  | 'post_tool'
  | 'stop'
  | 'pre_compact'
  | 'compaction'
  | 'notification'
  | 'session_end';

export interface HookPayloads {
  session_start: { session: JamSession; profile?: string; source?: 'new' | 'resume' };
  /** Before a prompt is recorded or sent. A handler may stop it or add context to it. */
  user_prompt_submit: { session: JamSession; prompt: string };
  turn_start: { session: JamSession; prompt: string; messages: ChatMessage[] };
  /** Before a call is decided. A handler may deny, ask, allow, or replace its arguments. */
  pre_tool: { session: JamSession; call: ToolCall };
  post_tool: { session: JamSession; call: ToolCall; result: ToolResult; output: string };
  /** When the model has answered with no calls. A handler may ask it to carry on. */
  stop: { session: JamSession; response: string; stopHookActive: boolean };
  /** Before older messages are summarized. A handler may add to what the summary keeps. */
  pre_compact: { session: JamSession; trigger: 'auto' | 'manual'; focus?: string };
  compaction: { session: JamSession; beforeTokens: number; afterTokens?: number; strategy: string };
  /** When the person's attention is wanted, such as for an approval. */
  notification: { session: JamSession; message: string; level: 'info' | 'warn' | 'error' };
  session_end: { session: JamSession; status: string; turns: number };
}

export type HookHandler<K extends HookEventName = HookEventName> = (
  payload: HookPayloads[K]
) => unknown | Promise<unknown>;

export interface HookFailure {
  event: HookEventName;
  handler: string;
  message: string;
}

export interface HookBus {
  on<K extends HookEventName>(event: K, handler: HookHandler<K>, name?: string): () => void;
  emit<K extends HookEventName>(event: K, payload: HookPayloads[K]): Promise<HookFailure[]>;
  /** Run the handlers in order and keep what each returned, as a hook's verdict. */
  collect<K extends HookEventName>(event: K, payload: HookPayloads[K]): Promise<{ results: unknown[]; failures: HookFailure[] }>;
  failures(): HookFailure[];
  disable(): void;
  enable(): void;
  readonly enabled: boolean;
}

interface Registration {
  name: string;
  handler: HookHandler;
}

/** Told of every handler run, with when it started and ended, for tracing. */
export type HookRunObserver = (run: { event: HookEventName; handler: string; startMs: number; endMs: number; error?: string }) => void;

export const createHookBus = (options: { enabled?: boolean; onRun?: HookRunObserver } = {}): HookBus => {
  const registrations = new Map<HookEventName, Registration[]>();
  const recorded: HookFailure[] = [];
  let enabled = options.enabled ?? true;
  let counter = 0;

  const on = <K extends HookEventName>(event: K, handler: HookHandler<K>, name?: string) => {
    const list = registrations.get(event) ?? [];
    counter += 1;
    const registration: Registration = {
      name: name ?? `${event}-${counter}`,
      handler: handler as HookHandler,
    };
    list.push(registration);
    registrations.set(event, list);
    return () => {
      const current = registrations.get(event) ?? [];
      registrations.set(
        event,
        current.filter((item) => item !== registration)
      );
    };
  };

  const collect = async <K extends HookEventName>(event: K, payload: HookPayloads[K]) => {
    const failures: HookFailure[] = [];
    const results: unknown[] = [];
    if (!enabled) return { results, failures };
    const list = registrations.get(event) ?? [];
    for (const registration of list) {
      const startMs = Date.now();
      let message: string | undefined;
      try {
        const result = await registration.handler(payload);
        if (result !== undefined) results.push(result);
      } catch (error: any) {
        message = error?.message ?? String(error);
        const failure: HookFailure = { event, handler: registration.name, message: message! };
        failures.push(failure);
        recorded.push(failure);
      }
      options.onRun?.({ event, handler: registration.name, startMs, endMs: Date.now(), ...(message ? { error: message } : {}) });
    }
    return { results, failures };
  };

  const emit = async <K extends HookEventName>(event: K, payload: HookPayloads[K]) => (await collect(event, payload)).failures;

  return {
    on,
    emit,
    collect,
    failures: () => [...recorded],
    disable: () => {
      enabled = false;
    },
    enable: () => {
      enabled = true;
    },
    get enabled() {
      return enabled;
    },
  };
};

export const emitHookEvent = async <K extends HookEventName>(
  bus: HookBus | undefined,
  event: K,
  payload: HookPayloads[K],
  onEvent?: (event: AgentEvent) => void
) => {
  if (!bus) return;
  const failures = await bus.emit(event, payload);
  for (const failure of failures) {
    onEvent?.({
      type: 'notice',
      level: 'warn',
      code: 'hook_failed',
      message: `Hook ${failure.handler} on ${failure.event} failed: ${failure.message}`,
    });
  }
};

/**
 * What the handlers of one event decided, together. A block wins; then deny, ask, and
 * allow, in that order, as rules are; context from each is kept in order; the last
 * replacement arguments stand. A failed handler is reported and decides nothing.
 */
export interface HookVerdict {
  /** A handler stopped it, with why: the prompt is not sent, the call not made, the turn not ended. */
  block?: string;
  decision?: 'allow' | 'deny' | 'ask';
  reason?: string;
  /** Text to add to what the model sees for this event. */
  context: string[];
  /** Replacement arguments for a call, not yet checked against the tool's schema. */
  updatedInput?: Record<string, unknown>;
}

const DECISION_ORDER = ['deny', 'ask', 'allow'] as const;

export function mergeVerdicts(results: unknown[]): HookVerdict {
  const merged: HookVerdict = { context: [] };
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    const verdict = result as Partial<HookVerdict>;
    if (verdict.block !== undefined && merged.block === undefined) merged.block = verdict.block;
    if (verdict.decision && DECISION_ORDER.includes(verdict.decision)) {
      const stronger = !merged.decision || DECISION_ORDER.indexOf(verdict.decision) < DECISION_ORDER.indexOf(merged.decision);
      if (stronger) {
        merged.decision = verdict.decision;
        merged.reason = verdict.reason;
      }
    }
    if (Array.isArray(verdict.context)) merged.context.push(...verdict.context.filter((text) => typeof text === 'string' && text.trim()));
    if (verdict.updatedInput && typeof verdict.updatedInput === 'object') merged.updatedInput = verdict.updatedInput;
  }
  return merged;
}

/** Ask an event's handlers for their verdict, reporting any that failed as notices. */
export const hookVerdict = async <K extends HookEventName>(
  bus: HookBus | undefined,
  event: K,
  payload: HookPayloads[K],
  onEvent?: (event: AgentEvent) => void
): Promise<HookVerdict> => {
  if (!bus) return { context: [] };
  const { results, failures } = await bus.collect(event, payload);
  for (const failure of failures) {
    onEvent?.({ type: 'notice', level: 'warn', code: 'hook_failed', message: `Hook ${failure.handler} on ${failure.event} failed: ${failure.message}` });
  }
  return mergeVerdicts(results);
};
