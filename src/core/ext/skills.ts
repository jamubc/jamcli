import fs from 'fs';
import path from 'path';
import { userConfigDir } from '../../utils/paths.js';
import { listOf, parseFrontMatter, toolRuleText } from './frontmatter.js';
import { pluginSkillDirs } from '../plugins/load.js';

/**
 * Agent Skills (D16): a directory holding `SKILL.md`, whose front matter gives the
 * skill's `name` and `description`, with any files it bundles beside it. The system
 * prompt lists names and descriptions only; the `skill` tool returns the instructions
 * and the bundled files when the model asks for one.
 */

export type SkillScope = 'user' | 'project' | 'plugin';

export interface Skill {
  name: string;
  description: string;
  scope: SkillScope;
  /** The skill's directory. */
  dir: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** `allowed-tools` as JamCLI rules: what may run while the skill is active. */
  allowedTools?: string[];
}

export interface LoadedSkills {
  skills: Skill[];
  /** Skills of the same name as one found first, which it hides. */
  shadowed: Skill[];
  problems: string[];
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Where skills are found, the first shadowing the later: the project's, then the user's. */
export function skillDirs(projectRoot: string): { scope: SkillScope; dir: string }[] {
  return [
    { scope: 'project', dir: path.join(projectRoot, '.jamcli', 'skills') },
    { scope: 'project', dir: path.join(projectRoot, '.agents', 'skills') },
    { scope: 'user', dir: path.join(userConfigDir(), 'skills') },
    // Last, so a person's own skill of the same name wins.
    ...pluginSkillDirs(projectRoot).map((dir) => ({ scope: 'plugin' as const, dir })),
  ];
}

/** Why a name does not meet the specification, or nothing when it does. */
export function skillNameProblem(name: string, directory?: string): string | undefined {
  if (!name) return 'it has no name';
  if (name.length > 64) return 'its name is longer than 64 characters';
  if (!NAME.test(name)) return `its name "${name}" must be lowercase letters, digits, and single hyphens, not starting or ending with one`;
  if (directory !== undefined && name !== directory) return `its name "${name}" is not its directory's, "${directory}"`;
  return undefined;
}

/** Read one skill's `SKILL.md`, checked against the specification. */
export function readSkill(dir: string, scope: SkillScope): Skill | { problem: string } {
  const file = path.join(dir, 'SKILL.md');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error: any) {
    return { problem: `${file}: ${error?.code === 'ENOENT' ? 'there is no SKILL.md' : (error?.message ?? error)}` };
  }
  const { data, error } = parseFrontMatter(text);
  if (error) return { problem: `${file}: ${error}` };
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  const problem =
    skillNameProblem(name, path.basename(dir)) ??
    (!description ? 'it has no description' : description.length > 1024 ? 'its description is longer than 1024 characters' : undefined) ??
    (typeof data.compatibility === 'string' && data.compatibility.length > 500 ? 'its compatibility is longer than 500 characters' : undefined);
  if (problem) return { problem: `${file}: ${problem}.` };
  const metadata =
    data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
      ? Object.fromEntries(Object.entries(data.metadata as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : undefined;
  const allowed = listOf(data['allowed-tools']);
  return {
    name,
    description,
    scope,
    dir,
    ...(typeof data.license === 'string' ? { license: data.license } : {}),
    ...(typeof data.compatibility === 'string' ? { compatibility: data.compatibility } : {}),
    ...(metadata ? { metadata } : {}),
    ...(allowed ? { allowedTools: allowed.map(toolRuleText) } : {}),
  };
}

/** Every skill, a project's shadowing a user's of the same name. */
export function loadSkills(projectRoot: string): LoadedSkills {
  const found = new Map<string, Skill>();
  const shadowed: Skill[] = [];
  const problems: string[] = [];
  for (const { scope, dir } of skillDirs(projectRoot)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const read = readSkill(path.join(dir, entry.name), scope);
      if ('problem' in read) {
        problems.push(read.problem);
        continue;
      }
      if (found.has(read.name)) shadowed.push(read);
      else found.set(read.name, read);
    }
  }
  return { skills: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)), shadowed, problems };
}

/** A skill's instructions: `SKILL.md` without its front matter. */
export function skillInstructions(skill: Skill): string {
  return parseFrontMatter(fs.readFileSync(path.join(skill.dir, 'SKILL.md'), 'utf8')).body.trim();
}

/** The files a skill bundles, relative to its directory, `SKILL.md` and hidden files aside. */
export function skillFiles(skill: Skill, limit = 200): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || files.length >= limit) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || files.length >= limit) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile() && full !== path.join(skill.dir, 'SKILL.md')) files.push(path.relative(skill.dir, full).split(path.sep).join('/'));
    }
  };
  walk(skill.dir, 0);
  return files;
}

/** One bundled file, refused when the path leaves the skill's directory. */
export function readSkillFile(skill: Skill, file: string, maxBytes = 256 * 1024): string {
  const root = fs.realpathSync(skill.dir);
  const target = path.resolve(root, file);
  const real = fs.existsSync(target) ? fs.realpathSync(target) : target;
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error(`${file} is not inside the skill ${skill.name}.`);
  if (!fs.existsSync(real) || !fs.statSync(real).isFile()) throw new Error(`The skill ${skill.name} has no file ${file}.`);
  const size = fs.statSync(real).size;
  const bytes = fs.readFileSync(real).subarray(0, maxBytes);
  if (bytes.includes(0)) return `(${file} is a binary file of ${size} bytes.)`;
  return `${bytes.toString('utf8')}${size > maxBytes ? `\n[the rest of ${file}, ${size - maxBytes} bytes, is left out]` : ''}`;
}

/** The system prompt's list: each skill's name and description, and how to load one. */
export function skillsPromptText(skills: Pick<Skill, 'name' | 'description'>[]): string | undefined {
  if (!skills.length) return undefined;
  return [
    'Skills: instructions for particular kinds of task. When a task matches one, call the skill tool with its name to load the instructions before you start.',
    ...skills.map((skill) => `- ${skill.name}: ${skill.description}`),
  ].join('\n');
}
