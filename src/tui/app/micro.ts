import path from 'path';
import type { ViewState } from '../state/view.js';

/**
 * Micro status mode (tasks 12.8): when the terminal is tiled too small to read, the
 * interface shows one static phrase for the session's state instead. The phrase comes
 * only from the view state, so it changes only when the state does: nothing animates.
 */

/** Below either, the full interface is unreadable: rows <= 10 or columns <= 40. */
export const MICRO_ROWS = 10;
export const MICRO_COLUMNS = 40;

export type MicroSetting = 'auto' | 'always' | 'never';

/** `JAMCLI_MICRO`: `auto` (the default), `always`, or `never`. */
export const microSetting = (value: string | undefined): MicroSetting => (value === 'always' || value === 'never' ? value : 'auto');

export const isMicro = (setting: MicroSetting, size: { width: number; height: number }) =>
  setting === 'always' || (setting === 'auto' && (size.height <= MICRO_ROWS || size.width <= MICRO_COLUMNS));

/** A phrase and the word that carries it when only one fits. */
export interface MicroPhrase {
  words: string[];
  key: number;
}

const READS = new Set(['read_file', 'lsp']);
const EDITS = new Set(['edit', 'write_file', 'apply_patch']);

/** The file a tool row names, as its base name. */
const fileOf = (row: { path?: string; summary: string }) => {
  const named = row.path ?? /\s(\S+\.\w+)/.exec(row.summary)?.[1];
  return named ? path.basename(named) : undefined;
};

/**
 * The session's state in 2 to 4 lowercase words, highest priority first: `need input`
 * while a call waits on the person, `error` when the last turn ended in one, `done` when it
 * finished, then what it is doing: `thinking`, `editing <file>`, `reading <file>`, or
 * `running <tool>`. Before the first turn, `ready`.
 */
export function microPhrase(state: ViewState): MicroPhrase {
  if (state.approvals.length || state.status.phase === 'waiting') return { words: ['need', 'input'], key: 1 };
  const lastUser = state.rows.map((row) => row.kind).lastIndexOf('user');
  const sinceTurn = lastUser >= 0 ? state.rows.slice(lastUser + 1) : [];
  if (sinceTurn.some((row) => row.kind === 'notice' && row.level === 'error')) return { words: ['error'], key: 0 };
  if (!state.running) return lastUser >= 0 ? { words: ['done'], key: 0 } : { words: ['ready'], key: 0 };
  if (state.status.phase === 'tool') {
    const active = [...sinceTurn].reverse().find((row) => row.kind === 'tool' && (row.phase === 'running' || row.phase === 'pending'));
    if (active && active.kind === 'tool') {
      const file = fileOf(active);
      if (EDITS.has(active.tool)) return file ? { words: ['editing', file], key: 0 } : { words: ['editing'], key: 0 };
      if (READS.has(active.tool)) return file ? { words: ['reading', file], key: 0 } : { words: ['reading'], key: 0 };
      return { words: ['running', active.tool], key: 0 };
    }
  }
  return { words: ['thinking'], key: 0 };
}

/** One line, clipped to the width: the whole phrase, or its key word alone when that is all that fits. */
export function fitPhrase(phrase: MicroPhrase, width: number): string {
  const whole = phrase.words.join(' ');
  if (whole.length <= width) return whole;
  const key = phrase.words[phrase.key];
  return key.length <= width ? key : key.slice(0, Math.max(1, width));
}
