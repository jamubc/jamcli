import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadSkills, readSkillFile, skillFiles, skillInstructions, skillNameProblem, skillsPromptText } from '../skills.js';

let base: string;
let root: string;
let previous: string | undefined;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jamcli-skills-')));
  root = path.join(base, 'project');
  previous = process.env.JAMCLI_CONFIG_DIR;
  process.env.JAMCLI_CONFIG_DIR = path.join(base, 'user');
});
afterEach(() => {
  if (previous === undefined) delete process.env.JAMCLI_CONFIG_DIR;
  else process.env.JAMCLI_CONFIG_DIR = previous;
  fs.rmSync(base, { recursive: true, force: true });
});

const write = (file: string, text: string | Buffer) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// The specification's minimal example.
const MINIMAL = [
  '---',
  'name: pdf-processing',
  'description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.',
  '---',
  '',
  '# PDF Processing',
  '',
  'Use pdfplumber to extract text. For form filling, see [the forms guide](references/FORMS.md).',
  '',
].join('\n');

// The specification's example with the optional fields.
const FULL = [
  '---',
  'name: data-analysis',
  'description: Analyze tabular data. Use when the user shares a CSV file.',
  'license: Apache-2.0',
  'compatibility: Requires git, docker, jq, and access to the internet',
  'metadata:',
  '  author: example-org',
  '  version: "1.0"',
  'allowed-tools: Bash(git:*) Bash(jq:*) Read',
  '---',
  'Load the file, then describe it.',
  '',
].join('\n');

test('the specification\'s examples load, with their optional fields and bundled files', () => {
  const pdf = path.join(root, '.agents', 'skills', 'pdf-processing');
  write(path.join(pdf, 'SKILL.md'), MINIMAL);
  write(path.join(pdf, 'scripts', 'extract.py'), 'print("text")\n');
  write(path.join(pdf, 'references', 'FORMS.md'), '# Forms\n');
  write(path.join(pdf, 'assets', 'template.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
  write(path.join(pdf, '.hidden'), 'not listed\n');
  write(path.join(base, 'user', 'skills', 'data-analysis', 'SKILL.md'), FULL);

  const { skills, problems } = loadSkills(root);
  expect(problems).toEqual([]);
  expect(skills).toEqual([
    {
      name: 'data-analysis',
      description: 'Analyze tabular data. Use when the user shares a CSV file.',
      scope: 'user',
      dir: path.join(base, 'user', 'skills', 'data-analysis'),
      license: 'Apache-2.0',
      compatibility: 'Requires git, docker, jq, and access to the internet',
      metadata: { author: 'example-org', version: '1.0' },
      allowedTools: ['run_command(git *)', 'run_command(jq *)', 'read_file'],
    },
    {
      name: 'pdf-processing',
      description:
        'Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF documents or when the user mentions PDFs, forms, or document extraction.',
      scope: 'project',
      dir: pdf,
    },
  ]);
  const [, processing] = skills;
  expect(skillInstructions(processing)).toBe('# PDF Processing\n\nUse pdfplumber to extract text. For form filling, see [the forms guide](references/FORMS.md).');
  expect(skillFiles(processing)).toEqual(['assets/template.pdf', 'references/FORMS.md', 'scripts/extract.py']);
  expect(readSkillFile(processing, 'references/FORMS.md')).toBe('# Forms\n');
  expect(readSkillFile(processing, 'assets/template.pdf')).toBe('(assets/template.pdf is a binary file of 6 bytes.)');

  // The prompt lists names and descriptions, never the instructions.
  const listed = skillsPromptText(skills)!;
  expect(listed).toContain('- pdf-processing: Extract text and tables from PDF files');
  expect(listed).not.toContain('pdfplumber');
  expect(skillsPromptText([])).toBeUndefined();
});

test('names the specification forbids are refused, as are skills without a description', () => {
  // The specification's invalid examples.
  expect(skillNameProblem('PDF-Processing')).toContain('lowercase');
  expect(skillNameProblem('-pdf')).toContain('starting or ending');
  expect(skillNameProblem('pdf--processing')).toContain('single hyphens');
  expect(skillNameProblem('x'.repeat(65))).toContain('longer than 64');
  expect(skillNameProblem('pdf-processing', 'pdf')).toContain('not its directory\'s');
  expect(skillNameProblem('pdf-processing', 'pdf-processing')).toBeUndefined();

  const dir = path.join(root, '.jamcli', 'skills');
  write(path.join(dir, 'Upper', 'SKILL.md'), '---\nname: Upper\ndescription: x\n---\n');
  write(path.join(dir, 'no-description', 'SKILL.md'), '---\nname: no-description\n---\nbody\n');
  write(path.join(dir, 'moved', 'SKILL.md'), '---\nname: elsewhere\ndescription: x\n---\n');
  write(path.join(dir, 'empty', 'README.md'), 'no SKILL.md here\n');
  write(path.join(dir, 'fine', 'SKILL.md'), '---\nname: fine\ndescription: works\n---\n');
  const { skills, problems } = loadSkills(root);
  expect(skills.map((skill) => skill.name)).toEqual(['fine']);
  expect(problems).toHaveLength(4);
  expect(problems.join('\n')).toContain('empty/SKILL.md: there is no SKILL.md');
  expect(problems.join('\n')).toContain('no-description/SKILL.md: it has no description.');
});

test('a project skill shadows a user skill of the same name, and .jamcli comes before .agents', () => {
  write(path.join(base, 'user', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: the user\'s\n---\n');
  write(path.join(root, '.agents', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: the shared one\n---\n');
  write(path.join(root, '.jamcli', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: this project\'s own\n---\n');
  const { skills, shadowed } = loadSkills(root);
  expect(skills.map((skill) => skill.description)).toEqual(['this project\'s own']);
  expect(shadowed.map((skill) => skill.description)).toEqual(['the shared one', 'the user\'s']);
});

test('a bundled file is read only from inside its skill', () => {
  const dir = path.join(root, '.agents', 'skills', 'safe');
  write(path.join(dir, 'SKILL.md'), '---\nname: safe\ndescription: x\n---\n');
  write(path.join(root, 'secret.txt'), 'secret\n');
  fs.symlinkSync(path.join(root, 'secret.txt'), path.join(dir, 'link.txt'));
  const [skill] = loadSkills(root).skills;
  expect(() => readSkillFile(skill, '../../../secret.txt')).toThrow('is not inside the skill safe');
  expect(() => readSkillFile(skill, 'link.txt')).toThrow('is not inside the skill safe');
  expect(() => readSkillFile(skill, 'missing.md')).toThrow('has no file missing.md');
});
