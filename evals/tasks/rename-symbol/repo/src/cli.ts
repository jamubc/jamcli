import { fetchUser } from './api';

export async function show(id: number): Promise<string> {
  return JSON.stringify(await fetchUser(id));
}
