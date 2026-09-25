import path from 'path';
import { expandCommand, loadCommands, type CustomCommand } from '../../core/ext/commands.js';
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

/** The custom commands for a project, with the files that could not be read, each with why. */
export function customCommands(projectRoot: string, builtIn: SlashCommand[]): { commands: SlashCommand[]; problems: string[] } {
  const reserved = builtIn.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
  const loaded = loadCommands(projectRoot, reserved);
  return { commands: loaded.commands.map(slashCommandFor), problems: loaded.problems };
}
