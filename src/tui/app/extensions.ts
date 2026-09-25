import { commandsReport, hooksReport, skillsReport } from '../../cli/extensions.js';
import { loadCommands } from '../../core/ext/commands.js';
import { loadSkills } from '../../core/ext/skills.js';
import { needsTrust } from '../../core/hooks/commands.js';
import type { CommandContext, SlashCommand } from './commands.js';

export const skills: SlashCommand = {
  name: 'skills',
  summary: 'List the skills the model can load, and any that could not be read',
  source: 'built-in',
  run(ctx) {
    ctx.show(skillsReport(loadSkills(ctx.projectRoot), ctx.projectRoot));
  },
};

export const plugins: SlashCommand = {
  name: 'plugins',
  summary: 'List the installed plugins, what each may reach, and whether it is on',
  source: 'built-in',
  run(ctx) {
    const lines: string[] = [];
    void import('../../cli/plugin.js')
      .then(({ runPluginCommand }) => runPluginCommand(['list'], ctx.projectRoot, { out: (line) => lines.push(line), err: (line) => lines.push(line) }))
      .then(() =>
      ctx.show([...lines, '', 'Install, update, or remove plugins with jamcli plugin; changes load with the next session.'].join('\n'))
    );
  },
};

export const commandsList: SlashCommand = {
  name: 'commands',
  summary: 'List the custom commands, from this project and your own',
  source: 'built-in',
  run(ctx) {
    const reserved = ctx.commands().filter((command) => command.source === 'built-in').flatMap((command) => [command.name, ...(command.aliases ?? [])]);
    ctx.show(commandsReport(loadCommands(ctx.projectRoot, reserved), ctx.projectRoot));
  },
};

/**
 * Ask once whether to run the project's hooks, showing what they run. Trust is recorded
 * outside the project, for these hooks as they are; a change asks again.
 */
export function askToTrustHooks(ctx: CommandContext): void {
  const { hooks } = ctx.runtime.hooks();
  const project = hooks.filter(needsTrust);
  ctx.pick({
    title: 'This project configures hooks. Run them?',
    items: [
      { key: 'trust', label: 'Trust them and run them', detail: 'for this project, until they change' },
      { key: 'not-now', label: 'Not now', detail: 'they stay off; /hooks trust turns them on' },
    ],
    note: project.map((hook) => `${hook.event}${hook.matcher ? ` ${hook.matcher}` : ''}: ${hook.command}  (${hook.source})`).join('\n'),
    empty: 'No hooks.',
    hint: 'Enter chooses · Escape leaves them off',
    choose: (item) => {
      if (item.key !== 'trust') return ctx.notice('info', 'The project\'s hooks stay off. /hooks trust turns them on.');
      ctx.runtime.trustProjectHooks();
      ctx.notice('info', `Trusted ${project.length} hook${project.length === 1 ? '' : 's'}; they run from now on.`);
    },
  });
}

export const hooksCommand: SlashCommand = {
  name: 'hooks',
  args: '[trust]',
  summary: 'List the configured hooks, or trust this project\'s',
  source: 'built-in',
  run(ctx, args) {
    const { hooks, projectTrusted } = ctx.runtime.hooks();
    if (args.trim() === 'trust') {
      if (projectTrusted || !hooks.some(needsTrust)) return ctx.notice('info', hooks.some(needsTrust) ? 'This project\'s hooks are trusted already.' : 'This project configures no hooks.');
      return askToTrustHooks(ctx);
    }
    if (args.trim()) return ctx.notice('warn', 'Use /hooks to list them, or /hooks trust.');
    ctx.show(hooksReport(hooks, projectTrusted));
  },
};
