import type { CommandContext, SlashCommand } from './commands.js';
import { runWorkflowCommand } from '../../cli/workflow.js';

/** A yes-or-no question in the picker; Escape answers no. */
const askIn = (ctx: CommandContext) => (question: string) =>
  new Promise<boolean>((resolve) => {
    ctx.pick({
      title: question,
      items: [
        { key: 'yes', label: 'Yes', detail: 'go on' },
        { key: 'no', label: 'No', detail: 'the step fails, and what needs it does not run' },
      ],
      empty: 'Nothing to choose.',
      hint: 'Enter chooses · Escape says no',
      choose: (item) => resolve(item.key === 'yes'),
      dismissed: () => resolve(false),
    });
  });

export const workflowsCommand: SlashCommand = {
  name: 'workflows',
  args: '[run <name> [input=value ...] | approve <run> <step> | reject <run> <step>]',
  summary: 'List the workflows and recent runs, run one, or answer a waiting approval',
  source: 'built-in',
  run(ctx, args) {
    const words = args.trim().split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    const io = {
      out: (line: string) => {
        lines.push(line);
        // Each step's progress shows as it happens; the whole report shows at the end.
        if (words[0] && /^- /.test(line)) ctx.notice('info', line.split('\n')[0]);
      },
      err: (line: string) => lines.push(line),
      ask: askIn(ctx),
    };
    const [action, ...rest] = words;
    const command =
      action === 'run'
        ? ['run', rest[0] ?? '', ...rest.slice(1).flatMap((pair) => ['--input', pair])]
        : action === 'approve' || action === 'reject'
          ? ['approve', rest[0] ?? '', rest[1] ?? '', ...(action === 'reject' ? ['--reject'] : [])]
          : ['list'];
    void runWorkflowCommand(command, ctx.projectRoot, { io }).then(() => ctx.show(lines.join('\n')));
  },
};
