export async function fetchUser(id: number): Promise<{ id: number; name: string }> {
  return { id, name: `user${id}` };
}
