import { loadConfig, userConfigFile } from '../../core/config/load.js';
import { surveySetup, type Survey } from '../../core/onboarding/index.js';
import { createChatProvider } from '../../core/providers/factory.js';
import { OllamaProvider, type PullProgress } from '../../core/providers/ollama.js';
import { runConfigCommand } from '../../cli/config.js';
import type { CommandContext, SlashCommand } from './commands.js';
import { keysFor } from './keys.js';
import type { PickItem } from './Picker.js';
import { modelDetail } from './reports.js';

const HOSTED_KEYS = 'ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY';

/** What each permission mode lets run without asking, for a first run. */
export function modesText(cycle: string): string {
  return [
    'Permission modes decide what runs without asking:',
    '  default       reads run; edits, commands, and network requests ask',
    '  accept-edits  edits inside the project run too',
    '  plan          nothing changes; the model reads and proposes a plan',
    '  auto          commands run without asking, inside the sandbox',
    '  bypass        everything runs, after you confirm it',
    `${cycle} moves between them, and /permissions shows the rules.`,
  ].join('\n');
}

/** Use the model now and save it for every project. Nothing is written to this project. */
async function adopt(ctx: CommandContext, ref: string): Promise<void> {
  try {
    ctx.runtime.setModel(ref);
  } catch (error: any) {
    ctx.notice('warn', `Not switched to ${ref}: ${error?.message ?? error}`);
    return;
  }
  ctx.refresh();
  const said: string[] = [];
  const io = { out: (line: string) => said.push(line), err: (line: string) => said.push(line) };
  const code = await runConfigCommand({ action: 'set', args: ['model', ref, '--scope', 'user'] }, ctx.projectRoot, io);
  const saved = code === 0 ? `saved in ${userConfigFile()}` : `used for now but not saved: ${said.join(' ')}`;
  ctx.show(`Model: ${ref}, ${saved}. Nothing was written to this project.\n\n${modesText(keysFor(ctx.keys, 'cycle_mode'))}`);
}

/** Download a model through Ollama, saying how far it has come at each quarter, then use it. */
async function pull(ctx: CommandContext, name: string, sizeGb: number): Promise<void> {
  const provider = createChatProvider('ollama', loadConfig({ projectRoot: ctx.projectRoot }).config.api_registry);
  if (!(provider instanceof OllamaProvider)) return ctx.notice('warn', 'This Ollama endpoint is OpenAI-compatible, so it cannot pull; run ollama pull in a terminal.');
  ctx.notice('info', `Downloading ${name}, about ${sizeGb} GB. JamCLI keeps working meanwhile.`);
  let largest = 0;
  let quarter = 0;
  const onProgress = (step: PullProgress) => {
    if (!step.total || !step.completed || step.total < largest) return;
    largest = step.total;
    const reached = Math.floor((step.completed / step.total) * 4);
    if (reached > quarter && reached < 4) {
      quarter = reached;
      ctx.notice('info', `Downloading ${name}: ${reached * 25}%.`);
    }
  };
  try {
    await provider.pull(name, onProgress);
  } catch (error: any) {
    return ctx.notice('error', `${error?.message ?? error} Run /setup to try again.`);
  }
  await adopt(ctx, `ollama:${name}`);
}

/** The choices a survey allows, and what to say above them. */
export function setupChoices(survey: Survey): { items: PickItem[]; note: string } {
  const items: PickItem[] = [];
  const { ollama } = survey;
  for (const model of ollama.models.filter((entry) => entry.tools !== false)) {
    const facts = [
      'on this machine',
      model.contextWindow ? `${model.contextWindow.toLocaleString('en-US')}-token window` : '',
      model.tools === undefined ? 'tool support unknown' : 'tools',
      survey.suggestion?.name === model.name ? 'suggested for this machine' : '',
    ];
    items.push({ key: `use:ollama:${model.name}`, label: `ollama:${model.name}`, detail: facts.filter(Boolean).join(' · ') });
  }
  const suggestion = survey.suggestion;
  if (suggestion && !ollama.models.some((model) => model.name === suggestion.name)) {
    const memory = Math.round(survey.memoryBytes / 1024 ** 3);
    items.push({ key: `pull:${suggestion.name}`, label: `Download ${suggestion.name}`, detail: `about ${suggestion.downloadGb} GB, suggested for ${memory} GB of memory` });
  }
  for (const key of survey.keys) items.push({ key: `provider:${key.provider}`, label: `${key.provider}: choose a model`, detail: `key from ${key.detail}` });
  items.push({ key: 'skip', label: 'Not now', detail: 'nothing is saved; /setup opens this again' });

  const notes: string[] = [];
  if (!ollama.reachable) {
    notes.push(`Ollama is not answering at ${ollama.endpoint}. Install it from ollama.com and start it with ollama serve, or set ${HOSTED_KEYS}; then run /setup. (${ollama.problem})`);
  } else if (!ollama.models.length) {
    notes.push(`Ollama answers at ${ollama.endpoint} but has no models yet.`);
  }
  const toolless = ollama.models.filter((model) => model.tools === false).length;
  if (toolless) notes.push(`${toolless} installed model${toolless === 1 ? '' : 's'} cannot call tools, so ${toolless === 1 ? 'it is' : 'they are'} not listed.`);
  notes.push('The choice is saved in your user configuration only.');
  return { items, note: notes.join(' ') };
}

/** A hosted provider's models, to choose from. */
function chooseHosted(ctx: CommandContext, provider: string): void {
  ctx.pick({
    title: `Models ${provider} offers`,
    items: ctx.runtime.listModels().then(({ models, problems }) => {
      const mine = models.filter((info) => info.provider === provider);
      const why = problems.filter((problem) => problem.startsWith(`${provider}:`));
      return {
        items: mine.map((info) => ({ key: `${info.provider}:${info.model}`, label: `${info.provider}:${info.model}`, detail: modelDetail(info) })),
        ...(why.length ? { note: why.join('; ') } : {}),
      };
    }),
    empty: `${provider} listed no models. Name one with /model ${provider}:<model>.`,
    hint: 'Enter uses it and saves it for every project',
    choose: (item) => adopt(ctx, item.key),
  });
}

export const setup: SlashCommand = {
  name: 'setup',
  summary: 'Choose a provider and model, as on the first run',
  source: 'built-in',
  run(ctx) {
    if (ctx.running) return ctx.notice('warn', 'A turn is running; run /setup when it ends, or press Escape to stop it.');
    const registry = loadConfig({ projectRoot: ctx.projectRoot }).config.api_registry;
    let surveyed: Survey | undefined;
    ctx.pick({
      title: 'Set up JamCLI: choose the model to work with',
      items: surveySetup({ registry }).then((survey) => {
        surveyed = survey;
        return setupChoices(survey);
      }),
      empty: 'Nothing to choose.',
      hint: 'Enter chooses',
      choose: (item) => {
        if (item.key === 'skip') return ctx.notice('info', 'Nothing was saved. /setup opens this again, and /model chooses a model for this session.');
        if (item.key.startsWith('use:')) return adopt(ctx, item.key.slice('use:'.length));
        if (item.key.startsWith('provider:')) return chooseHosted(ctx, item.key.slice('provider:'.length));
        const suggestion = surveyed?.suggestion;
        if (suggestion) void pull(ctx, suggestion.name, suggestion.downloadGb);
      },
    });
  },
};
