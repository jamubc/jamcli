import { parse } from 'yaml';

export interface FrontMatter {
  /** The YAML block's keys, or nothing when there is none. */
  data: Record<string, unknown>;
  /** What follows the block. */
  body: string;
  /** Why the block could not be read; `data` is empty then. */
  error?: string;
}

const BLOCK = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

/** A Markdown file's YAML front matter, between `---` lines at its top, and its body. */
export function parseFrontMatter(text: string): FrontMatter {
  const match = BLOCK.exec(text);
  if (!match) return { data: {}, body: text.replace(/^﻿/, '') };
  const body = text.slice(match[0].length);
  try {
    const data = parse(match[1]) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) return { data: {}, body, error: 'the front matter is not a set of keys' };
    return { data: data as Record<string, unknown>, body };
  } catch (error: any) {
    return { data: {}, body, error: `the front matter is not valid YAML: ${String(error?.message ?? error).split('\n')[0]}` };
  }
}

/** A list written as YAML or as a string of names split by spaces or commas. */
export function listOf(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value).trim();
  if (!text) return [];
  // Commas split first, so a pattern with spaces, such as run_command(git log *), stays whole.
  const words: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (char === ',' || /\s/.test(char))) {
      if (current.trim()) words.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) words.push(current.trim());
  return words;
}

/** The tool names other agents use, as JamCLI names them, so shared skills and commands keep working. */
const FOREIGN_TOOLS: Record<string, string> = {
  Bash: 'run_command',
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'edit',
  MultiEdit: 'edit',
  Glob: 'glob',
  Grep: 'grep',
  LS: 'glob',
  Task: 'task',
  TodoWrite: 'todo_write',
  WebFetch: 'web_fetch',
};

/**
 * One `allowed-tools` entry as a JamCLI rule: `Bash(git:*)` becomes `run_command(git *)`,
 * and JamCLI's own names pass through.
 */
export function toolRuleText(entry: string): string {
  const match = /^([A-Za-z0-9_.*-]+)(?:\((.*)\))?$/s.exec(entry.trim());
  if (!match) return entry.trim();
  const tool = FOREIGN_TOOLS[match[1]] ?? match[1];
  if (match[2] === undefined) return tool;
  const pattern = match[2].trim().replace(/:\*$/, ' *');
  return `${tool}(${pattern})`;
}
