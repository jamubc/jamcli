import { expect, test } from 'bun:test';
import type { TypedPrompt } from '../../../core/transcript/index.js';
import { describeRecall, isRecalled, recallDown, recallEscape, recallUp } from '../recall.js';

const sent = (text: string, ts = 0): TypedPrompt => ({ text, state: 'sent', ts });
/** Newest first, as recall is handed them. */
const entries = [sent('c'), sent('b'), sent('a')];

test('Up with nothing sent does nothing', () => {
  expect(recallUp(undefined, 'draft', [])).toBeUndefined();
  expect(recallDown(undefined, 'draft')).toBeUndefined();
});

test('the first Up keeps the draft aside and shows the newest; Up goes older and stops at the oldest', () => {
  const first = recallUp(undefined, 'my draft', entries)!;
  expect(first.text).toBe('c');
  expect(first.recall).toMatchObject({ index: 0, stash: 'my draft' });
  const second = recallUp(first.recall, first.text, entries)!;
  expect(second.text).toBe('b');
  const third = recallUp(second.recall, second.text, entries)!;
  expect(third.text).toBe('a');
  const beyond = recallUp(third.recall, third.text, entries)!;
  expect(beyond.text).toBe('a');
  expect(beyond.recall).toMatchObject({ index: 2, stash: 'my draft' });
});

test('Down goes newer, and past the newest gives the draft back', () => {
  let move = recallUp(undefined, 'my draft', entries)!;
  move = recallUp(move.recall, move.text, entries)!;
  move = recallUp(move.recall, move.text, entries)!;
  expect(move.text).toBe('a');
  move = recallDown(move.recall, move.text)!;
  expect(move.text).toBe('b');
  move = recallDown(move.recall, move.text)!;
  expect(move.text).toBe('c');
  move = recallDown(move.recall, move.text)!;
  expect(move).toMatchObject({ recall: undefined, text: 'my draft' });
  expect(move.abandoned).toBeUndefined();
});

test('Escape gives the draft back, and an empty draft comes back empty', () => {
  const move = recallUp(undefined, '', entries)!;
  expect(recallEscape(move.recall, move.text)).toMatchObject({ recall: undefined, text: '' });
  expect(recallEscape(undefined, 'x')).toBeUndefined();
});

test('a recalled prompt is recognised until it is edited', () => {
  const move = recallUp(undefined, '', entries)!;
  expect(isRecalled(move.recall, 'c')).toBe(true);
  expect(isRecalled(move.recall, 'c!')).toBe(false);
  expect(isRecalled(undefined, 'c')).toBe(false);
});

test('walking away from an edited prompt hands it back as abandoned, and the walk goes on from where it was', () => {
  let move = recallUp(undefined, 'my draft', entries)!;
  move = recallUp(move.recall, move.text, entries)!;
  expect(move.text).toBe('b');
  // The person adds to b and then presses Up.
  const up = recallUp(move.recall, 'b, and more', entries)!;
  expect(up.text).toBe('a');
  expect(up.abandoned).toBe('b, and more');
  // Down returns through b and c, and the edit is the newest thing there, so it is not shown again.
  const down = recallDown(up.recall, up.text)!;
  expect(down.text).toBe('b');
  expect(down.abandoned).toBeUndefined();
  const newer = recallDown(down.recall, down.text)!;
  expect(newer.text).toBe('c');
  const newest = recallDown(newer.recall, newer.text)!;
  expect(newest.text).toBe('b, and more');
  expect(recallDown(newest.recall, newest.text)).toMatchObject({ recall: undefined, text: 'my draft' });
});

test('an edit of the newest prompt, walked away from by Down, goes to the draft and is kept', () => {
  const move = recallUp(undefined, 'my draft', entries)!;
  const down = recallDown(move.recall, 'c but changed')!;
  expect(down).toMatchObject({ recall: undefined, text: 'my draft', abandoned: 'c but changed' });
});

test('Escape from an edited prompt keeps the edit as abandoned; an emptied composer keeps nothing', () => {
  const move = recallUp(undefined, 'my draft', entries)!;
  expect(recallEscape(move.recall, 'c edited')).toMatchObject({ recall: undefined, text: 'my draft', abandoned: 'c edited' });
  expect(recallEscape(move.recall, '  ')).toMatchObject({ text: 'my draft' });
  expect(recallEscape(move.recall, '  ')!.abandoned).toBeUndefined();
});

test('the strip says which prompt of how many, how long ago, and whether it was cleared', () => {
  const now = 10 * 60_000;
  const list = [sent('c', now - 4 * 60_000), { text: 'b', state: 'cleared' as const, ts: now - 3_600_000 * 3 }, sent('a', now - 1_000)];
  const at = (index: number, stash: string) => ({ entries: list, index, shown: list[index].text, stash });
  expect(describeRecall(at(0, ''), now, false)).toBe('history 1/3 · sent 4m ago · ↑ older · ↓ newer');
  expect(describeRecall(at(1, 'my draft'), now, false)).toBe('history 2/3 · cleared 3h ago · ↑ older · ↓ newer, then your draft');
  expect(describeRecall(at(2, ''), now, false)).toBe('history 3/3 · sent just now · ↓ newer');
  expect(describeRecall(at(1, 'my draft'), now, true)).toBe('History: prompt 2 of 3, cleared 3 hours ago. Up is older and Down is newer; after the newest, Down returns your draft, and Escape returns it now.');
  expect(describeRecall(at(0, ''), now, true)).toBe('History: prompt 1 of 3, sent 4 minutes ago. Up is older and Down is newer; Escape leaves history.');
});
