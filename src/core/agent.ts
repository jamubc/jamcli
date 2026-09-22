import type { Agent, AgentEvent, ChatMessage, JamSession, RunResult, RunStatus, TokenUsage } from './types.js';
import { addModelUsage, addUsage, appendMessages, isCancelled } from './state.js';
import type { ChatProvider } from './providers/types.js';

export interface AgentOptions {
  maxSteps?: number;
  provider?: ChatProvider;
  model?: string;
  temperature?: number;
  modelUsageKey?: string;
  signal?: AbortSignal;
}

const DEFAULT_MAX_STEPS = 8;

export class CoreAgent implements Agent {
  private cancelled = new Set<string>();
  private maxSteps: number;
  private provider?: ChatProvider;
  private model?: string;
  private temperature?: number;
  private modelUsageKey?: string;
  private signal?: AbortSignal;

  constructor(options: AgentOptions = {}) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.provider = options.provider;
    this.model = options.model;
    this.temperature = options.temperature;
    this.modelUsageKey = options.modelUsageKey;
    this.signal = options.signal;
  }

  cancel(sessionId: string): void {
    this.cancelled.add(sessionId);
  }

  async run(session: JamSession, prompt: string, onEvent: (e: AgentEvent) => void): Promise<RunResult> {
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

  private finish(session: JamSession, status: RunStatus, response: string, turns: number): RunResult {
    return {
      status,
      sessionId: session.id,
      response,
      turns,
      usage: { ...session.usage },
    };
  }
}

function userMessage(content: string): ChatMessage {
  return { role: 'user', content, timestamp: Date.now() };
}

function assistantMessage(content: string, reasoning: string): ChatMessage {
  return { role: 'assistant', content, timestamp: Date.now(), ...(reasoning ? { reasoning } : {}) };
}
