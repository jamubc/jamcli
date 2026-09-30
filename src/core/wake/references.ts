import { readSessionIndex, readTranscript, sessionFileFor, SESSION_ID, type SessionSummary } from '../transcript/index.js';
import { flagsOf } from './board.js';

/**
 * The sessions a prompt names: any session id the index holds, and any word that is a
 * session's name. The session asking is left out.
 */
export function namedSessions(text: string, self: string): SessionSummary[] {
  const index = readSessionIndex();
  const byId = new Map(index.map((entry) => [entry.id, entry]));
  const byName = new Map(index.filter((entry) => entry.name).map((entry) => [entry.name!.toLowerCase(), entry]));
  const found = new Map<string, SessionSummary>();
  for (const match of text.matchAll(SESSION_ID)) {
    const entry = byId.get(match[0]);
    if (entry) found.set(entry.id, entry);
  }
  if (byName.size) {
    for (const word of text.match(/[A-Za-z0-9._-]+/g) ?? []) {
      const entry = byName.get(word.replace(/[.]+$/, '').toLowerCase());
      if (entry) found.set(entry.id, entry);
    }
  }
  found.delete(self);
  return [...found.values()];
}

/**
 * What the model is told of the sessions a prompt names, in the bracket form of the
 * harness's other notes: where each one's log is, how many tester notes it holds, and the
 * flags it has raised, so it can read the log or wait on a flag instead of searching.
 */
export function sessionReferencesNote(text: string, self: string): string | undefined {
  const sessions = namedSessions(text, self);
  if (!sessions.length) return undefined;
  const lines = sessions.map((entry) => {
    const file = sessionFileFor(entry.projectRoot, entry.id);
    const notes = readTranscript(file).filter((event) => event.type === 'note').length;
    const flags = Object.keys(flagsOf(entry.id));
    return `- ${entry.id}${entry.name ? ` (named ${entry.name})` : ''}: project ${entry.projectRoot}, log ${file}, ${notes} tester note${notes === 1 ? '' : 's'} (events of type "note"), flags raised: ${flags.length ? flags.join(', ') : 'none'}`;
  });
  return `[Sessions named in this message, as the session index knows them. The wake tool can wait for their flags.\n${lines.join('\n')}]`;
}
