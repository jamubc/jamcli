import { expect, test } from 'bun:test';
import { firstWord } from './parse';

test('the first word, lowercased', () => expect(firstWord('Hello there')).toBe('hello'));
test('no words gives an empty string', () => {
  expect(firstWord('')).toBe('');
  expect(firstWord('   ')).toBe('');
});
