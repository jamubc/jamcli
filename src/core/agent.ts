import type { Agent, AgentEvent, ChatMessage, JamSession, RunResult, RunStatus, TokenUsage } from './types.js';
import { addModelUsage, addUsage, appendMessages, isCancelled } from './state.js';
import type { ChatProvider, ToolDefinition } from './providers/types.js';
import { dispatchToolCalls, toProviderToolMessages, type ToolDispatcher } from './tools/dispatch.js';
import { screenToolResults } from './trust/index.js';
import { emitHookEvent, type HookBus } from './hooks/index.js';

import type { AgentLoopConfig } from '../types/config.js';

export interface AgentOptions {
  maxSteps?: number;
  provider?: ChatProvider;
  model?: string;
  temperature?: number;
  modelUsageKey?: string;
  signal?: AbortSignal;
  dispatcher?: ToolDispatcher;
  toolDefinitions?: ToolDefinition[];
  maxToolCallsPerTurn?: number;
  truncationLimit?: number;
  systemPrompt?: string;
  loop?: AgentLoopConfig;
  trustProvider?: ChatProvider;
  trustModel?: string;
  trustOffNote?: boolean;
  hooks?: HookBus;
}

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_TOOL_CALLS = 5;
const DEFAULT_TRUNCATION_LIMIT = 2000;

export class CoreAgent implements Agent {
  private cancelled = new Set<string>();
  private maxSteps: number;
  private provider?: ChatProvider;
  private model?: string;
  private temperature?: number;
  private modelUsageKey?: string;
  private signal?: AbortSignal;
  private dispatcher?: ToolDispatcher;
  private toolDefinitions?: ToolDefinition[];
  private maxToolCallsPerTurn: number;
  private truncationLimit: number;
  private systemPrompt?: string;
  private trustProvider?: ChatProvider;
  private trustModel?: string;
  private trustOffNote: boolean;
  private trustNoted = false;
  private hooks?: HookBus;

  constructor(options: AgentOptions = {}) {
    const loop = options.loop;
    this.maxSteps = options.maxSteps ?? loop?.max_steps ?? DEFAULT_MAX_STEPS;
    this.provider = options.provider;
    this.model = options.model;
    this.temperature = options.temperature;
    this.modelUsageKey = options.modelUsageKey;
    this.signal = options.signal;
    this.dispatcher = options.dispatcher;
    this.toolDefinitions = options.toolDefinitions;
    this.maxToolCallsPerTurn = options.maxToolCallsPerTurn ?? loop?.max_tool_calls_per_turn ?? DEFAULT_MAX_TOOL_CALLS;
    this.truncationLimit = options.truncationLimit ?? loop?.tool_result_max_chars ?? DEFAULT_TRUNCATION_LIMIT;
    this.systemPrompt = options.systemPrompt;
    this.trustProvider = options.trustProvider;
    this.trustModel = options.trustModel;
    this.trustOffNote = options.trustOffNote ?? false;
    this.hooks = options.hooks;
  }

  cancel(sessionId: string): void {
    this.cancelled.add(sessionId);
  }

  async run(session: JamSession, prompt: string, onEvent: (e: AgentEvent) => void): Promise<RunResult> {
    if (this.dispatcher && this.toolDefinitions?.length) {
      return this.runWithTools(session, prompt, onEvent);
    }
    await emitHookEvent(this.hooks, 'turn_start', { session, prompt, messages: session.messages });
    let working = appendMessages(session, [userMessage(prompt)]);
    let response = '';
    let turns = 0;

    while (turns < this.maxSteps) {
      if (isCancelled(session.id, this.cancelled)) {
        this.cancelled.delete(session.id);
        return this.finish(working, 'cancelled', response, turns);
      }

      const reply = await this.complete(working, prompt, onEvent);
      response = reply.text;
      working = appendMessages(working, [assistantMessage(reply.text, reply.reasoning)]);
      if (reply.usage) {
        working = addUsage(working, reply.usage);
        if (this.modelUsageKey) {
          working = addModelUsage(working, this.modelUsageKey, reply.usage);
        }
        onEvent({ type: 'usage', usage: reply.usage });
      }
      turns += 1;
      break;
    }

    if (!response) {
      return this.finish(working, 'limit', response, turns);
    }
    return this.finish(working, 'ok', response, turns);
  }

  private async runWithTools(
    session: JamSession,
    prompt: string,
    onEvent: (e: AgentEvent) => void
  ): Promise<RunResult> {
    if (!this.provider || !this.dispatcher || !this.toolDefinitions?.length) {
      throw new Error('runWithTools requires a provider, a dispatcher, and tool definitions');
    }
    await emitHookEvent(this.hooks, 'turn_start', { session, prompt, messages: session.messages });
    let working = appendMessages(session, [userMessage(prompt)]);
    if (this.systemPrompt) {
      working = appendMessages(working, [{ role: 'system', content: this.systemPrompt, timestamp: Date.now() }]);
    }
    let totalToolCalls = 0;
    let iterations = 0;

    while (iterations < this.maxSteps) {
      if (isCancelled(session.id, this.cancelled)) {
        this.cancelled.delete(session.id);
        return this.finish(working, 'cancelled', '', iterations);
      }
      let completion;
      try {
        completion = await this.provider.complete(working.messages, {
          model: this.model,
          temperature: this.temperature,
          signal: this.signal,
          tools: this.toolDefinitions,
        });
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          return this.finish(working, 'cancelled', '', iterations);
        }
        return this.finish(working, 'error', '', iterations, error?.message ?? String(error));
      }
      if (completion.usage) {
        working = addUsage(working, completion.usage);
        if (this.modelUsageKey) {
          working = addModelUsage(working, this.modelUsageKey, completion.usage);
        }
        onEvent({ type: 'usage', usage: completion.usage });
      }
      const rawCalls = completion.toolCalls || [];
      const calls = [];
      const callErrors: { index: number; message: string }[] = [];
      for (let idx = 0; idx < rawCalls.length; idx += 1) {
        const call = rawCalls[idx];
        const name = call?.function?.name;
        if (typeof name !== 'string' || !name) {
          callErrors.push({ index: idx, message: 'Tool call names an unknown tool or carries unusable arguments.' });
          continue;
        }
        calls.push({
          id: call.id || `tool_call_${iterations}_${idx}`,
          name,
          type: call.type || 'function',
          arguments: call.function.arguments ?? {},
        });
      }
      for (const failure of callErrors) {
        onEvent({
          type: 'tool_result',
          result: {
            tool: 'unknown',
            success: false,
            output: `Tool error: unusable tool call at index ${failure.index}: ${failure.message}`,
            durationMs: 0,
          },
        });
      }
      if (!calls.length && !callErrors.length) {
        const text = completion.content || '';
        working = appendMessages(working, [assistantMessage(text, '')]);
        if (text) onEvent({ type: 'text', delta: text });
        return this.finish(working, 'ok', text, iterations + 1);
      }
      if (!calls.length) {
        iterations += 1;
        continue;
      }

      totalToolCalls += calls.length;
      for (const call of calls) {
        await emitHookEvent(this.hooks, 'pre_tool', { session: working, call });
      }

      const outcome = await dispatchToolCalls(calls, this.dispatcher, onEvent, {
        maxCalls: this.maxToolCallsPerTurn,
        alreadyUsed: totalToolCalls - calls.length,
      });
      if (outcome.stopped && outcome.stopReason === 'budget') {
        return this.finish(working, 'limit', `Tool call budget exceeded (${totalToolCalls}/${this.maxToolCallsPerTurn}).`, iterations + 1);
      }
      if (outcome.stopped && outcome.stopReason === 'approval' && outcome.pendingCall) {
        const pending = outcome.pendingCall;
        const decided = await this.requestApproval(pending, onEvent);
        if (!decided) {
          return this.finish(working, 'refused', `Tool ${pending.name} was not approved.`, iterations + 1);
        }
        const result = await this.dispatcher.execute(pending);
        onEvent({ type: 'tool_result', result });
        outcome.results.push(result);
      }

      const screening = await screenToolResults({
        prompt,
        provider: this.trustProvider,
        model: this.trustModel,
        signal: this.signal,
        candidates: calls.map((call, index) => ({
          tool: call.name,
          output: outcome.results[index]?.output ?? '',
        })),
      });
      if (this.trustOffNote && !this.trustNoted) {
        this.trustNoted = true;
        for (const note of screening.notes) {
          onEvent({ type: 'notice', message: note });
        }
      }
      for (const removal of [...screening.deduped, ...screening.dropped]) {
        onEvent({ type: 'notice', message: `Removed ${removal.tool} result: ${removal.reason}` });
      }

      for (let index = 0; index < calls.length; index += 1) {
        const result = outcome.results[index];
        if (!result) continue;
        await emitHookEvent(this.hooks, 'post_tool', {
          session: working,
          call: calls[index],
          result,
          output: this.truncate(result.output),
        });
      }

      const keptKeys = new Set(screening.kept.map((item) => `${item.tool}\u0000${item.output}`));
      for (let i = 0; i < calls.length; i += 1) {
        const result = outcome.results[i];
        if (!result) continue;
        if (!keptKeys.has(`${result.tool}\u0000${result.output}`)) continue;
        keptKeys.delete(`${result.tool}\u0000${result.output}`);
        const callId = calls[i].id;
        const truncated = this.truncate(result.output);
        const { assistant, tool } = toProviderToolMessages(calls[i], callId, truncated);
        working = appendMessages(working, [assistant, tool]);
      }
      if (outcome.results.length && !screening.kept.length) {
        working = appendMessages(working, [
          {
            role: 'system',
            content: 'Every tool result this turn was removed by the trust gate.',
            timestamp: Date.now(),
          },
        ]);
      }
      iterations += 1;
    }

    return this.finish(working, 'limit', `Reached tool iteration limit (${this.maxSteps}) without a final answer.`, iterations);
  }

  private truncate(text: string): string {
    if (!text) return '';
    return text.length > this.truncationLimit ? `${text.slice(0, this.truncationLimit)}\n… <truncated>` : text;
  }

  private requestApproval(call: { id: string; name: string; arguments: Record<string, any> }, onEvent: (e: AgentEvent) => void): Promise<boolean> {
    return new Promise((resolve) => {
      onEvent({
        type: 'approval_request',
        call,
        decide: (ok: boolean) => resolve(ok),
      });
    });
  }

  protected async complete(
    session: JamSession,
    prompt: string,
    onEvent: (e: AgentEvent) => void
  ): Promise<{ text: string; reasoning: string; usage?: TokenUsage }> {
    if (!this.provider) {
      onEvent({ type: 'text', delta: prompt });
      return { text: prompt, reasoning: '' };
    }
    let text = '';
    let reasoning = '';
    let usage: TokenUsage | undefined;
    for await (const chunk of this.provider.streamChat(session.messages, {
      model: this.model,
      temperature: this.temperature,
      reasoning: 'auto',
      signal: this.signal,
    })) {
      if (chunk.content) {
        text += chunk.content;
        onEvent({ type: 'text', delta: chunk.content });
      }
      if (chunk.reasoning) {
        reasoning += chunk.reasoning;
        onEvent({ type: 'reasoning', delta: chunk.reasoning });
      }
      if (chunk.done && chunk.usage) {
        usage = chunk.usage;
      }
    }
    return { text, reasoning, usage };
  }

  private finish(
    session: JamSession,
    status: RunStatus,
    response: string,
    turns: number,
    error?: string
  ): RunResult {
    return {
      status,
      sessionId: session.id,
      response,
      turns,
      usage: { ...session.usage },
      ...(error ? { error } : {}),
    };
  }
}

function userMessage(content: string): ChatMessage {
  return { role: 'user', content, timestamp: Date.now() };
}

function assistantMessage(content: string, reasoning: string): ChatMessage {
  return { role: 'assistant', content, timestamp: Date.now(), ...(reasoning ? { reasoning } : {}) };
}
