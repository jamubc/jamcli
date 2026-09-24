import { readChanges, revertFile, revertHunk, stageFile, stageHunk, unstageFile, unstageHunk, type Changes, type FileChange, type Hunk } from '../../core/git/review.js';
import type { CommandContext, SlashCommand } from './commands.js';
import type { PickItem } from './Picker.js';

/** One thing in the list: a hunk, or a whole file when it has no hunks to take apart. */
type Entry = { key: string; hunk?: Hunk; file?: FileChange; untracked?: string };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function entries(changes: Changes): Entry[] {
  const out: Entry[] = [];
  for (const file of [...changes.unstaged, ...changes.staged]) {
    if (file.hunks.length) file.hunks.forEach((hunk, index) => out.push({ key: `${file.staged ? 's' : 'u'}:${file.file}:${index}`, hunk }));
    else out.push({ key: `${file.staged ? 's' : 'u'}:${file.file}`, file });
  }
  for (const name of changes.untracked) out.push({ key: `n:${name}`, untracked: name });
  return out;
}

function item(entry: Entry): PickItem {
  if (entry.hunk) {
    const { hunk } = entry;
    return { key: entry.key, label: `${hunk.file} ${hunk.header}`, detail: `${hunk.staged ? 'staged' : 'not staged'} · +${hunk.added} -${hunk.removed}` };
  }
  if (entry.file) return { key: entry.key, label: entry.file.file, detail: `${entry.file.staged ? 'staged' : 'not staged'} · ${entry.file.kind}, whole file` };
  return { key: entry.key, label: entry.untracked!, detail: 'untracked' };
}

/** What can be done with one entry, and how it is said. */
function actions(entry: Entry): { key: string; label: string; detail: string }[] {
  const staged = entry.hunk?.staged ?? entry.file?.staged ?? false;
  if (staged) return [{ key: 'unstage', label: 'Unstage it', detail: 'the working copy keeps the change' }];
  const whole = !entry.hunk;
  return [
    { key: 'stage', label: whole ? 'Stage the file' : 'Stage it', detail: 'put it in the index for the next commit' },
    ...(entry.untracked ? [] : [{ key: 'revert', label: whole ? 'Revert the file' : 'Revert it', detail: 'undo the change in the working copy; /rewind can bring it back' }]),
  ];
}

/** Do what the person chose with one entry, and say what was done. */
async function act(ctx: CommandContext, changes: Changes, entry: Entry, action: string): Promise<void> {
  const { root } = changes;
  const name = entry.hunk ? `${entry.hunk.file} ${entry.hunk.header}` : (entry.file?.file ?? entry.untracked!);
  try {
    if (action === 'stage') await (entry.hunk ? stageHunk(root, entry.hunk) : stageFile(root, entry.file?.file ?? entry.untracked!));
    else if (action === 'unstage') await (entry.hunk ? unstageHunk(root, entry.hunk) : unstageFile(root, entry.file!.file));
    // A revert changes the working copy, so it is checkpointed like the model's changes.
    else await ctx.runtime.withCheckpoint(`revert ${name}`, () => (entry.hunk ? revertHunk(root, entry.hunk) : revertFile(root, entry.file!.file)));
  } catch (error: any) {
    return ctx.notice('warn', `Not done: ${error?.message ?? error}. The list shows the changes as they are now.`);
  }
  ctx.notice('info', `${action === 'stage' ? 'Staged' : action === 'unstage' ? 'Unstaged' : 'Reverted'} ${name}.`);
}

/**
 * The list of changes to act on. It opens at once, and `work` (an action just chosen) runs
 * before the changes are read again, so the list is never closed while keys arrive.
 */
function list(ctx: CommandContext, load: () => Promise<Changes>): void {
  let changes: Changes | undefined;
  let listed: Entry[] = [];
  ctx.pick({
    title: 'Changes, by hunk',
    items: load().then((loaded) => {
      changes = loaded;
      listed = entries(loaded);
      return { items: listed.map(item) };
    }),
    empty: 'No changes left.',
    hint: 'Enter chooses what to do with it',
    choose: (chosen) => {
      const entry = listed.find((candidate) => candidate.key === chosen.key)!;
      const found = changes!;
      ctx.pick({
        title: item(entry).label,
        items: actions(entry),
        empty: 'Nothing to do.',
        hint: 'Enter does it · Escape leaves it',
        choose: (action) =>
          list(ctx, async () => {
            await act(ctx, found, entry, action.key);
            return readChanges(ctx.runtime.workRoot);
          }),
      });
    },
  });
}

/** Show the changes in the transcript, then list them to act on. */
async function review(ctx: CommandContext): Promise<void> {
  let changes: Changes;
  try {
    changes = await readChanges(ctx.runtime.workRoot);
  } catch (error: any) {
    return ctx.notice('info', error?.message ?? String(error));
  }
  if (!entries(changes).length) return ctx.notice('info', 'No changes: the working copy is as the last commit left it.');
  const count = (files: FileChange[]) => plural(files.reduce((sum, file) => sum + Math.max(1, file.hunks.length), 0), 'change');
  if (changes.staged.length) ctx.dispatch({ type: 'output', text: `Staged, ${count(changes.staged)}:`, diff: changes.staged.map((file) => file.diff).join('') });
  if (changes.unstaged.length) ctx.dispatch({ type: 'output', text: `Not staged, ${count(changes.unstaged)}:`, diff: changes.unstaged.map((file) => file.diff).join('') });
  if (changes.untracked.length) ctx.show(`Untracked: ${changes.untracked.join(', ')}`);
  list(ctx, async () => changes);
}

export const diff: SlashCommand = {
  name: 'diff',
  summary: 'Review the changes by hunk, and stage, unstage, or revert each',
  source: 'built-in',
  run(ctx) {
    if (ctx.running) return ctx.notice('warn', 'A turn is running; review when it ends, or press Escape to stop it.');
    return review(ctx);
  },
};
