import { expect, test } from 'bun:test';
import { chipAt, chipLabel, expandChips, isLarge, nextChipId, normalizeNewlines } from '../paste.js';

const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');

test('a paste is large from ten lines, or over a thousand characters', () => {
  expect(isLarge(lines(9))).toBe(false);
  expect(isLarge(lines(10))).toBe(true);
  expect(isLarge('x'.repeat(1000))).toBe(false);
  expect(isLarge('x'.repeat(1001))).toBe(true);
});

test('line endings are made one kind', () => {
  expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
});

test('a chip is named by its number and how many lines it stands for', () => {
  expect(chipLabel(1, lines(42))).toBe('[Pasted text #1: 42 lines]');
  expect(chipLabel(3, 'x'.repeat(2000))).toBe('[Pasted text #3: 1 line]');
  expect(nextChipId({})).toBe(1);
  expect(nextChipId({ '1': 'a', '4': 'b' })).toBe(5);
});

test('chips expand to the text they stand for, wherever they sit, and only when they are as they were made', () => {
  const first = lines(12);
  const second = 'cost is $& and $1 and $$';
  const chips = { '1': first, '2': second };
  const text = `look at ${chipLabel(1, first)} and ${chipLabel(2, second)}.`;
  // Characters that mean something to a replacement string are text.
  expect(expandChips(text, chips)).toBe(`look at ${first} and ${second}.`);
  // A label the person has changed, or one with no text behind it, is left as it is.
  const edited = `${chipLabel(1, first).replace('12 lines', '13 lines')} and ${chipLabel(9, 'x')}`;
  expect(expandChips(edited, chips)).toBe(edited);
  expect(expandChips('nothing to expand', chips)).toBe('nothing to expand');
});

test('a chip is found when the cursor is on it or directly after it, and not otherwise', () => {
  const chips = { '1': lines(12) };
  const label = chipLabel(1, chips['1']);
  const text = `ab ${label} cd`;
  const start = 3;
  const end = start + label.length;
  expect(chipAt(text, end, chips)).toEqual({ start, end, id: '1' });
  expect(chipAt(text, start + 5, chips)).toEqual({ start, end, id: '1' });
  expect(chipAt(text, start, chips)).toBeUndefined();
  expect(chipAt(text, end + 1, chips)).toBeUndefined();
  expect(chipAt('no chip here', 4, chips)).toBeUndefined();
  expect(chipAt(text, end, {})).toBeUndefined();
});
