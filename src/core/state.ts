import type { ChatMessage, JamSession, TokenUsage } from './types.js';
import { randomUUID } from 'node:crypto';

export function createSession(projectRoot: string, id: string = randomUUID()): JamSession {
  const now = Date.now();
  return {
    id,
    projectRoot,
    messages: [],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    modelUsage: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function appendMessages(session: JamSession, messages: ChatMessage[]): JamSession {
  return touch({ ...session, messages: [...session.messages, ...messages] });
}

export function replaceMessages(session: JamSession, messages: ChatMessage[]): JamSession {
  return touch({ ...session, messages });
}

export function updateLastMessage(session: JamSession, content: string, usage?: TokenUsage): JamSession {
  if (!session.messages.length) return session;
  const messages = [...session.messages];
  const last = { ...messages[messages.length - 1], content };
  if (usage) last.usage = usage;
  messages[messages.length - 1] = last;
  return touch({ ...session, messages });
}

export function addUsage(session: JamSession, usage: TokenUsage | undefined): JamSession {
  if (!usage) return session;
  return touch({
    ...session,
    usage: {
      prompt_tokens: session.usage.prompt_tokens + usage.prompt_tokens,
      completion_tokens: session.usage.completion_tokens + usage.completion_tokens,
      total_tokens: session.usage.total_tokens + usage.total_tokens,
    },
  });
}

export function addModelUsage(session: JamSession, key: string, usage: TokenUsage | undefined): JamSession {
  if (!key || !usage) return session;
  const current = session.modelUsage[key] || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const delta = Number.isFinite(usage.total_tokens)
    ? usage.total_tokens
    : usage.prompt_tokens + usage.completion_tokens;
  return touch({
    ...session,
    modelUsage: {
      ...session.modelUsage,
      [key]: {
        prompt_tokens: current.prompt_tokens + usage.prompt_tokens,
        completion_tokens: current.completion_tokens + usage.completion_tokens,
        total_tokens: current.total_tokens + delta,
      },
    },
  });
}

export function isCancelled(sessionId: string, cancelled: Set<string>): boolean {
  return cancelled.has(sessionId);
}

function touch(session: JamSession): JamSession {
  return { ...session, updatedAt: Date.now() };
}
