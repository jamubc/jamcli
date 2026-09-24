import { loadConfig } from '../../core/config/load.js';
import { commitChanges, planCommit, type CommitPlan } from '../../core/git/commit.js';
import { readChanges } from '../../core/git/review.js';
import type { CommandContext, SlashCommand } from './commands.js';
import { diff } from './review.js';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Show what would be committed and the message, and commit only when the person says so. */
function confirm(ctx: CommandContext, paths: string[], given: string | undefined): void {
  let plan: CommitPlan;
  try {
    plan = planCommit(ctx.runtime.workRoot, paths);
  } catch (error: any) {
    return ctx.notice('warn', `Not committed: ${error?.message ?? error}`);
  }
  const attribution = loadConfig({ projectRoot: ctx.projectRoot }).config.git?.attribution;
  const files = plan.files.map((file) => `${file.status} ${file.path}`).join('\n');
  let message = given ?? '';
  ctx.pick({
    title: 'Commit this?',
    items: (given ? Promise.resolve(given) : ctx.runtime.draftCommitMessage(paths)).then(
      (text) => {
        message = text;
        return {
          items: [
            { key: 'commit', label: 'Commit', detail: 'with this message, running the repository\'s hooks' },
            { key: 'edit', label: 'Edit the message', detail: 'it goes to the composer as /commit <message>' },
          ],
          note: `${text}\n\n${files}\n${plan.stat}${attribution ? `\n\nWith the trailer ${attribution}, from git.attribution.` : ''}`,
        };
      },
      (error: any) => ({ items: [], note: `No message was drafted: ${error?.message ?? error}. Write one with /commit <message>.` })
    ),
    empty: 'Nothing to commit.',
    hint: 'Enter chooses · Escape leaves everything as it is',
    choose: async (item) => {
      if (item.key === 'edit') return ctx.prefill(`/commit ${message}`);
      try {
        const done = await commitChanges(ctx.runtime.workRoot, message, { paths, ...(attribution ? { attribution } : {}) });
        ctx.notice('info', `Committed ${done.sha.slice(0, 12)}: ${done.subject}.`);
        if (done.output) ctx.show(done.output);
      } catch (error: any) {
        ctx.notice('error', `Not committed: ${error?.message ?? error}`);
      }
    },
  });
}

export const commit: SlashCommand = {
  name: 'commit',
  args: '[message]',
  summary: 'Commit what is staged, with a message you write or the model drafts',
  source: 'built-in',
  async run(ctx, args) {
    if (ctx.running) return ctx.notice('warn', 'A turn is running; commit when it ends, or press Escape to stop it.');
    let plan: CommitPlan;
    try {
      plan = planCommit(ctx.runtime.workRoot);
    } catch {
      return ctx.notice('info', 'This project is not a git repository, so there is nothing to commit.');
    }
    const given = args.trim() || undefined;
    if (plan.files.length) return confirm(ctx, [], given);
    const changes = await readChanges(ctx.runtime.workRoot);
    const changed = new Set([...changes.unstaged.map((file) => file.file)]).size;
    if (!changed && !changes.untracked.length) return ctx.notice('info', 'Nothing to commit: the working copy is as the last commit left it.');
    ctx.pick({
      title: 'Nothing is staged',
      items: [
        { key: 'all', label: 'Stage everything and commit', detail: `${plural(changed, 'changed file')} and ${plural(changes.untracked.length, 'untracked file')}` },
        { key: 'diff', label: 'Choose what to stage with /diff', detail: 'then /commit again' },
      ],
      empty: 'Nothing to commit.',
      hint: 'Enter chooses',
      choose: (item) => (item.key === 'all' ? confirm(ctx, [changes.root], given) : diff.run(ctx, '')),
    });
  },
};
