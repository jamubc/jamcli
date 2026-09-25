import type { McpPrompt } from '../runtime/index.js';

/**
 * What a person types after `/server:prompt` as the prompt's arguments: `name=value` pairs
 * name an argument, and bare words fill the declared ones in order. Quotes keep spaces.
 */
export function promptArguments(prompt: Pick<McpPrompt, 'arguments'>, text: string): { args: Record<string, string>; missing: string[] } {
  const words: string[] = [];
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) words.push(match[1] ?? match[2] ?? match[3]);
  const args: Record<string, string> = {};
  const positional: string[] = [];
  const declared = new Set(prompt.arguments.map((argument) => argument.name));
  for (const word of words) {
    const named = /^([A-Za-z_][\w.-]*)=([\s\S]*)$/.exec(word);
    if (named && declared.has(named[1])) args[named[1]] = named[2];
    else positional.push(word);
  }
  const open = prompt.arguments.filter((argument) => !(argument.name in args));
  open.forEach((argument, index) => {
    if (index < positional.length) args[argument.name] = index === open.length - 1 ? positional.slice(index).join(' ') : positional[index];
  });
  const missing = prompt.arguments.filter((argument) => argument.required && !(argument.name in args)).map((argument) => argument.name);
  return { args, missing };
}

/** How the palette writes a prompt's arguments: required ones in angle brackets. */
export const promptHint = (prompt: Pick<McpPrompt, 'arguments'>) => prompt.arguments.map((argument) => (argument.required ? `<${argument.name}>` : `[${argument.name}]`)).join(' ');
