import fs from 'fs';
import type { ChatMessage } from '../types.js';
import { parseTranscriptLine, type TranscriptEvent } from './events.js';

/** Read every event in a session file, in either format. A missing file has none. */
export function readTranscript(file: string): TranscriptEvent[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').flatMap(parseTranscriptLine);
}

/**
 * The conversation a session's events describe, as the provider will see it. A
 * compaction replaces the messages before it with a summary; everything else is
 * replayed in order.
 */
export function projectMessages(events: TranscriptEvent[]): ChatMessage[] {
  let messages: ChatMessage[] = [];
  for (const event of events) {
    if (event.type === 'message') {
      messages.push(event.message);
    } else if (event.type === 'compaction') {
      const summary: ChatMessage = {
        role: 'user',
        content: `Summary of the earlier conversation:\n${event.summary}`,
        timestamp: event.ts,
      };
      messages = [summary, ...messages.slice(event.replaced)];
    }
  }
  return messages;
}
