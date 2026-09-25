/**
 * The `#` note (owner decision on D14): what a person types after `#` at the start of the
 * composer is appended to the project's AGENTS.md, after a confirmation showing it, through
 * the tool path so permissions and checkpoints apply.
 */

/** The note in a draft that starts with `#`, or nothing. */
export const noteText = (draft: string): string | undefined => {
  const match = /^#\s*([\s\S]*)$/.exec(draft.trim());
  const note = match?.[1]?.trim();
  return note ? note : undefined;
};

/** The tool call that appends the note: `edit` when the last line is a unique anchor, else `write_file`. */
export function noteCall(file: string, current: string, note: string): { name: 'edit' | 'write_file'; arguments: Record<string, unknown> } {
  const next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${note}\n`;
  const lines = current.replace(/\n$/, '').split('\n');
  const last = lines[lines.length - 1] ?? '';
  const unique = last.trim().length > 0 && current.split(last).length - 1 === 1;
  return unique
    ? { name: 'edit', arguments: { path: file, find_string: last, replace_string: `${last}\n${note}` } }
    : { name: 'write_file', arguments: { path: file, content: next } };
}
