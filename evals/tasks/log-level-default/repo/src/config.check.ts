import { expect, test } from 'bun:test';
import { logLevel } from './config';

test('the configured level wins', () => expect(logLevel({ LOG_LEVEL: 'debug' })).toBe('debug'));
test('unset or empty is info', () => {
  expect(logLevel({})).toBe('info');
  expect(logLevel({ LOG_LEVEL: '' })).toBe('info');
});
