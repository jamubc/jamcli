import { loadConfig } from '../../core/config/load.js';
import { runConfigCommand } from '../../cli/config.js';
import {
  BUILTIN_SPINNER_STYLES,
  BUILTIN_TEXT_STYLES,
  listStatusSpinnerStyleOptions,
  listStatusTextStyleOptions,
  resolveStatusStyle,
} from '../../styles/statusStyles.js';
import type { StatusSpinnerStyleId, StatusTextStyleId } from '../../types/config.js';
import type { CommandContext, SlashCommand } from './commands.js';
import { frameRow, mergedUi } from './statusStyle.js';
import type { PickItem } from './Picker.js';

type Part = 'words' | 'spinner';

const SETTING: Record<Part, string> = { words: 'ui.status_text_style', spinner: 'ui.status_spinner_style' };

/** Use a style for the indicator's words or spinner now, and save it for every project. */
async function apply(ctx: CommandContext, part: Part, id: string): Promise<void> {
  const ui = mergedUi(loadConfig({ projectRoot: ctx.projectRoot }).config.ui ?? {});
  const next = await resolveStatusStyle({
    uiConfig: ui,
    textStyleId: part === 'words' ? (id as StatusTextStyleId) : ctx.statusStyle.textStyleId,
    spinnerStyleId: part === 'spinner' ? (id as StatusSpinnerStyleId) : ctx.statusStyle.spinnerStyleId,
  });
  ctx.setStatusStyle(next);
  const said: string[] = [];
  const io = { out: (line: string) => said.push(line), err: (line: string) => said.push(line) };
  const code = await runConfigCommand({ action: 'set', args: [SETTING[part], id, '--scope', 'user'] }, ctx.projectRoot, io);
  const saved = code === 0 ? ' It is saved in your user configuration.' : ` It could not be saved: ${said.join(' ')}`;
  const shown = part === 'words' ? next.textStyleId : next.spinnerStyleId;
  // A custom style that cannot be read falls back to the default, and says so.
  const fell = shown !== id ? ` ${id} could not be read, so ${shown} is used.` : '';
  ctx.notice(code === 0 && !fell ? 'info' : 'warn', `Indicator ${part}: ${shown}.${fell}${saved}`);
}

export const style: SlashCommand = {
  name: 'style',
  args: '[<words style>|<spinner style>]',
  summary: "Choose the working indicator's spinner and colors, saved for every project",
  source: 'built-in',
  async run(ctx, args) {
    if (args) {
      if (BUILTIN_TEXT_STYLES[args]) return apply(ctx, 'words', args);
      if (BUILTIN_SPINNER_STYLES[args]) return apply(ctx, 'spinner', args);
      return ctx.notice('warn', `${args} is not a built-in style; /style lists them, with your own.`);
    }
    const ui = mergedUi(loadConfig({ projectRoot: ctx.projectRoot }).config.ui ?? {});
    const [words, spinners] = await Promise.all([listStatusTextStyleOptions(ui), listStatusSpinnerStyleOptions(ui)]);
    const items: PickItem[] = [
      ...spinners.map((option) => {
        const frames = BUILTIN_SPINNER_STYLES[option.id]?.spinnerFrames.map(frameRow).join(' ');
        return {
          key: `spinner:${option.id}`,
          label: `Spinner: ${option.label}`,
          detail: option.source === 'custom' ? `your own, from ${option.path}` : frames,
          ...(ctx.statusStyle.spinnerStyleId === option.id ? { current: true } : {}),
        };
      }),
      ...words.map((option) => ({
        key: `words:${option.id}`,
        label: `Words: ${option.label}`,
        detail: option.source === 'custom' ? `your own, from ${option.path}` : BUILTIN_TEXT_STYLES[option.id]?.shimmerColors.join(', '),
        ...(ctx.statusStyle.textStyleId === option.id ? { current: true } : {}),
      })),
    ];
    ctx.pick({
      title: 'Working indicator styles',
      items,
      empty: 'No styles.',
      hint: 'Enter uses it and saves it',
      choose: (item) => {
        const [part, ...rest] = item.key.split(':');
        return apply(ctx, part as Part, rest.join(':'));
      },
    });
  },
};
