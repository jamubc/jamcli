import { branchState, ghState, openPullRequest, pullRequestPrompt, pushBranch, splitPullRequest, type BranchState } from '../../core/git/pr.js';
import type { CommandContext, SlashCommand } from './commands.js';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The second step: the pull request's title and body, and opening it when the person says
 * so. It opens at once; `ready` is the branch once any push chosen before it is done.
 */
function offerPullRequest(ctx: CommandContext, ready: Promise<BranchState>, title: string | undefined, head: { branch: string; base: string }): void {
  let drafted = { title: title ?? '', body: '' };
  let state: BranchState | undefined;
  ctx.pick({
    title: `Open a pull request from ${head.branch} into ${head.base}?`,
    items: ready
      .then((found) => {
        state = found;
        return title ? drafted : pullRequestPrompt(found).then((prompt) => ctx.runtime.complete(prompt)).then(splitPullRequest);
      })
      .then(
      (found) => {
        drafted = { title: title ?? found.title, body: found.body };
        return {
          items: [
            { key: 'open', label: 'Open it', detail: 'through gh, signed in as you' },
            { key: 'draft', label: 'Open it as a draft', detail: 'for review before it is ready' },
            { key: 'edit', label: 'Edit the title', detail: 'it goes to the composer as /pr <title>' },
          ],
          note: `${drafted.title}\n\n${drafted.body || '(no description)'}`,
        };
      },
      (error: any) => ({ items: [], note: state ? `No description was drafted: ${error?.message ?? error}. Give a title with /pr <title>.` : `${error?.message ?? error}` })
      ),
    empty: 'Nothing to open.',
    hint: 'Enter chooses · Escape leaves the branch pushed and no pull request open',
    choose: async (item) => {
      if (item.key === 'edit') return ctx.prefill(`/pr ${drafted.title}`);
      try {
        const url = await openPullRequest(state!, { title: drafted.title, body: drafted.body, draft: item.key === 'draft' });
        ctx.notice('info', `Opened ${url}${item.key === 'draft' ? ', as a draft' : ''}.`);
      } catch (error: any) {
        ctx.notice('error', `The pull request was not opened: ${error?.message ?? error}`);
      }
    },
  });
}

export const pr: SlashCommand = {
  name: 'pr',
  args: '[title]',
  summary: 'Push this branch and open a pull request through gh, each step approved',
  source: 'built-in',
  async run(ctx, args) {
    if (ctx.running) return ctx.notice('warn', 'A turn is running; open a pull request when it ends, or press Escape to stop it.');
    let state: BranchState;
    try {
      state = await branchState(ctx.projectRoot);
    } catch (error: any) {
      return ctx.notice('info', error?.message ?? String(error));
    }
    if (state.branch === state.base) {
      return ctx.notice('info', `This is ${state.base} itself; a pull request needs a branch of its own. Make one with git switch -c <name>, then /pr.`);
    }
    const gh = await ghState(state.root);
    if (gh === 'missing') return ctx.notice('info', 'Opening a pull request needs the GitHub CLI (gh). Install it and sign in with gh auth login; JamCLI never handles GitHub tokens itself.');
    if (gh === 'signed-out') return ctx.notice('info', 'gh is not signed in. Run gh auth login, then /pr again; JamCLI never handles GitHub tokens itself.');
    const title = args.trim() || undefined;
    if (state.upstream && state.ahead === 0) return offerPullRequest(ctx, Promise.resolve(state), title, state);
    if (!state.remote) return ctx.notice('info', 'This repository has no remote to push to. Add one with git remote add origin <url>, then /pr.');
    // The first step: pushing, approved on its own.
    ctx.pick({
      title: `Push ${state.branch} to ${state.remote}?`,
      items: [
        {
          key: 'push',
          label: 'Push',
          detail: state.upstream ? `${plural(state.ahead, 'commit')} not on ${state.upstream} yet` : `${plural(state.ahead, 'commit')} not on ${state.base}; the branch is new on ${state.remote}`,
        },
      ],
      empty: 'Nothing to push.',
      hint: 'Enter pushes, with your own git credentials · Escape pushes nothing',
      choose: () => {
        const pushed = pushBranch(state).then(
          () => {
            ctx.notice('info', `Pushed ${state.branch} to ${state.remote}.`);
            return branchState(ctx.projectRoot);
          },
          (error: any) => {
            throw new Error(`Not pushed: ${error?.message ?? error}`);
          }
        );
        offerPullRequest(ctx, pushed, title, state);
      },
    });
  },
};
