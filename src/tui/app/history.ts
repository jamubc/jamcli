import fs from 'fs';
import path from 'path';
import type { ChatMessage } from '../../core/types.js';
import { isSummary } from '../../core/context/compact.js';
import { projectMessages, readSessionIndex, readTranscript, sessionFileFor, typedPrompts, type TypedPrompt } from '../../core/transcript/index.js';
import type { ChoiceItem } from '../../commands/types.js';

/** How many of the project's other sessions history search reads. */
export const HISTORY_SESSIONS = 20;

/** What the conversation holds of what was typed: all a session recorded before prompts were kept. */
const fromMessages = (messages: ChatMessage[]): TypedPrompt[] =>
  messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim() && !isSummary(message))
    .map((message) => ({ text: (message.content as string).trim(), state: 'sent' as const, ts: message.timestamp ?? 0 }));

/** A session's typed prompts, newest first: the record where it has one, else the conversation. */
const newestFirst = (prompts: TypedPrompt[], messages: () => ChatMessage[]): TypedPrompt[] => (prompts.length ? prompts : fromMessages(messages())).slice().reverse();

/**
 * What the person has typed before, newest first: this session's prompts, then those of
 * the project's latest sessions. Each is listed once, where it was last typed. A draft the
 * person cleared without sending is listed too, and says so.
 */
export function earlierMessages(projectRoot: string, current: { id: string; prompts: TypedPrompt[]; messages: ChatMessage[] }): ChoiceItem[] {
  const items: ChoiceItem[] = [];
  const seen = new Set<string>();
  const add = (prompts: TypedPrompt[], where: string) => {
    for (const { text, state } of prompts) {
      if (seen.has(text)) continue;
      seen.add(text);
      const first = text.split('\n')[0];
      items.push({ key: `${items.length}`, label: text.includes('\n') ? `${first} …` : first, detail: state === 'cleared' ? `${where}, cleared` : where, value: text });
    }
  };
  add(newestFirst(current.prompts, () => current.messages), 'this session');
  const others = readSessionIndex()
    .filter((session) => session.id !== current.id && path.resolve(session.projectRoot) === path.resolve(projectRoot))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, HISTORY_SESSIONS);
  for (const session of others) {
    const file = sessionFileFor(projectRoot, session.id);
    if (!fs.existsSync(file)) continue;
    try {
      const events = readTranscript(file);
      add(newestFirst(typedPrompts(events), () => projectMessages(events)), session.id);
    } catch {
      // A session that cannot be read is left out of the search.
    }
  }
  return items;
}
