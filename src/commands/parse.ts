import type { SlashCommand } from './types.js';

/** A command line split into its name and the rest. */
export function parseCommand(text: string): { name: string; args: string } | undefined {
  const match = /^\/(\S*)\s*([\s\S]*)$/.exec(text.trim());
  return match ? { name: match[1].toLowerCase(), args: match[2].trim() } : undefined;
}

/** Words as a shell would split them: quotes keep spaces, and backslashes escape. */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = undefined;
      else if (char === '\\' && quote === '"' && index + 1 < text.length) current += text[++index];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < text.length) {
      current += text[++index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) words.push(current);
  return words;
}

/** The commands a typed prefix could mean: names that start with it first, then names that contain it. */
export function matchCommands(commands: SlashCommand[], typed: string): SlashCommand[] {
  const wanted = typed.replace(/^\//, '').toLowerCase();
  const names = (command: SlashCommand) => [command.name, ...(command.aliases ?? [])];
  const starts = commands.filter((command) => names(command).some((name) => name.startsWith(wanted)));
  const contains = commands.filter((command) => !starts.includes(command) && names(command).some((name) => name.includes(wanted)));
  return [...starts, ...contains];
}

export function findCommand(commands: SlashCommand[], name: string): SlashCommand | undefined {
  return commands.find((command) => command.name === name || command.aliases?.includes(name));
}
