import { expect, test } from 'bun:test';
import { loadUser } from './api';
import { greet } from './app';
import { show } from './cli';

test('loadUser returns the user', async () => expect(await loadUser(2)).toEqual({ id: 2, name: 'user2' }));
test('greet and show still work', async () => {
  expect(await greet(3)).toBe('Hello, user3');
  expect(await show(4)).toBe('{"id":4,"name":"user4"}');
});
