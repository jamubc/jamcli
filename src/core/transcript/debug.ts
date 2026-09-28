import fs from 'fs';
import type { TranscriptEvent } from './events.js';
import { transcriptToMarkdown } from './markdown.js';
import { readTranscript } from './read.js';
import { sessionFileFor } from './sessions.js';

/**
 * A session's whole log, rendered as `/export` renders it, with what each request carried and
 * what the record kept that the model was not shown. `/copy debug` copies it and the
 * interface's detailed transcript shows it, so the two read the same. Nothing before the log
 * has its first event.
 */
export function debugTranscript(projectRoot: string, id: string): { file: string; events: TranscriptEvent[]; text: string } | undefined {
  const file = sessionFileFor(projectRoot, id);
  if (!fs.existsSync(file)) return undefined;
  const events = readTranscript(file);
  return { file, events, text: transcriptToMarkdown(events, { id, debug: true }) };
}
