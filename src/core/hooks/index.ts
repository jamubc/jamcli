import type { AgentEvent, ChatMessage, JamSession, ToolCall, ToolResult } from '../types.js';

export type HookEventName =
  | 'session_start'
  | 'turn_start'
  | 'pre_tool'
  | 'post_tool'
  | 'compaction'
  | 'session_end';

export interface HookPayloads {
  session_start: { session: JamSession; profile?: string };
  turn_start: { session: JamSession; prompt: string; messages: ChatMessage[] };
  pre_tool: { session: JamSession; call: ToolCall };
  post_tool: { session: JamSession; call: ToolCall; result: ToolResult; output: string };
  compaction: { session: JamSession; beforeTokens: number; afterTokens?: number; strategy: string };
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

  const emit = async <K extends HookEventName>(event: K, payload: HookPayloads[K]) => {
    const failures: HookFailure[] = [];
    if (!enabled) return failures;
    const list = registrations.get(event) ?? [];
    for (const registration of list) {
      const startMs = Date.now();
      let message: string | undefined;
      try {
        await registration.handler(payload);
      } catch (error: any) {
        message = error?.message ?? String(error);
        const failure: HookFailure = { event, handler: registration.name, message: message! };
        failures.push(failure);
        recorded.push(failure);
      }
      options.onRun?.({ event, handler: registration.name, startMs, endMs: Date.now(), ...(message ? { error: message } : {}) });
    }
    return failures;
  };

  return {
    on,
    emit,
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
