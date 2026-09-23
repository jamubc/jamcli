import { sessionCommands } from './slash-commands/sessionCommands.js';
import { toolCommands } from './slash-commands/toolCommands.js';
import { chatCommands } from './slash-commands/chatCommands.js';
import type { CommandDeps, CommandHandler } from './slash-commands/types.js';

export type { CommandDeps } from './slash-commands/types.js';

const COMMANDS: Record<string, CommandHandler> = {
  ...sessionCommands,
  ...toolCommands,
  ...chatCommands,
};

export function useSlashCommands(deps: CommandDeps) {
  const handleCommand = async (text: string): Promise<boolean> => {
    if (!text.startsWith('/')) return false;

    const [cmd, ...args] = text.trim().split(/\s+/);
    const command = cmd.toLowerCase();

    const handler = COMMANDS[command];
    if (handler) {
      return handler(args, deps);
    }

    deps.addMessage({
      role: 'system',
      content: `Unknown command: ${cmd}. Type /help for available commands.`,
      timestamp: Date.now(),
    });
    return true;
  };

  return { handleCommand };
}
