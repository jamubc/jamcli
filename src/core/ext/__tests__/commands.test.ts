import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { expandCommand, loadCommands } from '../commands.js';
import { listOf, parseFrontMatter, toolRuleText } from '../frontmatter.js';

let base: string;
let root: string;
let previous: string | undefined;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-commands-')));
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
const userFile = (name: string) => path.join(base, 'user', 'commands', name);
const projectFile = (name: string) => path.join(root, '.jamcli', 'commands', name);

test('a command file\'s front matter and body are read, and other agents\' tool names are translated', () => {
  write(
    projectFile('review.md'),
    ['---', 'description: Review a file', 'argument-hint: <file>', 'model: ollama:reviewer', 'allowed-tools: Read, Grep, Bash(git diff:*)', '---', 'Review @$1 for bugs.', ''].join('\n')
  );
  write(userFile('git/log.md'), 'Summarize the log since $ARGUMENTS.\n');
  const { commands, problems } = loadCommands(root);
  expect(problems).toEqual([]);
  expect(commands).toEqual([
    { name: 'git:log', scope: 'user', file: userFile('git/log.md'), body: 'Summarize the log since $ARGUMENTS.', description: 'Summarize the log since $ARGUMENTS.' },
    {
      name: 'review',
      scope: 'project',
      file: projectFile('review.md'),
      body: 'Review @$1 for bugs.',
      description: 'Review a file',
      argumentHint: '<file>',
      model: 'ollama:reviewer',
      allowedTools: ['read_file', 'grep', 'run_command(git diff *)'],
    },
  ]);
});

test('a project command shadows a user command, and a built-in keeps its name', () => {
  write(userFile('deploy.md'), 'user deploy\n');
  write(projectFile('deploy.md'), 'project deploy\n');
  write(projectFile('help.md'), 'not help\n');
  const { commands, shadowed, problems } = loadCommands(root, ['help']);
  expect(commands.map((command) => [command.name, command.scope, command.body])).toEqual([['deploy', 'project', 'project deploy']]);
  expect(shadowed.map((command) => [command.name, command.scope])).toEqual([
    ['deploy', 'user'],
    ['help', 'project'],
  ]);
  expect(problems).toEqual([`${projectFile('help.md')}: /help is a built-in command, which keeps its name; rename the file.`]);
});

test('files that cannot be commands are reported, and the rest still load', () => {
  write(projectFile('broken.md'), '---\ndescription: [unclosed\n---\nbody\n');
  write(projectFile('bad name.md'), 'body\n');
  write(projectFile('good.md'), 'fine\n');
  write(projectFile('notes.txt'), 'not markdown\n');
  const { commands, problems } = loadCommands(root);
  expect(commands.map((command) => command.name)).toEqual(['good']);
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain('"bad name" cannot name a command');
  expect(problems[1]).toContain('broken.md: the front matter is not valid YAML');
});

test('arguments are substituted as a whole and word by word, and never lost', () => {
  expect(expandCommand({ body: 'Fix $ARGUMENTS now.' }, 'the login bug')).toBe('Fix the login bug now.');
  expect(expandCommand({ body: 'Move $1 to $2; ignore $3.' }, '"a file.ts" b.ts')).toBe('Move a file.ts to b.ts; ignore .');
  expect(expandCommand({ body: 'Plain body.' }, 'extra words')).toBe('Plain body.\n\nextra words');
  expect(expandCommand({ body: 'Plain body.' }, '')).toBe('Plain body.');
  // $10 is not $1 followed by 0.
  expect(expandCommand({ body: 'cost $10' }, 'x')).toBe('cost $10\n\nx');
});

test('front matter and lists are read as YAML or as written words', () => {
  expect(parseFrontMatter('---\na: 1\n---\nbody')).toEqual({ data: { a: 1 }, body: 'body' });
  expect(parseFrontMatter('no block')).toEqual({ data: {}, body: 'no block' });
  expect(parseFrontMatter('---\n- a\n---\nbody').error).toBe('the front matter is not a set of keys');
  expect(listOf('Read Grep  run_command(git log *), edit')).toEqual(['Read', 'Grep', 'run_command(git log *)', 'edit']);
  expect(listOf(['a', 'b'])).toEqual(['a', 'b']);
  expect(listOf(undefined)).toBeUndefined();
  expect(toolRuleText('Bash(npm test:*)')).toBe('run_command(npm test *)');
  expect(toolRuleText('edit(src/**)')).toBe('edit(src/**)');
});
