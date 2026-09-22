import type { Agent, AgentEvent, ChatMessage, JamSession, RunResult, RunStatus } from './types.js';
import { appendMessages, isCancelled } from './state.js';

export interface AgentOptions {
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 8;

export class CoreAgent implements Agent {
  private cancelled = new Set<string>();
  private maxSteps: number;

  constructor(options: AgentOptions = {}) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
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

      const reply = await this.complete(working, prompt);
      response = reply;
      working = appendMessages(working, [assistantMessage(reply)]);
      onEvent({ type: 'text', delta: reply });
      turns += 1;
      break;
    }

    if (!response) {
      return this.finish(working, 'limit', response, turns);
    }
    return this.finish(working, 'ok', response, turns);
  }

  protected async complete(_session: JamSession, prompt: string): Promise<string> {
    return prompt;
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

function assistantMessage(content: string): ChatMessage {
  return { role: 'assistant', content, timestamp: Date.now() };
}
