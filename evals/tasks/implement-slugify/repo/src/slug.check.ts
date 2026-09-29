import { expect, test } from 'bun:test';
import { slugify } from './slug';

test('lowercases and joins words with dashes', () => expect(slugify('Hello World')).toBe('hello-world'));
test('drops punctuation', () => expect(slugify('Ship it, now!')).toBe('ship-it-now'));
test('collapses repeated separators and trims them', () => expect(slugify('  a -- b  ')).toBe('a-b'));
