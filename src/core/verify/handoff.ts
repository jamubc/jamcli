import fs from 'fs';
import path from 'path';
import type { TranscriptEvent } from '../transcript/events.js';
import { isSummary } from '../context/compact.js';
import { ensureProjectStateDir } from '../transcript/log.js';
import { formatTodos, type TodoItem } from '../tools/todo.js';
import { HeadTailBuffer } from '../tools/command.js';
import { Ledger } from './ledger.js';

export type HandoffReason = 'session_end' | 'reset' | 'drop';

export const HANDOFF_FILE = 'handoff.md';
export const handoffFile = (projectRoot: string): string => path.join(projectRoot, '.jamcli', HANDOFF_FILE);

const REQUEST_HEADING = 'The request being worked on, verbatim:';

/** The requests the person made, oldest first, each as a summary would carry it. */
function requestsOf(events: TranscriptEvent[]): string[] {
  const found: string[] = [];
  for (const event of events) {
    if (event.type !== 'message' || event.message.role !== 'user') continue;
    const text = event.message.content;
    if (text.startsWith('[')) continue;
    if (!isSummary(event.message)) {
      found.push(text);
      continue;
    }
    const carried = text.indexOf(`${REQUEST_HEADING}\n`);
    if (carried >= 0) found.push(text.slice(carried + REQUEST_HEADING.length + 1).split('\n\n')[0]);
  }
  return found;
}

/** How much of the first request the handoff repeats. */
const FIRST_REQUEST_CHARS = 300;

/** The files the session's checkpoints say it changed, in first-seen order. */
function changedFiles(events: TranscriptEvent[]): string[] {
  const files: string[] = [];
  for (const event of events) {
    if (event.type !== 'checkpoint' || !event.label) continue;
    const match = /^\S+ (.+)$/.exec(event.label);
    const name = match?.[1]?.trim();
    if (name && !files.includes(name)) files.push(name);
  }
  return files;
}

/**
 * The handoff as a rendering of the log: facts only, nothing inferred, no lessons. It is
 * regenerated whole each time and has no append path, so it cannot accrete.
 */
export function renderHandoff(events: TranscriptEvent[], todos: TodoItem[], meta: { sessionId: string; reason: HandoffReason; now?: number }): string {
  const ledger = Ledger.fromEvents(events);
  const failing = ledger.all().filter((row) => row.status === 'failed').at(-1);
  const lastPassed = ledger.latest().find((row) => row.name === failing?.name && row.status === 'passed' && row.ts > (failing?.ts ?? 0));
  const open = failing && !lastPassed ? events.filter((event): event is Extract<TranscriptEvent, { type: 'gate' }> => event.type === 'gate').at(-1) : undefined;
  const requests = requestsOf(events);
  const first = requests[0];
  const latest = requests.at(-1);
  const lines = [
    `# Handoff ${meta.sessionId} ${new Date(meta.now ?? Date.now()).toISOString()}${meta.reason === 'reset' ? ' (reset)' : ''}`,
    '',
    `Request: ${latest ?? '(none recorded)'}`,
    // A last question that has nothing to do with the work would otherwise read as the task.
    ...(first !== undefined && first !== latest ? [`Began with: ${first.length > FIRST_REQUEST_CHARS ? `${first.slice(0, FIRST_REQUEST_CHARS)}...` : first}`] : []),
    '',
    'Steps:',
    formatTodos(todos),
    '',
    'Gates:',
    ledger.tail().length ? ledger.tail().join('\n') : '(none ran)',
    '',
    'Changed:',
    changedFiles(events).join('\n') || '(nothing)',
  ];
  if (open?.shaped) lines.push('', 'Open:', open.shaped);
  return `${lines.join('\n')}\n`;
}

export function writeHandoff(projectRoot: string, text: string): { path: string; bytes: number } {
  ensureProjectStateDir(projectRoot);
  const file = handoffFile(projectRoot);
  fs.writeFileSync(file, text, 'utf8');
  return { path: path.relative(projectRoot, file), bytes: Buffer.byteLength(text) };
}

/** The handoff a person or a workflow left for the next session, if one was left that way. */
export function readResetHandoff(projectRoot: string): { session: string; text: string } | undefined {
  let text: string;
  try {
    text = fs.readFileSync(handoffFile(projectRoot), 'utf8');
  } catch {
    return undefined;
  }
  const header = text.split('\n')[0] ?? '';
  const match = /^# Handoff (\S+) \S+ \(reset\)$/.exec(header);
  return match ? { session: match[1], text } : undefined;
}

/**
 * Whether a handoff for `reason` is due now. A session with no messages leaves none, and a
 * session's end does not overwrite a reset the person asked for when nothing was said since.
 */
export function handoffDue(events: TranscriptEvent[], reason: HandoffReason): boolean {
  if (!events.some((event) => event.type === 'message')) return false;
  if (reason !== 'session_end') return true;
  const last = events.map((event, index) => ({ event, index })).filter(({ event }) => event.type === 'handoff').at(-1);
  if (!last || (last.event as { reason?: string }).reason !== 'reset') return true;
  return events.slice(last.index + 1).some((event) => event.type === 'message');
}

/** Characters a handoff may take of the first prompt: about 600 tokens. */
const HANDOFF_NOTE_CHARS = 2_400;

/** The reset handoff an earlier session left, as the note the next session's first prompt carries, within a fixed budget. */
export function handoffNote(projectRoot: string, sessionId: string): { session: string; note: string } | undefined {
  const reset = readResetHandoff(projectRoot);
  if (!reset || reset.session === sessionId) return undefined;
  const buffer = new HeadTailBuffer(HANDOFF_NOTE_CHARS);
  buffer.push(reset.text);
  return { session: reset.session, note: `[Handoff from the previous session ${reset.session}:\n${buffer.toString()}]` };
}
