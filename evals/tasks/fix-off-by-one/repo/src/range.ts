/** The numbers from 0 up to, but not including, n. */
export function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i += 1) out.push(i);
  return out;
}
