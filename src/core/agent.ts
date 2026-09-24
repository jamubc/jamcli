import type { Agent, AgentEvent, ChatMessage, JamSession, RunResult, RunStatus, TokenUsage, ToolCall, ToolResult } from './types.js';
import { addModelUsage, addUsage, appendMessages } from './state.js';
import { clockPast, prefixSetNow, type ChatProvider, type ProviderRequestOptions, type StreamChunk, type ToolDefinition } from './providers/types.js';
import { executeBatch, type ToolDispatcher } from './tools/dispatch.js';
import { HeadTailBuffer } from './tools/command.js';
import { screenToolResults, type ScreeningCandidate } from './trust/index.js';
import { requestCost } from './catalog/cost.js';
import type { ModelPrice } from './catalog/types.js';
import { KEEP_SHARE, compact, estimateRequest, isContextOverflow, type ContextBudget, type TokenCounter } from './context/index.js';
import { emitHookEvent, type HookBus } from './hooks/index.js';
import type { AgentLoopConfig } from '../types/config.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';
import { createRedactor, type Redactor } from './redact.js';

export interface AgentOptions {
  maxSteps?: number;
  provider?: ChatProvider;
  model?: string;
  temperature?: number;
  modelUsageKey?: string;
  /** Cancels every run of this agent when aborted. */
  signal?: AbortSignal;
  dispatcher?: ToolDispatcher;
  toolDefinitions?: ToolDefinition[];
  /** Tool calls allowed per user turn; 0 or undefined means no cap. */
  maxToolCallsPerTurn?: number;
  truncationLimit?: number;
  systemPrompt?: string;
  loop?: AgentLoopConfig;
  trustProvider?: ChatProvider;
  trustModel?: string;
  /** `provider:model` of the trust gate's classifier, which its usage is recorded under. */
  trustUsageKey?: string;
  /** What the classifier costs per million tokens, when known. */
  trustPrice?: ModelPrice;
  /** Relevance below which the trust gate removes a result. */
  trustThreshold?: number;
  trustOffNote?: boolean;
  hooks?: HookBus;
  reasoning?: ProviderRequestOptions['reasoning'];
  maxOutputTokens?: number;
  contextLength?: number;
  /** What the session's model costs per million tokens. Without it, requests are unpriced. */
  price?: ModelPrice;
  /** How the model thinks, from the catalog, for providers that configure thinking per model. */
  thinkingStyle?: ProviderRequestOptions['thinkingStyle'];
  alwaysThinks?: boolean;
  /** When the request's prefix was last set: reasoning from before it is not replayed. A compaction moves it. */
  reasoningSince?: number;
  /**
   * Context management: the budget every request must fit, and the counter that estimates
   * requests and learns from what the provider reports. Without it, nothing is compacted.
   */
  context?: {
    budget: ContextBudget;
    counter: TokenCounter;
    /** Compact on its own: ahead of a request, or when the provider refuses one as too long. Defaults to true. */
    auto?: boolean;
    /**
     * Compact ahead of a request that would pass the trigger. Off when the window is a guess,
     * so an unknown model compacts only when its provider says the conversation is too long.
     */
    proactive?: boolean;
  };
  /** Replaces credentials in tool output. Defaults to the credentials in the environment. */
  redact?: Redactor;
  /** Called once per step, before the first call that may change something, to take a checkpoint. */
  beforeChange?: (call: ToolCall) => Promise<void>;
  /** Called once that step's calls are done, to settle the checkpoint. */
  afterChange?: () => Promise<void>;
}

interface StepOutput {
  text: string;
  reasoning: string;
  done?: StreamChunk;
}

const userMessage = (content: string): ChatMessage => ({ role: 'user', content, timestamp: Date.now() });

/** How each wire format says a reply was cut off at the output limit: Anthropic, then OpenAI and Ollama. */
const OUTPUT_LIMIT_REASONS = new Set(['max_tokens', 'length']);

/**
 * The turn engine. A user turn is a loop of steps: stream the model's reply, record it
 * as one assistant message with its text, reasoning, and every tool call, run the calls,
 * and record exactly one result for each. The loop ends when the model stops calling
 * tools, the user takes back control, a limit is reached, or the run is cancelled.
 */
export class CoreAgent implements Agent {
  private readonly running = new Map<string, AbortController>();
  private readonly maxSteps: number;
  private readonly maxToolCallsPerTurn: number;
  private readonly truncationLimit: number;
  private readonly redact: Redactor;
  private trustNoted = false;
  private reasoningSince?: number;

  constructor(private readonly options: AgentOptions = {}) {
    const loop = options.loop;
    this.maxSteps = options.maxSteps ?? loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps;
    this.maxToolCallsPerTurn =
      options.maxToolCallsPerTurn ?? loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn;
    this.truncationLimit = options.truncationLimit ?? loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars;
    this.redact = options.redact ?? createRedactor();
    this.reasoningSince = options.reasoningSince;
  }

  /**
   * Compact a session now, as `/compact` asks: the older part of the conversation becomes a
   * summary that gives particular attention to `focus`. Returns the session unchanged when
   * there is nothing to compact.
   */
  async compact(
    session: JamSession,
    onEvent: (e: AgentEvent) => void,
    options: { focus?: string; signal?: AbortSignal } = {}
  ): Promise<{ session: JamSession; compacted: boolean }> {
    const signal = options.signal ?? this.options.signal ?? new AbortController().signal;
    const result = await this.compactNow(session, onEvent, signal, 'manual', options.focus);
    return { session: result.session, compacted: result.compacted };
  }

  /** Abort the running turn of a session, if there is one. */
  cancel(sessionId: string): void {
    this.running.get(sessionId)?.abort();
  }

  async run(session: JamSession, prompt: string, onEvent: (e: AgentEvent) => void): Promise<RunResult> {
    const controller = new AbortController();
    const external = this.options.signal;
    const relay = () => controller.abort();
    if (external?.aborted) controller.abort();
    external?.addEventListener('abort', relay, { once: true });
    this.running.set(session.id, controller);
    try {
      return await this.turn(session, prompt, onEvent, controller.signal);
    } finally {
      external?.removeEventListener('abort', relay);
      if (this.running.get(session.id) === controller) this.running.delete(session.id);
    }
  }

  /** Keep the beginning and the end of long output, and say how much was cut. */
  truncate(text: string): string {
    if (!text || text.length <= this.truncationLimit) return text ?? '';
    const buffer = new HeadTailBuffer(this.truncationLimit);
    buffer.push(text);
    return buffer.toString();
  }

  private async turn(
    session: JamSession,
    prompt: string,
    emit: (e: AgentEvent) => void,
    signal: AbortSignal
  ): Promise<RunResult> {
    const { provider, dispatcher, hooks } = this.options;
    await clockPast(this.reasoningSince);
    let working = session;
    const record = (message: ChatMessage) => {
      working = appendMessages(working, [message]);
      emit({ type: 'message', message });
    };
    const finish = (status: RunStatus, response: string, steps: number, error?: string): RunResult => {
      emit({ type: 'turn_end', status });
      return { status, sessionId: session.id, response, turns: steps, usage: { ...working.usage }, session: working, ...(error ? { error } : {}) };
    };
    if (!provider) {
      return finish('error', '', 0, 'No model provider is configured for this session.');
    }

    emit({ type: 'turn_start', prompt });
    if (prompt) record(userMessage(prompt));
    await emitHookEvent(hooks, 'turn_start', { session: working, prompt, messages: working.messages }, emit);
    const tools = dispatcher && this.options.toolDefinitions?.length ? this.options.toolDefinitions : undefined;
    const cap = this.maxToolCallsPerTurn > 0 ? this.maxToolCallsPerTurn : undefined;
    const turnPrompt = prompt || [...working.messages].reverse().find((m) => m.role === 'user')?.content || '';
    let usedCalls = 0;
    let steps = 0;
    const context = this.options.context;
    let compactable = context?.auto !== false && context?.proactive !== false;

    for (;;) {
      if (signal.aborted) return finish('cancelled', '', steps);
      if (steps >= this.maxSteps) {
        return finish('limit', `Stopped after ${this.maxSteps} steps without a final answer.`, steps);
      }
      steps += 1;
      emit({ type: 'step_start', step: steps });

      if (context && compactable && this.countContext(working.messages) > context.budget.trigger) {
        try {
          const fitted = await this.compactNow(working, emit, signal, 'auto');
          working = fitted.session;
          // What compaction cannot bring under the threshold, it will not bring under by trying again this turn.
          if (!fitted.compacted || this.countContext(working.messages) > context.budget.trigger) {
            compactable = false;
            emit({
              type: 'notice',
              level: 'warn',
              message:
                `The conversation is still above the compaction threshold (${this.countContext(working.messages).toLocaleString('en-US')} of ` +
                `${context.budget.trigger.toLocaleString('en-US')} tokens), and nothing more can be summarized this turn. The provider may refuse the request.`,
            });
          }
        } catch (error: any) {
          if (signal.aborted || error?.name === 'AbortError') return finish('cancelled', '', steps);
          throw error;
        }
      }
      let step: StepOutput | undefined;
      let estimated = 0;
      let retried = false;
      while (!step) {
        // Uncorrected, so the provider's count can correct it.
        estimated = context ? estimateRequest({ system: this.options.systemPrompt, tools, messages: working.messages }) : 0;
        try {
          step = await this.streamStep(provider, this.project(working.messages), tools, signal, emit);
        } catch (error: any) {
          const partial: string = error?.partialText ?? '';
          if (partial) record(this.assistantMessage(partial, '', [], undefined));
          if (signal.aborted || error?.name === 'AbortError') return finish('cancelled', partial, steps);
          // Refused as too long: compact, keeping a share of what was sent, and try once more.
          if (!retried && !partial && context && context.auto !== false && isContextOverflow(error)) {
            retried = true;
            const keepTokens = Math.floor(Math.min(context.budget.budget, this.countContext(working.messages)) * KEEP_SHARE);
            const fitted = await this.compactNow(working, emit, signal, 'auto', undefined, keepTokens).catch((compactError) => {
              if (signal.aborted) throw compactError;
              return { session: working, compacted: false };
            });
            if (fitted.compacted) {
              working = fitted.session;
              continue;
            }
          }
          const message = error?.message ?? String(error);
          emit({ type: 'notice', level: 'error', message });
          return finish('error', partial, steps, message);
        }
      }

      const usage = step.done?.usage;
      if (usage) {
        working = this.account(working, usage, this.options.modelUsageKey, this.options.price, emit);
        // Ollama can leave a cached prefix out of its count, so its counts do not correct the estimate.
        if (context && provider.family !== 'ollama') context.counter.observe(estimated, usage.prompt_tokens);
      } else if (step.done) {
        // A server that reports no counts was still asked: the request is counted, with no
        // tokens and a cost that is known only when the model is free.
        const price = this.options.price;
        const free = price !== undefined && price.input === 0 && price.output === 0;
        const model = this.options.modelUsageKey;
        emit({ type: 'usage', usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, ...(model ? { model } : {}), ...(free ? { cost: 0 } : {}), unreported: true });
      }

      const { calls, unusable } = normalizeCalls(step.done?.toolCalls, steps);
      record(this.assistantMessage(step.text, step.reasoning, calls, step.done));
      if (step.done?.stopReason === 'refusal') {
        emit({
          type: 'notice',
          level: 'warn',
          message: 'The model declined this request, so the reply may be empty or partial. Rephrase it, or switch models with /model.',
        });
      }
      if (OUTPUT_LIMIT_REASONS.has(step.done?.stopReason ?? '')) {
        const limit = this.options.maxOutputTokens;
        emit({
          type: 'notice',
          level: 'warn',
          message:
            `The reply stopped at the output limit${limit ? ` of ${limit.toLocaleString('en-US')} tokens` : ''}, so it may be incomplete. ` +
            'Raise agent_loop.max_output_tokens, or ask the model to continue.',
        });
      }
      if (unusable) {
        emit({ type: 'notice', level: 'warn', message: `The model returned ${unusable} tool call(s) without a tool name; they were ignored.` });
      }
      if (!calls.length) {
        if (unusable) {
          record(userMessage('[Your last tool call had no tool name and was ignored. Name the tool you want to call.]'));
          continue;
        }
        return finish('ok', step.text, steps);
      }

      if (!dispatcher) {
        return finish('error', step.text, steps, 'The model called a tool, but this session has no tools.');
      }
      const batch = await executeBatch(calls, {
        dispatcher,
        emit,
        signal,
        projectRoot: session.projectRoot,
        session: working,
        hooks,
        remaining: cap === undefined ? undefined : cap - usedCalls,
        cap,
        redact: this.redact,
        ...(this.options.beforeChange ? { beforeChange: this.options.beforeChange } : {}),
        ...(this.options.afterChange ? { afterChange: this.options.afterChange } : {}),
      });
      usedCalls += batch.ran;

      const screened = await this.screen(turnPrompt, calls, batch.results, signal, emit);
      if (screened.usage) {
        working = this.account(working, screened.usage, this.options.trustUsageKey, this.options.trustPrice, emit);
      }
      const results = screened.results;
      for (let i = 0; i < calls.length; i += 1) {
        const output = this.truncate(results[i].output);
        record({
          role: 'tool',
          content: output,
          tool_call_id: calls[i].id,
          toolName: calls[i].name,
          toolStatus: results[i].status ?? (results[i].success ? 'ok' : 'error'),
          timestamp: Date.now(),
        });
        await emitHookEvent(hooks, 'post_tool', { session: working, call: calls[i], result: results[i], output }, emit);
      }

      if (signal.aborted) return finish('cancelled', step.text, steps);
      if (batch.denial && !batch.denial.feedback) {
        return finish('refused', step.text || 'Stopped because a tool call was denied.', steps);
      }
      if (cap !== undefined && batch.capped > 0 && batch.ran === 0) {
        return finish('limit', `Stopped: the limit of ${cap} tool calls per turn was reached.`, steps);
      }
    }
  }

  /** The tool definitions a request carries. */
  private requestTools(): ToolDefinition[] | undefined {
    return this.options.dispatcher && this.options.toolDefinitions?.length ? this.options.toolDefinitions : undefined;
  }

  /** The corrected estimate of a request carrying these messages, with the system prompt and tools. */
  private countContext(messages: ChatMessage[]): number {
    return this.options.context!.counter.count({ system: this.options.systemPrompt, tools: this.requestTools(), messages });
  }

  /**
   * Replace the older part of the conversation with a summary, report it, and account for
   * the summary request. Returns the session unchanged when nothing can be compacted.
   */
  private async compactNow(
    working: JamSession,
    emit: (e: AgentEvent) => void,
    signal: AbortSignal,
    trigger: 'auto' | 'manual',
    focus?: string,
    keepTokens?: number
  ): Promise<{ session: JamSession; compacted: boolean }> {
    const context = this.options.context;
    const provider = this.options.provider;
    if (!context || !provider) return { session: working, compacted: false };
    const before = this.countContext(working.messages);
    const started = Date.now();
    const result = await compact({
      messages: working.messages,
      provider,
      model: this.options.model,
      keepTokens: keepTokens ?? Math.floor(context.budget.budget * KEEP_SHARE),
      focus,
      signal,
      maxOutputTokens: this.options.maxOutputTokens,
      contextLength: this.options.contextLength,
    });
    if (!result) return { session: working, compacted: false };
    // The kept messages' reasoning was signed against the conversation the summary replaced.
    this.reasoningSince = prefixSetNow();
    await clockPast(this.reasoningSince);
    let next: JamSession = { ...working, messages: result.messages, updatedAt: Date.now() };
    if (result.usage) next = this.account(next, result.usage, this.options.modelUsageKey, this.options.price, emit);
    const after = this.countContext(next.messages);
    emit({
      type: 'compaction',
      beforeTokens: before,
      afterTokens: after,
      strategy: result.strategy,
      replaced: result.replaced,
      summary: result.summary,
      trigger,
      durationMs: Date.now() - started,
    });
    await emitHookEvent(this.options.hooks, 'compaction', { session: next, beforeTokens: before, afterTokens: after, strategy: result.strategy }, emit);
    const counts = `${before.toLocaleString('en-US')} to ${after.toLocaleString('en-US')} tokens`;
    emit(
      result.strategy === 'summary'
        ? {
            type: 'notice',
            level: 'info',
            code: 'compacted',
            message: `The earlier conversation was summarized${trigger === 'auto' ? ' to fit the context window' : ''}: ${counts}.`,
          }
        : {
            type: 'notice',
            level: 'warn',
            message: `The earlier conversation could not be summarized (${result.error}), so ${result.replaced} messages were left out to fit the context window: ${counts}.`,
          }
    );
    return { session: next, compacted: true };
  }

  /** Add a request's usage to the session and report it, priced when the price is known. */
  private account(
    session: JamSession,
    usage: TokenUsage,
    model: string | undefined,
    price: ModelPrice | undefined,
    emit: (e: AgentEvent) => void
  ): JamSession {
    let next = addUsage(session, usage);
    if (model) next = addModelUsage(next, model, usage);
    const cost = requestCost(usage, price);
    emit({ type: 'usage', usage, ...(model ? { model } : {}), ...(cost !== undefined ? { cost } : {}) });
    return next;
  }

  /** The request for a step: the system prompt first, then the conversation in order. */
  private project(messages: ChatMessage[]): ChatMessage[] {
    const system = this.options.systemPrompt;
    return system ? [{ role: 'system', content: system, timestamp: 0 }, ...messages] : messages;
  }

  private async streamStep(
    provider: ChatProvider,
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    signal: AbortSignal,
    emit: (e: AgentEvent) => void
  ): Promise<StepOutput> {
    let text = '';
    let reasoning = '';
    let done: StreamChunk | undefined;
    try {
      for await (const chunk of provider.streamChat(messages, {
        model: this.options.model,
        temperature: this.options.temperature,
        signal,
        tools,
        reasoning: this.options.reasoning ?? 'auto',
        maxOutputTokens: this.options.maxOutputTokens,
        contextLength: this.options.contextLength,
        thinkingStyle: this.options.thinkingStyle,
        alwaysThinks: this.options.alwaysThinks,
        replayReasoningSince: this.reasoningSince,
        onRetry: (info) => emit({ type: 'retry', attempt: info.attempt, delayMs: info.delayMs, reason: info.reason }),
      })) {
        if (chunk.content) {
          text += chunk.content;
          emit({ type: 'text', delta: chunk.content });
        }
        if (chunk.reasoning) {
          reasoning += chunk.reasoning;
          emit({ type: 'reasoning', delta: chunk.reasoning });
        }
        if (chunk.done) done = chunk;
      }
    } catch (error: any) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { partialText: text });
    }
    return { text, reasoning, done };
  }

  private assistantMessage(text: string, reasoning: string, calls: ToolCall[], done: StreamChunk | undefined): ChatMessage {
    return {
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(done?.reasoningBlocks?.length ? { reasoningBlocks: done.reasoningBlocks } : {}),
      ...(this.options.provider?.family ? { providerFamily: this.options.provider.family } : {}),
      ...(calls.length
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
            })),
          }
        : {}),
    };
  }

  /**
   * Screen results through the trust gate. A removed result is still answered, with a
   * note saying why, so every call keeps its result and the reason is visible.
   */
  private async screen(
    prompt: string,
    calls: ToolCall[],
    results: ToolResult[],
    signal: AbortSignal,
    emit: (e: AgentEvent) => void
  ): Promise<{ results: ToolResult[]; usage?: TokenUsage }> {
    const candidates: (ScreeningCandidate & { result: number })[] = [];
    results.forEach((result, index) => {
      if (result.status === 'ok' || result.status === 'error') candidates.push({ tool: calls[index].name, output: result.output, result: index });
    });
    if (!candidates.length) return { results };
    const screening = await screenToolResults({
      prompt,
      provider: this.options.trustProvider,
      model: this.options.trustModel,
      threshold: this.options.trustThreshold,
      signal,
      candidates,
    });
    if (this.options.trustOffNote && !this.trustNoted) {
      this.trustNoted = true;
      for (const note of screening.notes) emit({ type: 'notice', level: 'info', message: note });
    }
    const out = [...results];
    for (const removal of [...screening.deduped, ...screening.dropped]) {
      const candidate = candidates[removal.index];
      emit({ type: 'notice', level: 'warn', code: 'trust_gate', message: `Removed ${candidate.tool} result: ${removal.reason}` });
      out[candidate.result] = { ...out[candidate.result], output: `[This result was withheld by the trust gate: ${removal.reason}.]` };
    }
    return { results: out, ...(screening.usage ? { usage: screening.usage } : {}) };
  }
}

/** Give every call an id, and count the ones with no tool name. */
function normalizeCalls(raw: StreamChunk['toolCalls'], step: number): { calls: ToolCall[]; unusable: number } {
  const calls: ToolCall[] = [];
  let unusable = 0;
  (raw ?? []).forEach((call, index) => {
    const name = call?.function?.name;
    if (typeof name !== 'string' || !name) {
      unusable += 1;
      return;
    }
    let args = call.function.arguments ?? {};
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        args = { value: args };
      }
    }
    calls.push({ id: call.id || `call_${step}_${index}`, name, type: call.type || 'function', arguments: args });
  });
  return { calls, unusable };
}
