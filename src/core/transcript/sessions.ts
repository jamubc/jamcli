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
  /** The name given with `/rename`. */
  name?: string;
  /** The color given with `/color`. */
  color?: string;
}

export const historyDirFor = (projectRoot: string) => path.join(projectRoot, '.jamcli', 'history');
export const sessionFileFor = (projectRoot: string, id: string) => path.join(historyDirFor(projectRoot), `${id}.jsonl`);

const indexFile = () => path.join(getStateDir(), 'sessions.jsonl');
/** The index's line format. A line from a newer JamCLI is skipped rather than misread. */
const INDEX_VERSION = 1;

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

/** The index as written: every line, and each session's last line, which is its summary. */
function readIndexFile(file: string): { entries: SessionSummary[]; lines: number } {
  if (!fs.existsSync(file)) return { entries: [], lines: 0 };
  const latest = new Map<string, SessionSummary>();
  // One session recorded under two spellings of its project, such as through a symlink, is one entry.
  const roots = new Map<string, string>();
  const rootOf = (root: string) => roots.get(root) ?? roots.set(root, canonical(root)).get(root)!;
  let lines = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    lines += 1;
    try {
      const { v, ...entry } = JSON.parse(line);
      if ((v ?? 1) > INDEX_VERSION || typeof entry.id !== 'string' || typeof entry.projectRoot !== 'string') continue;
      latest.set(`${entry.id}\u0000${rootOf(entry.projectRoot)}`, entry as SessionSummary);
    } catch {
      // A damaged line costs one entry, not the index.
    }
  }
  return { entries: [...latest.values()], lines };
}

export function readSessionIndex(): SessionSummary[] {
  return readIndexFile(indexFile()).entries;
}

/**
 * Write one session's summary into the index. The creation time comes from the session
 * file (its header, or the first version 1 turn), and a title the session already has is
 * kept. The summary is appended as one line, so a session's update never overwrites
 * another's, and costs a line, not the file; the last line for a session is its summary.
 * When stale lines outnumber the sessions, the index is rewritten with the last lines only,
 * through a temporary file so a reader never sees half of it.
 */
export function recordSessionSummary(projectRoot: string, id: string, events: TranscriptEvent[]): void {
  const messages = events.flatMap((event) => (event.type === 'message' ? [event] : []));
  const { name, color } = identityOf(events);
  // A named session is listed before its first message, so other sessions can refer to it.
  if (!messages.length && !name) return;
  const firstUser = messages.find((event) => event.message.role === 'user')?.message.content ?? '';
  const tokens = events.reduce((sum, event) => sum + (event.type === 'usage' && !event.delegated ? event.usage.total_tokens || 0 : 0), 0);
  const model = [...messages].reverse().find((event) => event.message.model)?.message.model;
  const started = events.find((event) => event.ts > 0)?.ts;
  const file = indexFile();
  const { entries: existing, lines } = readIndexFile(file);
  const previous = existing.find((entry) => entry.id === id && samePath(entry.projectRoot, projectRoot));
  const summary: SessionSummary = {
    id,
    projectRoot,
    projectName: path.basename(projectRoot),
    created: started ? new Date(started).toISOString() : (previous?.created ?? new Date().toISOString()),
    updated: new Date().toISOString(),
    totalTokens: tokens,
    messageCount: messages.length,
    // A session named before its first message has no title until that message.
    ...(previous?.title || firstUser ? { title: previous?.title || titleFrom(firstUser) } : {}),
    firstUserMessage: firstUser.slice(0, 200),
    ...(model ? { model } : {}),
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ v: INDEX_VERSION, ...summary })}\n`, 'utf8');
  if (lines + 1 <= 2 * (existing.length + 1) + 100) return;
  const next = [...existing.filter((entry) => entry !== previous), summary];
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${next.map((entry) => JSON.stringify({ v: INDEX_VERSION, ...entry })).join('\n')}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

/** The session's name and color, as the last `name` and `color` events left them. */
export function identityOf(events: TranscriptEvent[]): { name?: string; color?: string } {
  let name: string | undefined;
  let color: string | undefined;
  for (const event of events) {
    if (event.type === 'name') name = event.name;
    else if (event.type === 'color') color = event.color ?? undefined;
  }
  return { ...(name ? { name } : {}), ...(color ? { color } : {}) };
}

/** A session id as JamCLI makes them: the day it started and eight hex digits. */
export const SESSION_ID = /\b\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\b/g;

const NAME = /^[A-Za-z0-9._-]{1,60}$/;

/** A name as `/rename` keeps it: one word, spaces made `-`. Says why when it cannot be one. */
export function sessionName(text: string): { name: string } | { error: string } {
  const name = text.trim().replace(/\s+/g, '-');
  if (!name) return { error: 'A name needs at least one character.' };
  if (!NAME.test(name)) return { error: `${name} is not a name: use up to 60 letters, digits, and - _ . only.` };
  if (new RegExp(`^${SESSION_ID.source}$`).test(name)) return { error: 'A name cannot look like a session id.' };
  return { name };
}

/**
 * The session a reference means: an id, or a name the index holds, compared without case.
 * A session of `projectRoot` is preferred; a name two other projects share is ambiguous.
 */
export function resolveSessionRef(ref: string, projectRoot?: string): { session: SessionSummary } | { error: string; missing?: true } {
  const wanted = ref.trim();
  const index = readSessionIndex();
  const here = (entry: SessionSummary) => projectRoot !== undefined && samePath(entry.projectRoot, projectRoot);
  const pick = (matches: SessionSummary[], what: string): { session: SessionSummary } | { error: string } | undefined => {
    if (!matches.length) return undefined;
    const local = matches.filter(here);
    if (local.length === 1) return { session: local[0] };
    const pool = local.length ? local : matches;
    if (pool.length === 1) return { session: pool[0] };
    return { error: `${what} ${wanted} names ${pool.length} sessions: ${pool.map((entry) => `${entry.id} in ${entry.projectRoot}`).join(', ')}. Use the id.` };
  };
  const found = pick(index.filter((entry) => entry.id === wanted), 'The id') ?? pick(index.filter((entry) => entry.name?.toLowerCase() === wanted.toLowerCase()), 'The name');
  if (found) return found;
  // A log the index never listed, such as one written before the index, still opens by its id.
  if (projectRoot !== undefined && /^[\w.-]+$/.test(wanted) && fs.existsSync(sessionFileFor(projectRoot, wanted))) {
    const now = new Date().toISOString();
    return { session: { id: wanted, projectRoot, projectName: path.basename(projectRoot), created: now, updated: now, totalTokens: 0, messageCount: 0 } };
  }
  return { error: `No session named ${wanted}.`, missing: true };
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
