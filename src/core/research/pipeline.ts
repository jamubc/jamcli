import fs from 'fs';
import path from 'path';
import { listOf, parseFrontMatter } from '../ext/frontmatter.js';
import { FRESHNESS_VALUES, type Freshness } from '../tools/web/providers.js';
import { userConfigDir } from '../../utils/paths.js';

/**
 * A research pipeline: how `/research` turns a question into a cited report. It is a
 * Markdown file with front matter, in `.jamcli/research/pipelines/` for a project or
 * `~/.config/jamcli/research/pipelines/` for a person, and the built-in `default` when
 * neither has one by that name. The front matter says how wide and how deep to look and
 * what to filter; the body is added to the brief, for the shape of the report or anything
 * else the person wants every run to do.
 */
export interface ResearchPipeline {
  name: string;
  description: string;
  /** How many independent lines of inquiry the question is split into. */
  angles: number;
  /** How many sources each line reads in full, and whether gaps get a second round. */
  depth: 'quick' | 'standard' | 'deep';
  /** How recent the sources must be. */
  freshness: Freshness;
  /** Domains to search first, as `site:` terms. */
  include: string[];
  /** Domains never to cite. */
  exclude: string[];
  /** The agent each line of inquiry runs on. */
  agent: string;
  /** Where the report is written, relative to the project. */
  output: string;
  /** What the file's body adds to the brief. */
  instructions: string;
  /** Where it came from. */
  source: 'built-in' | 'user' | 'project';
  file?: string;
}

export const DEPTHS = ['quick', 'standard', 'deep'] as const;

export const DEFAULT_PIPELINE: ResearchPipeline = {
  name: 'default',
  description: 'Four lines of inquiry in parallel, the best sources read in full, one cited report.',
  angles: 4,
  depth: 'standard',
  freshness: 'noLimit',
  include: [],
  exclude: [],
  agent: 'research',
  output: '.jamcli/research/reports',
  instructions: '',
  source: 'built-in',
};

const NAME = /^[a-z0-9][a-z0-9_.-]*$/;

export const pipelineDirs = (projectRoot: string): { source: 'user' | 'project'; dir: string }[] => [
  { source: 'user', dir: path.join(userConfigDir(), 'research', 'pipelines') },
  { source: 'project', dir: path.join(projectRoot, '.jamcli', 'research', 'pipelines') },
];

/** Read one pipeline file over the defaults. */
export function readPipeline(file: string, source: 'user' | 'project'): ResearchPipeline | { problem: string } {
  const name = path.basename(file, '.md').toLowerCase();
  if (!NAME.test(name)) return { problem: `${file}: "${name}" cannot name a pipeline; use letters, digits, dots, dashes, and underscores.` };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error: any) {
    return { problem: `${file}: ${error?.message ?? error}` };
  }
  const { data, body, error } = parseFrontMatter(text);
  if (error) return { problem: `${file}: ${error}` };
  const problems: string[] = [];
  const number = (key: string, fallback: number, min: number, max: number) => {
    if (data[key] === undefined) return fallback;
    const value = Number(data[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${key} must be a whole number from ${min} to ${max}`);
      return fallback;
    }
    return value;
  };
  const word = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    if (data[key] === undefined) return fallback;
    const value = String(data[key]).trim() as T;
    if (!allowed.includes(value)) {
      problems.push(`${key} must be one of ${allowed.join(', ')}`);
      return fallback;
    }
    return value;
  };
  const string = (key: string, fallback: string) => (typeof data[key] === 'string' && (data[key] as string).trim() ? (data[key] as string).trim() : fallback);
  const pipeline: ResearchPipeline = {
    name,
    description: string('description', body.trim().split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 100) || DEFAULT_PIPELINE.description),
    angles: number('angles', DEFAULT_PIPELINE.angles, 1, 8),
    depth: word('depth', DEPTHS, DEFAULT_PIPELINE.depth),
    freshness: word('freshness', FRESHNESS_VALUES, DEFAULT_PIPELINE.freshness),
    include: listOf(data.include) ?? [],
    exclude: listOf(data.exclude) ?? [],
    agent: string('agent', DEFAULT_PIPELINE.agent),
    output: string('output', DEFAULT_PIPELINE.output),
    instructions: body.trim(),
    source,
    file,
  };
  if (problems.length) return { problem: `${file}: ${problems.join('; ')}.` };
  return pipeline;
}

/** Every pipeline: the built-in default, then the person's, then the project's, a later one replacing an earlier one of the same name. */
export function loadPipelines(projectRoot: string): { pipelines: ResearchPipeline[]; problems: string[] } {
  const byName = new Map<string, ResearchPipeline>([[DEFAULT_PIPELINE.name, DEFAULT_PIPELINE]]);
  const problems: string[] = [];
  for (const { source, dir } of pipelineDirs(projectRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.toLowerCase().endsWith('.md')) continue;
      const read = readPipeline(path.join(dir, entry), source);
      if ('problem' in read) problems.push(read.problem);
      else byName.set(read.name, read);
    }
  }
  return { pipelines: [...byName.values()], problems };
}

const SOURCES_PER_ANGLE: Record<ResearchPipeline['depth'], number> = { quick: 2, standard: 4, deep: 6 };

/** A file name from the question: its first words, lowercased, joined by dashes. */
export const slugOf = (question: string): string =>
  question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 8)
    .join('-') || 'research';

/** Where a run's report goes, relative to the project. */
export const reportPathFor = (pipeline: ResearchPipeline, question: string, now = new Date()): string =>
  path.posix.join(pipeline.output.replace(/\\/g, '/'), `${now.toISOString().slice(0, 10)}-${slugOf(question)}.md`);

/**
 * The brief `/research` sends as a turn: the pipeline as steps the session model carries
 * out, with the filters spelled into each child's brief. It follows what deep-research
 * agents share: plan the lines of inquiry, run them in parallel, read sources in full
 * rather than trusting snippets, cross-check, and write nothing without a citation.
 */
export function researchBrief(pipeline: ResearchPipeline, question: string, now = new Date()): string {
  const report = reportPathFor(pipeline, question, now);
  const sources = SOURCES_PER_ANGLE[pipeline.depth];
  const filters = [
    pipeline.freshness !== 'noLimit' ? `Pass freshness "${pipeline.freshness}" to every web_search.` : 'Pass a freshness to web_search when the answer changes over time.',
    pipeline.include.length ? `Search these domains first, with site: terms, and prefer them as sources: ${pipeline.include.join(', ')}.` : '',
    pipeline.exclude.length ? `Never cite these domains, and drop their results: ${pipeline.exclude.join(', ')}.` : '',
  ].filter(Boolean);
  const angles = pipeline.angles === 1 ? 'one line of inquiry' : `${pipeline.angles} independent lines of inquiry`;
  return [
    `Research this question and write a cited report: ${question}`,
    '',
    `Pipeline "${pipeline.name}"${pipeline.description ? `: ${pipeline.description}` : ''}`,
    '',
    'Steps:',
    `1. Plan. Split the question into ${angles}, each answerable on its own, together covering the whole question. Give each two or three search queries. Post the plan with todo_write, one item per line of inquiry plus one for the report, so the person can follow it.`,
    `2. Fan out. In one step, start one task per line of inquiry with background: true on agent "${pipeline.agent}". Start each child's prompt with a short title for its line, such as "Line 2, harness papers:", because the board shows the first words of it and five children that open alike cannot be told apart. Brief each child fully: the question as a whole, its own line of inquiry, its queries, the filters below, and that it must read at least ${sources} distinct sources with web_fetch rather than trust search snippets, passing a prompt that names what it wants from each page so a long page comes back as the parts that matter, and fetching again without a prompt only when it needs the whole page. After each source it reads, a child writes one line of what that source showed and its URL, so that whatever happens to it, its parent has those lines. A child only searches, fetches, reads, and reports: it must not start tasks of its own, run shell commands, or write files, and when a page will not fetch it says so and tries another source. Its report must have, for every finding: the claim, the URL, the source's date or "undated", and a short quote where wording matters; then what sources disagree on; then what it could not find. Mark each todo in progress as its child starts.`,
    '3. Collect. A turn that ends while children run does not resume by itself, so do not end yours. In one step, call task_result with wait_seconds 600 for every child: the calls run together and your turn holds until they end. Mark each todo done as its result arrives, and call again for any child still running.',
    `4. Cross-check. Where children disagree, prefer primary sources, newer sources, and sources that show their evidence; say which you preferred and why. ${pipeline.depth === 'deep' ? 'Where a material gap remains, run one more round of tasks for the gaps, then stop.' : 'Name gaps rather than filling them with guesses.'}`,
    `5. Write the report with write_file to ${report} (make the directory if it is missing). Its sections, in order: Summary (at most five bullets, each a finding with its citation), Findings (one heading per line of inquiry, claims with [n] citations), Disagreements and open questions, Sources (numbered [n]: title, URL, date, and what it supported). Every claim in the report cites a source; drop any that has none. Then read the report back once with read_file, and fix every [n] that has no entry under Sources and every claim left without a citation.`,
    '6. Tell the person: the path of the report, the Summary bullets, and what remains uncertain. Keep it to what matters, and state nothing more firmly than the report does: a claim the report marks as third-party, undated, or unchecked keeps that mark here.',
    '',
    'Filters:',
    ...filters.map((line) => `- ${line}`),
    ...(pipeline.instructions ? ['', 'From the pipeline:', pipeline.instructions] : []),
  ].join('\n');
}
