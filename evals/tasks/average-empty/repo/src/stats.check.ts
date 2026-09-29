import { expect, test } from 'bun:test';
import { average } from './stats';

test('the mean of the values', () => {
  expect(average([2, 4])).toBe(3);
  expect(average([5])).toBe(5);
});
test('an empty list averages to 0', () => expect(average([])).toBe(0));
