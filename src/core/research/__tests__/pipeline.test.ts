import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_PIPELINE, loadPipelines, readPipeline, reportPathFor, researchBrief, slugOf } from '../pipeline.js';

let root: string;
const shared = process.env.JAMCLI_CONFIG_DIR;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-research-'));
  process.env.JAMCLI_CONFIG_DIR = path.join(root, 'user');
  fs.mkdirSync(process.env.JAMCLI_CONFIG_DIR);
});
afterEach(() => {
  process.env.JAMCLI_CONFIG_DIR = shared;
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (dir: string, name: string, text: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), text);
};

test('the built-in default is always there, and a project pipeline of the same name replaces it', () => {
  expect(loadPipelines(root).pipelines.map((pipeline) => pipeline.name)).toEqual(['default']);
  write(path.join(root, '.jamcli', 'research', 'pipelines'), 'default', '---\nangles: 2\ndepth: deep\n---\nCite standards first.');
  write(path.join(process.env.JAMCLI_CONFIG_DIR!, 'research', 'pipelines'), 'news', '---\ndescription: What happened this week\nfreshness: oneWeek\nexclude: [example.com, spam.test]\n---\n');
  const { pipelines, problems } = loadPipelines(root);
  expect(problems).toEqual([]);
  expect(pipelines.map((pipeline) => [pipeline.name, pipeline.source])).toEqual([
    ['default', 'project'],
    ['news', 'user'],
  ]);
  expect(pipelines[0]).toMatchObject({ angles: 2, depth: 'deep', instructions: 'Cite standards first.', freshness: 'noLimit' });
  expect(pipelines[1]).toMatchObject({ description: 'What happened this week', freshness: 'oneWeek', exclude: ['example.com', 'spam.test'], angles: 4 });
});

test('a pipeline with a value out of range is reported and left out', () => {
  const dir = path.join(root, '.jamcli', 'research', 'pipelines');
  write(dir, 'wide', '---\nangles: 40\ndepth: bottomless\n---\n');
  const read = readPipeline(path.join(dir, 'wide.md'), 'project');
  expect(read).toMatchObject({ problem: expect.stringContaining('angles must be a whole number from 1 to 8; depth must be one of quick, standard, deep') });
  expect(loadPipelines(root).problems).toHaveLength(1);
});

test('the brief carries the steps, the filters, the depth, the report path, and the body', () => {
  const brief = researchBrief(
    { ...DEFAULT_PIPELINE, name: 'news', angles: 3, depth: 'deep', freshness: 'oneWeek', include: ['docs.example.org'], exclude: ['spam.test'], instructions: 'Write in plain words.' },
    'What changed in Bun 1.4?',
    new Date('2026-09-28T12:00:00Z')
  );
  expect(brief).toContain('Research this question and write a cited report: What changed in Bun 1.4?');
  expect(brief).toContain('3 independent lines of inquiry');
  expect(brief).toContain('background: true on agent "research"');
  expect(brief).toContain('at least 6 distinct sources in full with web_fetch');
  // Children are told apart on the board, only search and read, and the parent holds its turn until they end.
  expect(brief).toContain('Start each child\'s prompt with a short title for its line');
  expect(brief).toContain('must not start tasks of its own, run shell commands, or write files');
  expect(brief).toContain('call task_result with wait_seconds 600 for every child');
  expect(brief).toContain('Pass freshness "oneWeek" to every web_search.');
  expect(brief).toContain('site: terms, and prefer them as sources: docs.example.org.');
  expect(brief).toContain('Never cite these domains, and drop their results: spam.test.');
  expect(brief).toContain('write_file to .jamcli/research/reports/2026-09-28-what-changed-in-bun-1-4.md');
  expect(brief).toContain('run one more round of tasks for the gaps');
  expect(brief).toContain('From the pipeline:\nWrite in plain words.');
  expect(researchBrief(DEFAULT_PIPELINE, 'x')).toContain('Name gaps rather than filling them with guesses.');
});

test('a report is named by the day and the first words of the question', () => {
  expect(slugOf('  How does Bun.spawn handle a pty?? ')).toBe('how-does-bun-spawn-handle-a-pty');
  expect(slugOf('!!!')).toBe('research');
  expect(reportPathFor({ ...DEFAULT_PIPELINE, output: 'docs/research' }, 'Why is the sky blue', new Date('2026-01-02T00:00:00Z'))).toBe('docs/research/2026-01-02-why-is-the-sky-blue.md');
});
