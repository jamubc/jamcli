/** The first word of a line, lowercased. */
export function firstWord(line: string): string {
  const match = line.match(/\w+/);
  return match![0].toLowerCase();
}
