import { expect, test } from 'bun:test';
import { range } from './range';

test('range(3) is 0, 1, 2', () => expect(range(3)).toEqual([0, 1, 2]));
test('range(0) is empty', () => expect(range(0)).toEqual([]));
