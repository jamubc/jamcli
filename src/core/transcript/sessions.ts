import fs from 'fs';
import path from 'path';
import type { TranscriptEvent } from './events.js';
import { readTranscript } from './read.js';
import { getStateDir } from '../../utils/paths.js';

/** One line of the global index that session pickers and `jamcli sessions` read. */
export interface SessionSummary {
  id: string;
  projectRoot: string;
  projectName: string;
  created: string;
  updated: string;
  totalTokens: number;
  messageCount: number;
  title?: string;
  firstUserMessage?: string;
  model?: string;
}

export const historyDirFor = (projectRoot: string) => path.join(projectRoot, '.jamcli', 'history');
export const sessionFileFor = (projectRoot: string, id: string) => path.join(historyDirFor(projectRoot), `${id}.jsonl`);

const indexFile = () => path.join(getStateDir(), 'sessions.jsonl');

/** A short title from the first request, as session pickers have always shown it. */
export function titleFrom(firstMessage: string): string {
  const cleaned = firstMessage.replace(/^(please|can you|could you|would you|help me|i need|i want to)\s+/i, '').trim();
  const sentence = cleaned.split(/[.!?]\s/)[0];
  let title = sentence.length > 50 ? `${sentence.slice(0, 47)}...` : sentence;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length < 10 || /^(how|what|why|when|where)/i.test(title)) {
    title = cleaned.split(/\s+/).slice(0, 6).join(' ');
    if (title.length > 50) title = `${title.slice(0, 47)}...`;
  }
  return title || 'New conversation';
}

export function readSessionIndex(): SessionSummary[] {
  const file = indexFile();
  if (!fs.existsSync(file)) return [];
  const entries: SessionSummary[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.id === 'string' && typeof entry.projectRoot === 'string') entries.push(entry);
    } catch {
      // A damaged line costs one entry, not the index.
    }
  }
  return entries;
}

/**
 * Write one session's summary into the index. The creation time comes from the session
 * file (its header, or the first version 1 turn), and a title the session already has is
 * kept. The index is rewritten through a temporary file so a reader never sees half of it.
 */
export function recordSessionSummary(projectRoot: string, id: string, events: TranscriptEvent[]): void {
  const messages = events.flatMap((event) => (event.type === 'message' ? [event] : []));
  if (!messages.length) return;
  const firstUser = messages.find((event) => event.message.role === 'user')?.message.content ?? '';
  const tokens = events.reduce((sum, event) => sum + (event.type === 'usage' && !event.delegated ? event.usage.total_tokens || 0 : 0), 0);
  const model = [...messages].reverse().find((event) => event.message.model)?.message.model;
  const started = events.find((event) => event.ts > 0)?.ts;
  const existing = readSessionIndex();
  const previous = existing.find((entry) => entry.id === id && samePath(entry.projectRoot, projectRoot));
  const summary: SessionSummary = {
    id,
    projectRoot,
    projectName: path.basename(projectRoot),
    created: started ? new Date(started).toISOString() : (previous?.created ?? new Date().toISOString()),
    updated: new Date().toISOString(),
    totalTokens: tokens,
    messageCount: messages.length,
    title: previous?.title || titleFrom(firstUser),
    firstUserMessage: firstUser.slice(0, 200),
    ...(model ? { model } : {}),
  };
  const next = [...existing.filter((entry) => entry !== previous), summary];
  const file = indexFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${next.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

const canonical = (target: string): string => {
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
};

const samePath = (a: string, b: string) => a === b || canonical(a) === canonical(b);

const newestFirst = (a: SessionSummary, b: SessionSummary) => Date.parse(b.updated) - Date.parse(a.updated);

/**
 * Sessions recorded for one project, newest first. An entry whose file is gone is left
 * out, since it can no longer be resumed.
 */
export function listSessionSummaries(projectRoot: string, limit = 20): SessionSummary[] {
  return readSessionIndex()
    .filter((entry) => samePath(entry.projectRoot, projectRoot))
    .filter((entry) => fs.existsSync(sessionFileFor(projectRoot, entry.id)))
    .sort(newestFirst)
    .slice(0, limit);
}

/**
 * Sessions of one project whose title, first request, or any message contains the
 * query, ignoring case. Metadata is checked first; the session files are read only for
 * entries it does not match.
 */
export function searchSessionSummaries(projectRoot: string, query: string, limit = 20): SessionSummary[] {
  const needle = query.toLowerCase();
  if (!needle) return listSessionSummaries(projectRoot, limit);
  const matches: SessionSummary[] = [];
  for (const entry of listSessionSummaries(projectRoot, Number.MAX_SAFE_INTEGER)) {
    if (matches.length >= limit) break;
    const metadata = [entry.title ?? '', entry.firstUserMessage ?? '', entry.id].join(' ').toLowerCase();
    const found =
      metadata.includes(needle) ||
      readTranscript(sessionFileFor(projectRoot, entry.id)).some(
        (event) => event.type === 'message' && (event.message.content ?? '').toLowerCase().includes(needle)
      );
    if (found) matches.push(entry);
  }
  return matches;
}
