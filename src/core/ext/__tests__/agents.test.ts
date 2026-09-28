import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BUILTIN_AGENTS, describeSource, loadAgents, routableAgents } from '../agents.js';
import { trustModelRef } from '../../runtime/model.js';
import type { Config } from '../../../types/config.js';

let base: string;
let root: string;
let previous: string | undefined;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-agents-')));
  root = path.join(base, 'project');
  previous = process.env.JAMCLI_CONFIG_DIR;
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
});
afterEach(() => {
  if (previous === undefined) delete process.env.JAMCLI_CONFIG_DIR;
  else process.env.JAMCLI_CONFIG_DIR = previous;
  fs.rmSync(base, { recursive: true, force: true });
});

const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const projectAgent = (name: string, text: string) => write(path.join(root, '.jamcli', 'agents', `${name}.md`), text);
const userAgent = (name: string, text: string) => write(path.join(base, 'user', 'agents', `${name}.md`), text);

const WRITING = [
  '---',
  'description: Prose for the person.',
  'models:',
  '  - openrouter:anthropic/claude-haiku-4.5',
  '  - model: ollama:llama3',
  '    reasoning: off',
  '---',
  'No em dashes.',
  '',
].join('\n');

test('with nothing configured, the four built-ins are the agents and quick is the default', () => {
  const loaded = loadAgents(root, {});
  expect(Object.keys(loaded.agents).sort()).toEqual(['explore', 'intelligent', 'quick', 'research', 'writing']);
  expect(loaded.defaultAgent).toBe('quick');
  expect(loaded.problems).toEqual([]);
  // They name no provider: each runs on whatever model the session uses.
  for (const agent of BUILTIN_AGENTS) {
    expect(agent.description).toBeTruthy();
    expect(agent).toMatchObject({ chain: [], inherits: true });
  }
});

test('an agent file gives a description, a chain with reasoning, and its body as rules', () => {
  projectAgent('writing', WRITING);
  const { agents } = loadAgents(root, {});
  expect(agents.writing).toMatchObject({
    name: 'writing',
    description: 'Prose for the person.',
    chain: [{ model: 'openrouter:anthropic/claude-haiku-4.5' }, { model: 'ollama:llama3', reasoning: 'off' }],
    rules: 'No em dashes.',
    source: { kind: 'file', scope: 'project' },
  });
  // The other built-ins are still there.
  expect(agents.quick.source.kind).toBe('builtin');
});

test("a project's file wins over the user's of the same name", () => {
  userAgent('explore', '---\ndescription: user version\nmodels: ollama:a\n---\n');
  projectAgent('explore', '---\ndescription: project version\nmodels: ollama:b\n---\n');
  userAgent('review', '---\ndescription: only the user has it\nmodels: [ollama:c]\n---\n');
  const { agents } = loadAgents(root, {});
  expect(agents.explore.description).toBe('project version');
  expect(agents.explore.chain).toEqual([{ model: 'ollama:b' }]);
  expect(agents.review.source).toMatchObject({ kind: 'file', scope: 'user' });
});

test('configured categories load as agents without description or rules, and replace the built-ins', () => {
  const loaded = loadAgents(root, { categories: { fast: [{ model: 'openai:mini' }] } });
  expect(Object.keys(loaded.agents)).toEqual(['fast']);
  expect(loaded.agents.fast).toEqual({ name: 'fast', chain: [{ model: 'openai:mini' }], source: { kind: 'categories' } });
  // Categories never named a default, so none is assumed.
  expect(loaded.defaultAgent).toBeUndefined();
});

test('delegation.default_agent names the default, and one that names no agent is reported', () => {
  expect(loadAgents(root, { delegation: { default_agent: 'writing' } as Config['delegation'] }).defaultAgent).toBe('writing');
  const wrong = loadAgents(root, { delegation: { default_agent: 'nobody' } as Config['delegation'] });
  expect(wrong.defaultAgent).toBeUndefined();
  expect(wrong.problems).toEqual(['delegation.default_agent names nobody, which is not an agent. The agents are explore, intelligent, quick, research, writing.']);
});

test('an unusable file is reported by path and reason and skipped, and the others load', () => {
  projectAgent('nodesc', '---\nmodels: ollama:a\n---\n');
  projectAgent('nomodels', '---\ndescription: x\nmodels: []\n---\n');
  projectAgent('badreason', '---\ndescription: x\nmodels:\n  - model: ollama:a\n    reasoning: max\n---\n');
  projectAgent('Bad_Name', '---\ndescription: x\nmodels: ollama:a\n---\n');
  projectAgent('broken', '---\ndescription: [unclosed\n---\n');
  projectAgent('good', '---\ndescription: fine\nmodels: ollama:a\n---\n');
  const { agents, problems } = loadAgents(root, {});
  const dir = path.join(root, '.jamcli', 'agents');
  expect(agents.good).toBeDefined();
  for (const name of ['nodesc', 'nomodels', 'badreason', 'Bad_Name', 'broken']) expect(agents[name]).toBeUndefined();
  expect(problems).toContain(`${path.join(dir, 'nodesc.md')}: it has no description.`);
  expect(problems).toContain(`${path.join(dir, 'nomodels.md')}: it names no models.`);
  expect(problems).toContain(`${path.join(dir, 'badreason.md')}: the reasoning of ollama:a is not off, on, or auto.`);
  expect(problems.some((problem) => problem.startsWith(path.join(dir, 'Bad_Name.md')) && problem.includes('lowercase'))).toBe(true);
  expect(problems.some((problem) => problem.startsWith(path.join(dir, 'broken.md')) && problem.includes('not valid YAML'))).toBe(true);
});

test('a key from a later version is reported by name and the agent still loads', () => {
  projectAgent('writing', '---\ndescription: x\nmodels: ollama:a\noutput: [no-em-dash]\n---\n');
  const { agents, problems } = loadAgents(root, {});
  expect(agents.writing.description).toBe('x');
  expect(problems).toEqual([`${path.join(root, '.jamcli', 'agents', 'writing.md')}: output is not a key this version knows, so it is ignored.`]);
});

test('only agents with a model on a configured provider are routable, with no network', () => {
  projectAgent('cloud', '---\ndescription: needs a key\nmodels: openrouter:some/model\n---\n');
  projectAgent('mixed', '---\ndescription: cloud then local\nmodels: [openrouter:some/model, ollama:a]\n---\n');
  const { agents } = loadAgents(root, {});
  const names = routableAgents(agents, {}).map((agent) => agent.name);
  expect(names).toContain('mixed');
  expect(names).not.toContain('cloud');
  expect(names).toContain('quick');
  expect(routableAgents(agents, { openrouter: { api_key: 'sk-or-test' } }).map((agent) => agent.name)).toContain('cloud');
});

test('the trust gate runs only on the classifier the user names, never on an agent', () => {
  expect(trustModelRef({} as Config)).toBeUndefined();
  // A quick agent with its own model does not become the classifier by accident.
  projectAgent('quick', '---\ndescription: mine\nmodels: ollama:tiny\n---\n');
  expect(trustModelRef({} as Config)).toBeUndefined();
  expect(trustModelRef({ trust: { model: 'openai:judge' } } as Config)).toBe('openai:judge');
  expect(trustModelRef({ trust: { model: 'openrouter:meta-llama/llama-guard-4-12b' } } as Config)).toBe('openrouter:meta-llama/llama-guard-4-12b');
  expect(trustModelRef({ trust: { model: '  ' } } as Config)).toBeUndefined();
  expect(trustModelRef({ trust: { enabled: false, model: 'openai:judge' } } as Config)).toBeUndefined();
});

test('a source is described as a path, the categories configuration, or built-in', () => {
  expect(describeSource({ kind: 'file', path: '/p/.jamcli/agents/a.md', scope: 'project' }, (file) => file.replace('/p/', ''))).toBe('.jamcli/agents/a.md');
  expect(describeSource({ kind: 'categories' })).toBe('the categories configuration');
  expect(describeSource({ kind: 'builtin' })).toBe('built-in');
});

test('an agent file can name one model and an effort, which each entry without its own takes', () => {
  projectAgent('deep', '---\ndescription: hard problems\nmodel: openai:big\neffort: xhigh\n---\n');
  projectAgent('mixed', '---\ndescription: two models\neffort: low\nmodels:\n  - openai:a\n  - model: openai:b\n    effort: max\n---\n');
  const { agents, problems } = loadAgents(root, {});
  expect(problems).toEqual([]);
  expect(agents.deep.chain).toEqual([{ model: 'openai:big', effort: 'xhigh' }]);
  expect(agents.mixed.chain).toEqual([{ model: 'openai:a', effort: 'low' }, { model: 'openai:b', effort: 'max' }]);
});

test('an agent file with no model runs on the session model at its own effort', () => {
  projectAgent('careful', '---\ndescription: think hard on my model\neffort: high\n---\nCheck twice.\n');
  const { agents } = loadAgents(root, {});
  expect(agents.careful).toMatchObject({ chain: [], inherits: true, effort: 'high', rules: 'Check twice.' });
  expect(routableAgents(agents, {}).map((agent) => agent.name)).toContain('careful');
});

test('an effort that is not a level, or both model and models, is reported and the file skipped', () => {
  projectAgent('badeffort', '---\ndescription: x\nmodel: openai:a\neffort: extreme\n---\n');
  projectAgent('both', '---\ndescription: x\nmodel: openai:a\nmodels: [openai:b]\n---\n');
  const { agents, problems } = loadAgents(root, {});
  const dir = path.join(root, '.jamcli', 'agents');
  expect(agents.badeffort).toBeUndefined();
  expect(agents.both).toBeUndefined();
  expect(problems).toContain(`${path.join(dir, 'badeffort.md')}: its effort is not one of low, medium, high, xhigh, max.`);
  expect(problems).toContain(`${path.join(dir, 'both.md')}: it names both model and models; use one.`);
});
