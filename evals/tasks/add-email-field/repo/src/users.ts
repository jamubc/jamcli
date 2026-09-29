import type { User } from './types';

let next = 1;

export function createUser(name: string): User {
  return { id: next++, name };
}
