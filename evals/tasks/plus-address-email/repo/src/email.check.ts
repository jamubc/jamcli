import { expect, test } from 'bun:test';
import { isValidEmail } from './email';

test('accepts ordinary and plus addresses', () => {
  for (const good of ['ada@example.com', 'a+b@x.io', 'first.last@mail.co']) expect(isValidEmail(good)).toBe(true);
});
test('still rejects what is not an address', () => {
  for (const bad of ['no-at-sign', 'a@b', 'a@@b.com', 'a b@c.io']) expect(isValidEmail(bad)).toBe(false);
});
