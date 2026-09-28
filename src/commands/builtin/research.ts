import path from 'path';
import { loadPipelines, researchBrief, type ResearchPipeline } from '../../core/research/pipeline.js';
import { pipelineDirs } from '../../core/research/pipeline.js';
import type { CommandContext, SlashCommand } from '../types.js';

const describe = (pipeline: ResearchPipeline): string =>
  `${pipeline.name}: ${pipeline.description} (${pipeline.angles} line${pipeline.angles === 1 ? '' : 's'} of inquiry, ${pipeline.depth}${pipeline.freshness !== 'noLimit' ? `, ${pipeline.freshness}` : ''}${pipeline.include.length ? `, from ${pipeline.include.join(', ')}` : ''}${pipeline.exclude.length ? `, never ${pipeline.exclude.join(', ')}` : ''}; ${pipeline.source === 'built-in' ? 'built in' : path.relative(process.cwd(), pipeline.file!) || pipeline.file})`;

function listPipelines(ctx: CommandContext): void {
  const { pipelines, problems } = loadPipelines(ctx.projectRoot);
  const where = pipelineDirs(ctx.projectRoot).map(({ source, dir }) => `${source}: ${dir}`);
  ctx.show(
    [
      'Research pipelines:',
      ...pipelines.map((pipeline) => `- ${describe(pipeline)}`),
      '',
      'A pipeline is a Markdown file named after it, with front matter for angles, depth (quick, standard, deep), freshness, include, exclude, agent, and output; its body is added to every brief.',
      ...where.map((line) => `  ${line}`),
      ...(problems.length ? ['', ...problems.map((problem) => `Not loaded: ${problem}`)] : []),
    ].join('\n')
  );
}

/**
 * `/research [<pipeline>] <question>`: a research turn on the session's model. The
 * pipeline says how the question is split, how deep each line goes, and what is filtered;
 * the model plans, fans out to research agents in the background so each shows on the
 * board, cross-checks, and writes a report in which every claim cites its source.
 */
export const research: SlashCommand = {
  name: 'research',
  args: '[<pipeline>] <question> | pipelines',
  summary: 'Research a question with parallel research agents and write a cited report; pipelines lists how',
  source: 'built-in',
  run(ctx, args) {
    const text = args.trim();
    if (!text || text.toLowerCase() === 'pipelines') {
      if (!text) ctx.notice('info', 'Usage: /research <question>, or /research <pipeline> <question>. /research pipelines lists the pipelines.');
      return listPipelines(ctx);
    }
    if (ctx.running) return ctx.notice('warn', 'A turn is running; /research can run when it ends.');
    const { pipelines, problems } = loadPipelines(ctx.projectRoot);
    for (const problem of problems) ctx.notice('warn', `A research pipeline did not load: ${problem}`);
    const [first, ...rest] = text.split(/\s+/);
    const named = pipelines.find((pipeline) => pipeline.name === first.toLowerCase());
    const pipeline = named && rest.length ? named : pipelines.find((candidate) => candidate.name === 'default')!;
    const question = named && rest.length ? rest.join(' ') : text;
    ctx.notice('info', `Researching with pipeline ${pipeline.name}: ${pipeline.angles} line${pipeline.angles === 1 ? '' : 's'} of inquiry on agent ${pipeline.agent}, ${pipeline.depth} depth. The report goes under ${pipeline.output}.`);
    ctx.send(researchBrief(pipeline, question), { display: `/research ${text}`, label: '/research' });
  },
};
