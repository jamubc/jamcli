import path from 'path';
import { expandCommand, loadCommands, type CustomCommand } from '../../core/ext/commands.js';
import { promptArguments, promptHint } from '../../core/mcp/prompts.js';
import type { McpPrompt } from '../../core/runtime/index.js';
import type { SlashCommand } from './commands.js';

/** A custom command as the palette lists it: its source shown, its prompt sent as a turn. */
export function slashCommandFor(command: CustomCommand): SlashCommand {
  return {
    name: command.name,
    ...(command.argumentHint ? { args: command.argumentHint } : {}),
    summary: command.description ?? `Send ${path.basename(command.file)}`,
    source: command.scope,
    run(ctx, args) {
      if (ctx.running) return ctx.notice('warn', `A turn is running; /${command.name} can run when it ends.`);
      ctx.send(expandCommand(command, args), {
        display: `/${command.name}${args ? ` ${args}` : ''}`,
        label: `/${command.name}`,
        ...(command.model ? { model: command.model } : {}),
        ...(command.allowedTools ? { allowedTools: command.allowedTools } : {}),
      });
    },
  };
}

/** An MCP server's prompt as `/server:name`: its arguments filled from what is typed, and sent as a turn. */
export function slashCommandForPrompt(prompt: McpPrompt): SlashCommand {
  const name = `${prompt.serverId}:${prompt.name}`.toLowerCase();
  return {
    name,
    ...(prompt.arguments.length ? { args: promptHint(prompt) } : {}),
    summary: prompt.description ?? `A prompt from MCP server ${prompt.serverId}`,
    source: 'mcp',
    async run(ctx, typed) {
      if (ctx.running) return ctx.notice('warn', `A turn is running; /${name} can run when it ends.`);
      const { args, missing } = promptArguments(prompt, typed);
      if (missing.length) return ctx.notice('warn', `/${name} needs ${missing.join(' and ')}: /${name} ${promptHint(prompt)}`);
      let text: string;
      try {
        text = await ctx.runtime.mcpPrompt(prompt.serverId, prompt.name, args);
      } catch (error: any) {
        return ctx.notice('error', `MCP server ${prompt.serverId} did not give its prompt: ${error?.message ?? error}`);
      }
      ctx.send(text, { display: `/${name}${typed ? ` ${typed}` : ''}`, label: `/${name}` });
    },
  };
}

/** The custom commands for a project, with the files that could not be read, each with why. */
export function customCommands(projectRoot: string, builtIn: SlashCommand[]): { commands: SlashCommand[]; problems: string[] } {
  const reserved = builtIn.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
  const loaded = loadCommands(projectRoot, reserved);
  return { commands: loaded.commands.map(slashCommandFor), problems: loaded.problems };
}
