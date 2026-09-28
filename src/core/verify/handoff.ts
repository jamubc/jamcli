import fs from 'fs';
import path from 'path';
import type { TranscriptEvent } from '../transcript/events.js';
import { isSummary } from '../context/compact.js';
import { ensureProjectStateDir } from '../transcript/log.js';
import { formatTodos, type TodoItem } from '../tools/todo.js';
import { Ledger } from './ledger.js';

export type HandoffReason = 'session_end' | 'reset' | 'drop';

export const HANDOFF_FILE = 'handoff.md';
export const handoffFile = (projectRoot: string): string => path.join(projectRoot, '.jamcli', HANDOFF_FILE);

const REQUEST_HEADING = 'The request being worked on, verbatim:';

/** The latest request the person made, read from the log as a summary would carry it. */
function latestRequest(events: TranscriptEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'message' || event.message.role !== 'user') continue;
    const text = event.message.content;
    if (text.startsWith('[')) continue;
    if (!isSummary(event.message)) return text;
    const carried = text.indexOf(`${REQUEST_HEADING}\n`);
    if (carried >= 0) return text.slice(carried + REQUEST_HEADING.length + 1).split('\n\n')[0];
  }
  return undefined;
}

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
  const lines = [
    `# Handoff ${meta.sessionId} ${new Date(meta.now ?? Date.now()).toISOString()}${meta.reason === 'reset' ? ' (reset)' : ''}`,
    '',
    `Request: ${latestRequest(events) ?? '(none recorded)'}`,
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
