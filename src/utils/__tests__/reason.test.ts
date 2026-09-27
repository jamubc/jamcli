import { expect, test } from 'bun:test';
import { reasonOf } from '../reason.js';

test("an error's message loses its closing full stop, so the sentence around it ends once", () => {
  expect(`No message was drafted: ${reasonOf(new Error('The model sent back an empty message.'))}.`).toBe('No message was drafted: The model sent back an empty message.');
  expect(reasonOf(new Error('no stop'))).toBe('no stop');
  expect(reasonOf('plain text.')).toBe('plain text');
  expect(reasonOf(new Error('is it?'))).toBe('is it?');
});
