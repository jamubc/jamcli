import fs from 'fs';
import path from 'path';
import type { ChatMessage } from '../../core/types.js';
import { isSummary } from '../../core/context/compact.js';
import { projectMessages, readSessionIndex, readTranscript, sessionFileFor } from '../../core/transcript/index.js';
import type { PickItem } from './Picker.js';

/** How many of the project's other sessions history search reads. */
export const HISTORY_SESSIONS = 20;

const typed = (messages: ChatMessage[]): string[] =>
  messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string' && message.content.trim() && !isSummary(message))
    .map((message) => (message.content as string).trim())
    .reverse();

/**
 * What the person has sent before, newest first: this session's messages, then those of
 * the project's latest sessions. Each is listed once, where it was last sent.
 */
export function earlierMessages(projectRoot: string, current: { id: string; messages: ChatMessage[] }): PickItem[] {
  const items: PickItem[] = [];
  const seen = new Set<string>();
  const add = (texts: string[], where: string) => {
    for (const text of texts) {
      if (seen.has(text)) continue;
      seen.add(text);
      const first = text.split('\n')[0];
      items.push({ key: `${items.length}`, label: text.includes('\n') ? `${first} …` : first, detail: where, value: text });
    }
  };
  add(typed(current.messages), 'this session');
  const others = readSessionIndex()
    .filter((session) => session.id !== current.id && path.resolve(session.projectRoot) === path.resolve(projectRoot))
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, HISTORY_SESSIONS);
  for (const session of others) {
    const file = sessionFileFor(projectRoot, session.id);
    if (!fs.existsSync(file)) continue;
    try {
      add(typed(projectMessages(readTranscript(file))), session.id);
    } catch {
      // A session that cannot be read is left out of the search.
    }
  }
  return items;
}
