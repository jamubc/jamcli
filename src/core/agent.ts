import type { Agent, AgentEvent, ChatMessage, JamSession, RunResult, RunStatus, ToolCall, ToolResult } from './types.js';
import { addModelUsage, addUsage, appendMessages } from './state.js';
import type { ChatProvider, ProviderRequestOptions, StreamChunk, ToolDefinition } from './providers/types.js';
import { executeBatch, type ToolDispatcher } from './tools/dispatch.js';
import { HeadTailBuffer } from './tools/command.js';
import { screenToolResults, type ScreeningCandidate } from './trust/index.js';
import { emitHookEvent, type HookBus } from './hooks/index.js';
import type { AgentLoopConfig } from '../types/config.js';
import { DEFAULT_AGENT_LOOP_CONFIG } from '../types/config.js';

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
  trustOffNote?: boolean;
  hooks?: HookBus;
  reasoning?: ProviderRequestOptions['reasoning'];
  maxOutputTokens?: number;
  contextLength?: number;
}

interface StepOutput {
  text: string;
  reasoning: string;
  done?: StreamChunk;
}

const userMessage = (content: string): ChatMessage => ({ role: 'user', content, timestamp: Date.now() });

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
  private trustNoted = false;

  constructor(private readonly options: AgentOptions = {}) {
    const loop = options.loop;
    this.maxSteps = options.maxSteps ?? loop?.max_steps ?? DEFAULT_AGENT_LOOP_CONFIG.max_steps;
    this.maxToolCallsPerTurn =
      options.maxToolCallsPerTurn ?? loop?.max_tool_calls_per_turn ?? DEFAULT_AGENT_LOOP_CONFIG.max_tool_calls_per_turn;
    this.truncationLimit = options.truncationLimit ?? loop?.tool_result_max_chars ?? DEFAULT_AGENT_LOOP_CONFIG.tool_result_max_chars;
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
    let working = prompt ? appendMessages(session, [userMessage(prompt)]) : session;
    const finish = (status: RunStatus, response: string, steps: number, error?: string): RunResult => {
      emit({ type: 'turn_end', status });
      return { status, sessionId: session.id, response, turns: steps, usage: { ...working.usage }, session: working, ...(error ? { error } : {}) };
    };
    if (!provider) {
      return finish('error', '', 0, 'No model provider is configured for this session.');
    }

    emit({ type: 'turn_start', prompt });
    await emitHookEvent(hooks, 'turn_start', { session: working, prompt, messages: working.messages }, emit);
    const tools = dispatcher && this.options.toolDefinitions?.length ? this.options.toolDefinitions : undefined;
    const cap = this.maxToolCallsPerTurn > 0 ? this.maxToolCallsPerTurn : undefined;
    const turnPrompt = prompt || [...working.messages].reverse().find((m) => m.role === 'user')?.content || '';
    let usedCalls = 0;
    let steps = 0;

    for (;;) {
      if (signal.aborted) return finish('cancelled', '', steps);
      if (steps >= this.maxSteps) {
        return finish('limit', `Stopped after ${this.maxSteps} steps without a final answer.`, steps);
      }
      steps += 1;
      emit({ type: 'step_start', step: steps });

      let step: StepOutput;
      try {
        step = await this.streamStep(provider, this.project(working.messages), tools, signal, emit);
      } catch (error: any) {
        const partial: string = error?.partialText ?? '';
        if (partial) working = appendMessages(working, [this.assistantMessage(partial, '', [], undefined)]);
        if (signal.aborted || error?.name === 'AbortError') return finish('cancelled', partial, steps);
        const message = error?.message ?? String(error);
        emit({ type: 'notice', level: 'error', message });
        return finish('error', partial, steps, message);
      }

      const usage = step.done?.usage;
      if (usage) {
        working = addUsage(working, usage);
        if (this.options.modelUsageKey) working = addModelUsage(working, this.options.modelUsageKey, usage);
        emit({ type: 'usage', usage });
      }

      const { calls, unusable } = normalizeCalls(step.done?.toolCalls, steps);
      working = appendMessages(working, [this.assistantMessage(step.text, step.reasoning, calls, step.done)]);
      if (unusable) {
        emit({ type: 'notice', level: 'warn', message: `The model returned ${unusable} tool call(s) without a tool name; they were ignored.` });
      }
      if (!calls.length) {
        if (unusable) {
          working = appendMessages(working, [userMessage('[Your last tool call had no tool name and was ignored. Name the tool you want to call.]')]);
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
      });
      usedCalls += batch.ran;

      const results = await this.screen(turnPrompt, calls, batch.results, signal, emit);
      for (let i = 0; i < calls.length; i += 1) {
        const output = this.truncate(results[i].output);
        working = appendMessages(working, [{ role: 'tool', content: output, tool_call_id: calls[i].id, timestamp: Date.now() }]);
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
  ): Promise<ToolResult[]> {
    const candidates: (ScreeningCandidate & { index: number })[] = [];
    results.forEach((result, index) => {
      if (result.status === 'ok' || result.status === 'error') candidates.push({ tool: calls[index].name, output: result.output, index });
    });
    if (!candidates.length) return results;
    const screening = await screenToolResults({
      prompt,
      provider: this.options.trustProvider,
      model: this.options.trustModel,
      signal,
      candidates,
    });
    if (this.options.trustOffNote && !this.trustNoted) {
      this.trustNoted = true;
      for (const note of screening.notes) emit({ type: 'notice', level: 'info', message: note });
    }
    const kept = new Set<ScreeningCandidate>(screening.kept);
    const removals = [...screening.deduped, ...screening.dropped];
    let removalIndex = 0;
    const out = [...results];
    for (const candidate of candidates) {
      if (kept.has(candidate)) continue;
      const removal = removals[removalIndex++];
      const reason = removal?.reason ?? 'removed by the trust gate';
      emit({ type: 'notice', level: 'warn', message: `Removed ${candidate.tool} result: ${reason}` });
      out[candidate.index] = { ...out[candidate.index], output: `[This result was withheld by the trust gate: ${reason}.]` };
    }
    return out;
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
