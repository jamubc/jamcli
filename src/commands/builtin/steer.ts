import { loadConfig, userConfigFile } from '../../core/config/load.js';
import { runConfigCommand } from '../../cli/config.js';
import type { CommandContext, SlashCommand } from '../types.js';
import { reopen } from './reopen.js';

export const steer: SlashCommand = {
  name: 'steer',
  args: '[instruction]',
  summary: 'Queue a steering instruction',
  source: 'built-in',
  run(ctx, args) {
    if (!args?.trim()) {
      return ctx.show('Usage: /steer <instruction>. to steer the current conversation.');
    }
    ctx.runtime.steer(args.trim());
    ctx.notice('info', 'Steering instruction queued for the next turn.');
  },
};

export const goal: SlashCommand = {
  name: 'goal',
  args: '[<text>|clear]',
  summary: 'Set or manage a goal',
  source: 'built-in',
  run(ctx, args) {
    const trimmed = args?.trim();
    if (trimmed?.toLowerCase() === 'clear') {
      ctx.runtime.setGoal(undefined);
      return ctx.notice('info', 'Standing goal cleared.');
    }
    if (!trimmed) {
      const current = ctx.runtime.getGoal();
      if (current) return ctx.show(`Standing goal: ${current}\n\nUse /goal clear to remove it, or /goal <text> to replace it.`);
      return ctx.show('No standing goal set. Use /goal <text> to set one, or /goal clear to remove it.');
    }
    ctx.runtime.setGoal(trimmed);
    ctx.notice('info', `Standing goal set: ${trimmed}`);
  },
};

/** Each steering setting, the value `on` and `off` give it, and what it does. */
const SETTINGS: { key: string; on: string; off: string; does: string }[] = [
  { key: 'agent_loop.tool_use_enforcement', on: 'on', off: 'off', does: 'asks the model in the prompt to act rather than describe' },
  { key: 'agent_loop.execution_guidance', on: 'on', off: 'off', does: 'guidance on persisting, counting with tools, and reading work back' },
  { key: 'agent_loop.intent_ack_continuation', on: 'on', off: 'off', does: 'asks a model that narrated what it would do to carry on and do it' },
  { key: 'agent_loop.stall_guards', on: 'true', off: 'false', does: 'catches a call written as text and the same call repeated' },
  { key: 'agent_loop.tool_loop_guardrails', on: 'true', off: 'false', does: 'stops the turn when a call repeats without progress' },
];

/**
 * Write every setting at the user scope, and name the ones that could not be written. These
 * are the person's choices about how their models behave, so they belong in their own
 * configuration and not in the repository they happen to be standing in.
 */
async function writeStack(ctx: CommandContext, value: 'on' | 'off'): Promise<string[]> {
  const failed: string[] = [];
  // runConfigCommand writes its advisories, such as a value another layer also sets, to the
  // same stream as its errors, so only the exit code says whether this one landed.
  const quiet = { out: () => undefined, err: () => undefined };
  for (const setting of SETTINGS) {
    const code = await runConfigCommand({ action: 'set', args: [setting.key, value === 'on' ? setting.on : setting.off, '--scope', 'user'] }, ctx.projectRoot, quiet);
    if (code !== 0) failed.push(setting.key);
  }
  return failed;
}

export const agentic: SlashCommand = {
  name: 'agentic',
  args: '[on|off]',
  summary: 'Enable Autonomy',
  source: 'built-in',
  async run(ctx, args) {
    const action = args?.trim().toLowerCase();
    if (action === 'on' || action === 'off') {
      const failed = await writeStack(ctx, action);
      // The session reopens either way: what was saved applies, and what was not is named.
      await reopen(ctx);
      const done = action === 'on' ? 'Autonomy is on' : 'Autonomy is off';
      if (failed.length) {
        const missing = failed.map((key) => `  ${key}`).join('\n');
        ctx.notice('warn', `${done} in ${userConfigFile()}, except these, which were not saved:\n${missing}`);
        return;
      }
      ctx.notice('info', `${done}, in ${userConfigFile()}.`);
      return;
    }
    if (action) return ctx.notice('warn', `/agentic takes on or off, not ${action}.`);
    const currentLoop = loadConfig({ projectRoot: ctx.projectRoot }).config.agent_loop ?? {};
    const shown = (key: string, does: string): string => {
      const short = key.replace('agent_loop.', '');
      const value = (currentLoop as Record<string, unknown>)[short];
      return `- ${short}: ${value === undefined ? 'off (default)' : value} (${does})`;
    };
    ctx.show(
      [
        'Steering and guards off, see:',
        ...SETTINGS.map((setting) => shown(setting.key, setting.does)),
        '',
        `Saved in ${userConfigFile()}. This session is in ${ctx.runtime.permissionMode} mode.`,
        '',
        '/agentic on turns all five on, /agentic off turns them off, and neither writes to the project.',
        '/steer <text> queues an instruction for the next turn, /goal <text> keeps one across turns.',
      ].join('\n'),
    );
  },
};
