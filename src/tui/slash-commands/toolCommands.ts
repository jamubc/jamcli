import { normalizeProvider, normalizeToolIdentifier } from '../layoutFormat.js';
import { MCP_COMMAND_USAGE, PROVIDER_COMMAND_USAGE, TOOL_COMMAND_USAGE } from '../layoutState.js';
import type { CommandHandler } from './types.js';

export const handleTools: CommandHandler = async (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  const action = (args[0] || 'status').toLowerCase();
  if (['status', 'list', 'show'].includes(action)) {
    await deps.showToolStatus();
    return true;
  }

  const targetArg = args[1];
  if (!targetArg) {
    deps.addMessage({ role: 'system', content: TOOL_COMMAND_USAGE, timestamp: Date.now() });
    return true;
  }

  const toolName = normalizeToolIdentifier(targetArg);
  if (!toolName) {
    deps.addMessage({ role: 'system', content: `Unknown tool: ${targetArg}`, timestamp: Date.now() });
    return true;
  }

  if (['enable', 'allow', 'on'].includes(action)) {
    await deps.updateToolPermissionSetting(toolName, { allowed: true, require_approval: false }, 'enabled');
    return true;
  }

  if (['disable', 'deny', 'off'].includes(action)) {
    await deps.updateToolPermissionSetting(toolName, { allowed: false, require_approval: false }, 'disabled');
    return true;
  }

  if (['require', 'approve', 'ask'].includes(action)) {
    await deps.updateToolPermissionSetting(toolName, { allowed: true, require_approval: true }, 'now requires approval');
    return true;
  }

  if (['auto', 'trust'].includes(action)) {
    await deps.updateToolPermissionSetting(toolName, { allowed: true, require_approval: false }, 'set to auto-approve');
    return true;
  }

  deps.addMessage({ role: 'system', content: TOOL_COMMAND_USAGE, timestamp: Date.now() });
  return true;
};

export const handleMcp: CommandHandler = async (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  const action = (args[0] || 'servers').toLowerCase();
  if (['servers', 'list'].includes(action)) {
    await deps.showMcpServers();
    return true;
  }
  if (action === 'tools') {
    await deps.showMcpTools();
    return true;
  }
  if (action === 'add') {
    const [id, command, ...rest] = args.slice(1);
    if (!id || !command) {
      deps.addMessage({ role: 'system', content: 'Usage: /mcp add <id> <command> [args...]', timestamp: Date.now() });
      return true;
    }
    await deps.upsertMcpServer(id, command, rest);
    return true;
  }
  if (action === 'remove') {
    const id = args[1];
    if (!id) {
      deps.addMessage({ role: 'system', content: 'Usage: /mcp remove <id>', timestamp: Date.now() });
      return true;
    }
    await deps.removeMcpServer(id);
    return true;
  }
  deps.addMessage({ role: 'system', content: MCP_COMMAND_USAGE, timestamp: Date.now() });
  return true;
};

export const handleConfig: CommandHandler = async (args, deps) => {
  const action = (args[0] || 'menu').toLowerCase();
  if (action === 'prompt') {
    const promptAction = (args[1] || 'show').toLowerCase();
    if (promptAction === 'show') {
      await deps.showSystemPrompt();
      return true;
    }
    if (promptAction === 'set') {
      const nextPrompt = args.slice(2).join(' ').trim();
      if (!nextPrompt) {
        deps.addMessage({ role: 'system', content: 'Usage: /config prompt set <new prompt text>', timestamp: Date.now() });
        return true;
      }
      await deps.updateSystemPromptSetting(nextPrompt);
      return true;
    }
    deps.addMessage({ role: 'system', content: 'Supported prompt commands: show, set', timestamp: Date.now() });
    return true;
  }
  if (action === 'style' || action === 'status') {
    await deps.openStatusStyleMenu();
    return true;
  }
  if (action === 'provider') {
    const providerAction = (args[1] || 'list').toLowerCase();
    if (providerAction === 'list') {
      await deps.showProviderSettings();
      return true;
    }
    if (providerAction === 'set') {
      const provider = normalizeProvider(args[2]);
      if (!provider) {
        deps.addMessage({ role: 'system', content: 'Unknown provider. Supported: ollama, openrouter.', timestamp: Date.now() });
        return true;
      }
      const value = args.slice(3).join(' ').trim();
      await deps.updateProviderSetting(provider, value);
      return true;
    }
    deps.addMessage({ role: 'system', content: PROVIDER_COMMAND_USAGE, timestamp: Date.now() });
    return true;
  }
  await deps.openConfigMenu();
  return true;
};

export const toolCommands: Record<string, CommandHandler> = {
  '/tools': handleTools,
  '/mcp': handleMcp,
  '/config': handleConfig,
};
