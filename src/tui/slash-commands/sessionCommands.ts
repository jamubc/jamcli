import { resetTerminalViewport } from '../layoutState.js';
import { DEFAULT_CATEGORIES, describeChain, listCategories } from '../../core/routing/categories.js';
import type { Config } from '../../types/config.js';
import type { CommandDeps, CommandHandler } from './types.js';

const describeCategories = (config: Config | null): string => {
  const configured = config?.categories;
  const entries = configured && Object.keys(configured).length ? listCategories(configured) : listCategories(DEFAULT_CATEGORIES);
  const source = configured && Object.keys(configured).length ? 'configured' : 'defaults';
  const lines = [`Model categories (${source}):`];
  for (const entry of entries) {
    lines.push(`- ${entry.name}: ${describeChain(entry.chain)}`);
  }
  lines.push('', 'Category routing applies to delegated work; the session model is unchanged.');
  return lines.join('\n');
};

export const handleClear: CommandHandler = (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  resetTerminalViewport();
  deps.setIsExpandedView(false);
  deps.replaceMessages([]);
  return true;
};

export const handleHelp: CommandHandler = (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  deps.addMessage({
    role: 'system',
    content:
      'Available commands:\n/model <name> - Switch AI model\n/profile <name> - Switch profile\n/resume - Resume a previous session\n/tools [action] - Manage tool permissions\n/categories - Show model categories\n/config [prompt|menu] - Inspect or edit settings\n/copy [o] [count] - Copy chat (o = model output)\n/clear - Clear chat history\n/help - Show this help\n/exit - Exit JamCLI',
    timestamp: Date.now(),
  });
  return true;
};

export const handleExit: CommandHandler = (args, deps) => {
  deps.performExit();
  return true;
};

export const handleResume: CommandHandler = async (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  await deps.openSessionMenu();
  return true;
};

export const handleProfile: CommandHandler = (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  deps.addMessage({
    role: 'system',
    content: 'Profile switching not yet implemented',
    timestamp: Date.now(),
  });
  return true;
};

export const handleCategories: CommandHandler = (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  deps.addMessage({ role: 'system', content: describeCategories(deps.config), timestamp: Date.now() });
  return true;
};

export const handleFork: CommandHandler = async (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  const sourceId = deps.getSessionId();
  if (!sourceId) {
    deps.addMessage({
      role: 'system',
      content: 'No session is active yet, so there is nothing to fork.',
      timestamp: Date.now(),
    });
    return true;
  }
  const forked = await deps.forkSession(deps.projectRoot, sourceId);
  if (!forked) {
    deps.addMessage({
      role: 'system',
      content: `Could not fork ${sourceId}: it has no recorded turns.`,
      timestamp: Date.now(),
    });
    return true;
  }
  await deps.initializeHistory(deps.projectRoot, forked);
  deps.addMessage({
    role: 'system',
    content: `Forked ${sourceId} into ${forked}. The original session is unchanged and later turns land in the fork.`,
    timestamp: Date.now(),
  });
  return true;
};

export const sessionCommands: Record<string, CommandHandler> = {
  '/clear': handleClear,
  '/help': handleHelp,
  '/exit': handleExit,
  '/resume': handleResume,
  '/profile': handleProfile,
  '/categories': handleCategories,
  '/fork': handleFork,
};
