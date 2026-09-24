import type { CheckpointInfo } from '../../core/runtime/index.js';
import { SessionLog } from '../../core/transcript/index.js';
import type { CommandContext, SlashCommand } from './commands.js';
import type { PickItem } from './Picker.js';

type Restore = 'files' | 'both' | 'conversation';

const clip = (text: string, length = 60) => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What the person said to start the turn a checkpoint was taken in, when the log has it. */
function turnPrompt(ctx: CommandContext, entry: CheckpointInfo): string | undefined {
  if (entry.turn === undefined) return undefined;
  try {
    const events = SessionLog.open(ctx.projectRoot, ctx.runtime.sessionId)
      .events()
      .filter((event) => event.type !== 'session');
    const event = events[entry.turn];
    return event?.type === 'message' && typeof event.message.content === 'string' ? event.message.content : undefined;
  } catch {
    return undefined;
  }
}

/** Do what the person chose: the files, the conversation, or both. */
async function restore(ctx: CommandContext, entry: CheckpointInfo, what: Restore, prompt: string | undefined): Promise<void> {
  if (ctx.running) return ctx.notice('warn', 'A turn is running; restore when it ends, or press Escape to stop it.');
  if (what !== 'conversation') {
    const files = await ctx.runtime.restoreCheckpoint(entry.n);
    ctx.notice('info', `Restored ${plural(files.length, 'file')} to checkpoint ${entry.n}: ${files.join(', ')}. What they were is checkpointed too, so /rewind can bring it back.`);
    ctx.refresh();
  }
  if (what !== 'files' && entry.turn !== undefined) {
    // Before the session's first turn there is no conversation, which a new session is.
    const failed = await ctx.openSession(entry.turn === 0 ? {} : { sessionId: ctx.runtime.fork(entry.turn) });
    if (failed) return ctx.notice('warn', `The conversation was not restored: ${failed}`);
    ctx.notice('info', `The conversation is back to before "${clip(prompt ?? '')}", in a new session; the previous one stays in /resume.`);
    if (prompt) ctx.prefill(prompt);
  }
}

/** Show what restoring a checkpoint would change, then ask how much to restore. */
async function offer(ctx: CommandContext, entry: CheckpointInfo, title: string, withConversation: boolean): Promise<void> {
  const preview = await ctx.runtime.previewCheckpoint(entry.n);
  const prompt = withConversation ? turnPrompt(ctx, entry) : undefined;
  const changes = preview.files.map((file) => `${file.path} ${file.change}`).join(', ');
  ctx.dispatch(
    preview.files.length
      ? { type: 'output', text: `Checkpoint ${entry.n}, taken before ${entry.label}. Restoring it changes: ${changes}.`, diff: preview.diff }
      : { type: 'output', text: `Checkpoint ${entry.n}, taken before ${entry.label}. The files are as it left them.` }
  );
  const items: PickItem[] = [];
  if (preview.files.length) items.push({ key: 'files', label: 'Restore the files', detail: `${plural(preview.files.length, 'file')}, as shown above` });
  if (prompt !== undefined) {
    if (preview.files.length) items.push({ key: 'both', label: 'Restore the files and the conversation', detail: `back to before "${clip(prompt, 40)}"` });
    items.push({ key: 'conversation', label: 'Restore the conversation only', detail: `back to before "${clip(prompt, 40)}"; the files stay` });
  }
  if (!items.length) return ctx.notice('info', 'Nothing to restore: the files are as that checkpoint left them.');
  ctx.pick({
    title,
    items,
    empty: 'Nothing to restore.',
    hint: 'Enter restores · Escape leaves everything as it is',
    choose: (item) => restore(ctx, entry, item.key as Restore, prompt),
  });
}

const RESTORING = 'before restoring checkpoint';

const NO_CHECKPOINTS =
  'This session has no checkpoints yet. One is taken before each step that changes something: in a git repository, of the whole working copy; outside one, of the files an edit names, which leaves out what a command changes.';

export const undo: SlashCommand = {
  name: 'undo',
  summary: "Put the files back as they were before the model's last change",
  source: 'built-in',
  async run(ctx) {
    if (ctx.running) return ctx.notice('warn', 'A turn is running; undo when it ends, or press Escape to stop it.');
    // A restore's own checkpoint is for /rewind; /undo steps back over the model's changes.
    const latest = ctx.runtime
      .checkpoints()
      .filter((entry) => !entry.label.startsWith(RESTORING))
      .at(-1);
    if (!latest) return ctx.notice('info', NO_CHECKPOINTS);
    await offer(ctx, latest, `Undo ${latest.label}`, false);
  },
};

export const rewind: SlashCommand = {
  name: 'rewind',
  summary: 'Choose a checkpoint, and restore the files, the conversation, or both',
  source: 'built-in',
  run(ctx) {
    if (ctx.running) return ctx.notice('warn', 'A turn is running; rewind when it ends, or press Escape to stop it.');
    const entries = ctx.runtime.checkpoints();
    if (!entries.length) return ctx.notice('info', NO_CHECKPOINTS);
    ctx.pick({
      title: 'Checkpoints, latest first',
      items: [...entries].reverse().map((entry) => {
        const prompt = turnPrompt(ctx, entry);
        const time = new Date(entry.ts).toTimeString().slice(0, 8);
        return { key: String(entry.n), label: `${entry.n}. before ${entry.label}`, detail: prompt ? `${time} · "${clip(prompt, 40)}"` : time };
      }),
      empty: 'No checkpoints.',
      hint: 'Enter shows what it would change',
      choose: (item) => {
        const entry = entries.find((candidate) => String(candidate.n) === item.key)!;
        return offer(ctx, entry, `Rewind to checkpoint ${entry.n}`, true);
      },
    });
  },
};
