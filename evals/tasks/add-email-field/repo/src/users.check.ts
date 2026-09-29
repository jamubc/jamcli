import { expect, test } from 'bun:test';
import { createUser } from './users';

test('a user is created with its email', () => expect(createUser('ada', 'ada@example.com')).toEqual({ id: 1, name: 'ada', email: 'ada@example.com' }));
