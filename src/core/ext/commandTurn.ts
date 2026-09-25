import { expandCommand, loadCommands } from './commands.js';
import { promptArguments } from '../mcp/prompts.js';
import type { RunOptions, Runtime } from '../runtime/index.js';

/**
 * A prompt that names a custom command, as `/review src`, runs as the command's prompt with
 * its front matter's model and tools. Any other text, a path such as `/tmp` included, is
 * sent as written.
 */
export async function customCommandTurn(text: string, projectRoot: string, runtime: Runtime): Promise<{ prompt: string; turn: RunOptions }> {
  const match = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim());
  if (!match) return { prompt: text, turn: {} };
  const command = loadCommands(projectRoot).commands.find((entry) => entry.name === match[1].toLowerCase());
  if (!command) {
    // `/server:prompt` names an MCP server's prompt.
    const prompt = match[1].includes(':') ? (await runtime.mcpPrompts()).find((entry) => `${entry.serverId}:${entry.name}`.toLowerCase() === match[1].toLowerCase()) : undefined;
    if (!prompt) return { prompt: text, turn: {} };
    const { args, missing } = promptArguments(prompt, match[2]);
    if (missing.length) throw new Error(`/${match[1]} needs ${missing.join(' and ')}.`);
    return { prompt: await runtime.mcpPrompt(prompt.serverId, prompt.name, args), turn: { label: `/${match[1]}` } };
  }
  return {
    prompt: expandCommand(command, match[2]),
    turn: { label: `/${command.name}`, ...(command.model ? { model: command.model } : {}), ...(command.allowedTools ? { allowedTools: command.allowedTools } : {}) },
  };
}
