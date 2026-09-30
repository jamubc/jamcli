import fs from 'fs';
import path from 'path';
import { getStateDir } from '../../utils/paths.js';

/**
 * The machine's flag board: which flags each session has raised. One file per session in
 * the state directory, so every JamCLI on the machine reads the same board, and a flag
 * stays raised after its session closes, until it is lowered.
 */

/** One session's raised flags, each with when it was raised. */
export interface BoardEntry {
  session: string;
  projectRoot: string;
  flags: Record<string, number>;
}

const boardDir = () => path.join(getStateDir(), 'flags');
const fileOf = (session: string) => path.join(boardDir(), `${session}.json`);

const FLAG = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A flag's name as the board keeps it: one lowercase word. Says why when it cannot be one. */
export function flagName(text: string): { flag: string } | { error: string } {
  const flag = text.trim().toLowerCase();
  return FLAG.test(flag) ? { flag } : { error: `${text.trim() || 'Nothing'} is not a flag: use one word of up to 32 letters, digits, - and _.` };
}

/** The flags a session has raised, by name; none when it has raised none. */
export function flagsOf(session: string): Record<string, number> {
  try {
    const entry = JSON.parse(fs.readFileSync(fileOf(session), 'utf8')) as BoardEntry;
    return entry && typeof entry.flags === 'object' && entry.flags ? entry.flags : {};
  } catch {
    return {};
  }
}

/** Raise or lower one flag of a session. Written through a temporary file, so no reader sees half of it. */
export function setFlag(session: string, projectRoot: string, flag: string, raised: boolean): void {
  const flags = { ...flagsOf(session) };
  if (raised) flags[flag] = Date.now();
  else delete flags[flag];
  fs.mkdirSync(boardDir(), { recursive: true });
  const entry: BoardEntry = { session, projectRoot, flags };
  const temporary = `${fileOf(session)}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(entry)}\n`, 'utf8');
  fs.renameSync(temporary, fileOf(session));
}
