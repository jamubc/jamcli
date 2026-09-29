import { fetchUser } from './api';

export async function greet(id: number): Promise<string> {
  const user = await fetchUser(id);
  return `Hello, ${user.name}`;
}
