/**
 * A large paste is shown in the composer as a chip, `[Pasted text #1: 42 lines]`, so it does
 * not take the screen, and is sent as the text it stands for. The chips of a draft are kept
 * with it, by number.
 */
export type Chips = Record<string, string>;

/** A paste of this many lines, or of more characters than the other limit, becomes a chip. */
const CHIP_LINES = 10;
const CHIP_CHARS = 1_000;

export const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

export const isLarge = (text: string): boolean => text.split('\n').length >= CHIP_LINES || text.length > CHIP_CHARS;

export function chipLabel(id: number | string, text: string): string {
  const lines = text.split('\n').length;
  return `[Pasted text #${id}: ${lines} ${lines === 1 ? 'line' : 'lines'}]`;
}

export const nextChipId = (chips: Chips): number => Object.keys(chips).reduce((most, id) => Math.max(most, Number(id)), 0) + 1;

const LABEL = /\[Pasted text #(\d+): \d+ lines?\]/g;

/** The text a draft will send: each chip as it was made replaced by its text, and any the person changed left as typed. */
export const expandChips = (text: string, chips: Chips): string =>
  text.replace(LABEL, (label, id: string) => (id in chips && label === chipLabel(id, chips[id]) ? chips[id] : label));

/** The chip the cursor is on, or directly after, and where it lies in the text. */
export function chipAt(text: string, offset: number, chips: Chips): { start: number; end: number; id: string } | undefined {
  for (const match of text.matchAll(LABEL)) {
    const [label, id] = match;
    const start = match.index ?? 0;
    const end = start + label.length;
    if (id in chips && label === chipLabel(id, chips[id]) && offset > start && offset <= end) return { start, end, id };
  }
  return undefined;
}
