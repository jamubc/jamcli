import fs from 'fs';
import path from 'path';
import { userConfigDir } from '../../utils/paths.js';
import { listOf, parseFrontMatter, toolRuleText } from './frontmatter.js';

/**
 * Custom commands (D16): Markdown files in `~/.config/jamcli/commands/` and
 * `.jamcli/commands/`. `review.md` becomes `/review`, and `git/log.md` becomes
 * `/git:log`. A project command shadows a user command of the same name.
 */

export type CommandScope = 'user' | 'project';

export interface CustomCommand {
  /** Without the slash: `review`, or `git:log` for a file in a subdirectory. */
  name: string;
  scope: CommandScope;
  file: string;
  description?: string;
  argumentHint?: string;
  /** Run this command's turn on this model. */
  model?: string;
  /** Narrow the tools while the command's turn runs, as JamCLI rules. */
  allowedTools?: string[];
  body: string;
}

export interface LoadedCommands {
  commands: CustomCommand[];
  /** Commands another of the same name hides, such as a user command a project one shadows. */
  shadowed: CustomCommand[];
  /** Files that could not be read as commands, each with why. */
  problems: string[];
}

const NAME = /^[a-z0-9][a-z0-9_.-]*$/;

export function commandDirs(projectRoot: string): { scope: CommandScope; dir: string }[] {
  return [
    { scope: 'user', dir: path.join(userConfigDir(), 'commands') },
    { scope: 'project', dir: path.join(projectRoot, '.jamcli', 'commands') },
  ];
}

function markdownFiles(dir: string, prefix: string[] = [], depth = 0): { file: string; parts: string[] }[] {
  if (depth > 4 || !fs.existsSync(dir)) return [];
  const found: { file: string; parts: string[] }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full, [...prefix, entry.name], depth + 1));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push({ file: full, parts: [...prefix, entry.name.slice(0, -3)] });
  }
  return found;
}

/** Read one command file. */
export function readCommand(file: string, parts: string[], scope: CommandScope): CustomCommand | { problem: string } {
  const name = parts.map((part) => part.toLowerCase()).join(':');
  if (!parts.every((part) => NAME.test(part.toLowerCase()))) return { problem: `${file}: "${name}" cannot name a command; use letters, digits, dots, dashes, and underscores.` };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error: any) {
    return { problem: `${file}: ${error?.message ?? error}` };
  }
  const { data, body, error } = parseFrontMatter(text);
  if (error) return { problem: `${file}: ${error}` };
  const field = (key: string) => (typeof data[key] === 'string' && (data[key] as string).trim() ? (data[key] as string).trim() : undefined);
  const allowed = listOf(data['allowed-tools']);
  const description = field('description') ?? body.trim().split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 80);
  return {
    name,
    scope,
    file,
    body: body.trim(),
    ...(description ? { description } : {}),
    ...(field('argument-hint') ? { argumentHint: field('argument-hint') } : {}),
    ...(field('model') ? { model: field('model') } : {}),
    ...(allowed ? { allowedTools: allowed.map(toolRuleText) } : {}),
  };
}

/** Every custom command, with project commands shadowing user commands of the same name. */
export function loadCommands(projectRoot: string, reserved: string[] = []): LoadedCommands {
  const byName = new Map<string, CustomCommand>();
  const shadowed: CustomCommand[] = [];
  const problems: string[] = [];
  for (const { scope, dir } of commandDirs(projectRoot)) {
    for (const { file, parts } of markdownFiles(dir)) {
      const read = readCommand(file, parts, scope);
      if ('problem' in read) {
        problems.push(read.problem);
        continue;
      }
      const earlier = byName.get(read.name);
      if (earlier) shadowed.push(earlier);
      byName.set(read.name, read);
    }
  }
  const commands: CustomCommand[] = [];
  for (const command of byName.values()) {
    if (reserved.includes(command.name)) {
      shadowed.push(command);
      problems.push(`${command.file}: /${command.name} is a built-in command, which keeps its name; rename the file.`);
    } else commands.push(command);
  }
  return { commands: commands.sort((a, b) => a.name.localeCompare(b.name)), shadowed, problems };
}

/**
 * The prompt a command sends: its body with `$ARGUMENTS` as everything typed after the
 * name and `$1` to `$9` as each word. A body that uses neither gets the arguments after
 * it, so nothing typed is lost. `@` references are expanded when the prompt is sent.
 */
export function expandCommand(command: Pick<CustomCommand, 'body'>, args: string): string {
  const words = splitArguments(args);
  let used = false;
  const expanded = command.body
    .replace(/\$ARGUMENTS\b/g, () => {
      used = true;
      return args;
    })
    .replace(/\$([1-9])(?![0-9])/g, (_, digit: string) => {
      used = true;
      return words[Number(digit) - 1] ?? '';
    });
  return !used && args.trim() ? `${expanded}\n\n${args.trim()}` : expanded;
}

/** Arguments as words; quotes keep spaces together. */
function splitArguments(text: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) words.push(match[1] ?? match[2] ?? match[3]);
  return words;
}
