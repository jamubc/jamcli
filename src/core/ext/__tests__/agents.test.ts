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
  expect(Object.keys(loaded.agents).sort()).toEqual(['explore', 'intelligent', 'quick', 'writing']);
  expect(loaded.defaultAgent).toBe('quick');
  expect(loaded.problems).toEqual([]);
  for (const agent of BUILTIN_AGENTS) {
    expect(agent.description).toBeTruthy();
    expect(agent.chain).toEqual([{ model: 'ollama:llama3' }]);
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
  expect(wrong.problems).toEqual(['delegation.default_agent names nobody, which is not an agent. The agents are explore, intelligent, quick, writing.']);
});

test('an unusable file is reported by path and reason and skipped, and the others load', () => {
  projectAgent('nodesc', '---\nmodels: ollama:a\n---\n');
  projectAgent('nomodels', '---\ndescription: x\n---\n');
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

test('the trust gate stays off for the built-in quick, and uses a configured one', () => {
  expect(trustModelRef({} as Config, loadAgents(root, {}).agents)).toBeUndefined();
  projectAgent('quick', '---\ndescription: mine\nmodels: ollama:tiny\n---\n');
  expect(trustModelRef({} as Config, loadAgents(root, {}).agents)).toBe('ollama:tiny');
  const categories = loadAgents(root, { categories: { quick: [{ model: 'ollama:cat' }] } }).agents;
  // The project file still wins over the category of the same name.
  expect(trustModelRef({} as Config, categories)).toBe('ollama:tiny');
  expect(trustModelRef({ trust: { enabled: false } } as Config, categories)).toBeUndefined();
  expect(trustModelRef({ trust: { model: 'openai:judge' } } as Config, categories)).toBe('openai:judge');
});

test('a source is described as a path, the categories configuration, or built-in', () => {
  expect(describeSource({ kind: 'file', path: '/p/.jamcli/agents/a.md', scope: 'project' }, (file) => file.replace('/p/', ''))).toBe('.jamcli/agents/a.md');
  expect(describeSource({ kind: 'categories' })).toBe('the categories configuration');
  expect(describeSource({ kind: 'builtin' })).toBe('built-in');
});
