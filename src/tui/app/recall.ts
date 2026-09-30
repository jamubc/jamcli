import type { TypedPrompt } from '../../core/transcript/index.js';

/**
 * Walking back through what was typed with Up and Down. `entries` is the session's prompts
 * as they stood when the walk began, newest first; `index` is the one on show and `shown`
 * its text, so a composer whose text still equals `shown` has not been edited. `stash` is
 * the draft the person had before the first Up, which nothing but a send may take from them.
 */
export interface Recall {
  entries: TypedPrompt[];
  index: number;
  shown: string;
  stash: string;
}

/** What the composer holds after a key, and what the key walked away from. */
export interface Move {
  /** The walk, or nothing once it has ended. */
  recall: Recall | undefined;
  /** The text the composer now holds. */
  text: string;
  /** Edited text the walk left behind: to be kept as a cleared prompt, never dropped. */
  abandoned?: string;
}

/** Whether the composer still holds the recalled prompt as it was recalled. */
export const isRecalled = (recall: Recall | undefined, text: string): boolean => recall !== undefined && text === recall.shown;

/** The walk with an edit set aside as an entry of its own, at the newest end where it belongs. */
function leave(recall: Recall, text: string): { entries: TypedPrompt[]; index: number; abandoned?: string } {
  if (text === recall.shown || !text.trim()) return { entries: recall.entries, index: recall.index };
  const entry: TypedPrompt = { text, state: 'cleared', ts: Date.now() };
  return { entries: [entry, ...recall.entries], index: recall.index + 1, abandoned: text };
}

const on = (recall: Recall, entries: TypedPrompt[], index: number, abandoned: string | undefined): Move => ({
  recall: { ...recall, entries, index, shown: entries[index].text },
  text: entries[index].text,
  ...(abandoned !== undefined ? { abandoned } : {}),
});

const back = (recall: Recall, abandoned: string | undefined): Move => ({ recall: undefined, text: recall.stash, ...(abandoned !== undefined ? { abandoned } : {}) });

/**
 * Up: the newest prompt on the first press, keeping the draft aside; then each older one, and
 * the oldest stays. `entries` is only read when no walk has begun.
 */
export function recallUp(recall: Recall | undefined, text: string, entries: TypedPrompt[]): Move | undefined {
  if (!recall) {
    if (!entries.length) return undefined;
    return on({ entries, index: 0, shown: '', stash: text }, entries, 0, undefined);
  }
  const left = leave(recall, text);
  return on(recall, left.entries, Math.min(left.index + 1, left.entries.length - 1), left.abandoned);
}

/** Down: each newer prompt, and past the newest, the draft. Nothing to do outside a walk. */
export function recallDown(recall: Recall | undefined, text: string): Move | undefined {
  if (!recall) return undefined;
  const left = leave(recall, text);
  // An edit set aside is the newest entry, and is not shown again on the way out.
  if (left.index === 0 || (left.abandoned !== undefined && left.index === 1)) return back(recall, left.abandoned);
  return on(recall, left.entries, left.index - 1, left.abandoned);
}

/** Escape: the draft, at once. */
export function recallEscape(recall: Recall | undefined, text: string): Move | undefined {
  if (!recall) return undefined;
  return back(recall, leave(recall, text).abandoned);
}

/** How long ago, in the words a glance takes, or in full words for a screen reader. */
function ago(ms: number, plain: boolean): string {
  const minutes = Math.floor(ms / 60_000);
  if (ms < 45_000) return 'just now';
  const [count, short, long] = minutes < 60 ? [Math.max(1, minutes), 'm', 'minute'] : minutes < 1_440 ? [Math.floor(minutes / 60), 'h', 'hour'] : [Math.floor(minutes / 1_440), 'd', 'day'];
  return plain ? `${count} ${long}${count === 1 ? '' : 's'} ago` : `${count}${short} ago`;
}

/** The one row over the composer while a walk is on: where it is, and what the keys do. */
export function describeRecall(recall: Recall, now: number, plain: boolean): string {
  const total = recall.entries.length;
  const entry = recall.entries[recall.index];
  const when = `${entry.state === 'cleared' ? 'cleared' : 'sent'} ${ago(now - entry.ts, plain)}`;
  const drafted = recall.stash.trim() !== '';
  if (plain) {
    const keys = drafted ? 'after the newest, Down returns your draft, and Escape returns it now' : 'Escape leaves history';
    return `History: prompt ${recall.index + 1} of ${total}, ${when}. Up is older and Down is newer; ${keys}.`;
  }
  const down = recall.index === 0 ? (drafted ? '↓ your draft' : '↓ newer') : drafted ? '↓ newer, then your draft' : '↓ newer';
  return [`history ${recall.index + 1}/${total}`, when, ...(recall.index < total - 1 ? ['↑ older'] : []), down].join(' · ');
}
