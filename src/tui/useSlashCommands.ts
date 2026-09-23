import { useCallback } from 'react';
import { LLMFactory } from '../services/LLMProvider.js';
import { ContextManager } from '../core/context/manager.js';
import { adaptLegacyProvider } from '../core/providers/legacy.js';
import { resetTerminalViewport } from './layoutState.js';
import { normalizeProvider, normalizeToolIdentifier } from './layoutFormat.js';
import { MCP_COMMAND_USAGE, PROVIDER_COMMAND_USAGE, TOOL_COMMAND_USAGE } from './layoutState.js';
import { forkSession } from '../core/session/store.js';
import { DEFAULT_CATEGORIES, describeChain, listCategories } from '../core/routing/categories.js';
import type { ProviderSlug } from './layoutState.js';
import type { ChatMessage } from '../core/types.js';
import type { Config, ModelInfo, Profile } from '../types/config.js';

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

interface CommandDeps {
  messages: ChatMessage[];
  config: Config | null;
  activeProfile: Profile | null;
  status: 'idle' | 'thinking' | 'streaming';
  projectRoot: string;
  modelService: any;
  configService: any;
  mcpManager: any;
  setIsConfigMenuOpen: (open: boolean) => void;
  setIsExpandedView: (expanded: boolean) => void;
  setModelDetail: (model: ModelInfo | null) => void;
  replaceMessages: (messages: ChatMessage[]) => void;
  addMessage: (msg: ChatMessage) => void;
  performExit: () => void;
  openSessionMenu: () => Promise<void>;
  showToolStatus: () => Promise<boolean>;
  updateToolPermissionSetting: (tool: any, updates: any, label: string) => Promise<void>;
  showMcpServers: () => Promise<void>;
  showMcpTools: () => Promise<void>;
  upsertMcpServer: (id: string, command: string, args: string[], cwd?: string) => Promise<void>;
  removeMcpServer: (id: string) => Promise<void>;
  openConfigMenu: (options?: { returnToModels?: boolean }) => Promise<void>;
  showSystemPrompt: () => Promise<void>;
  updateSystemPromptSetting: (prompt: string) => Promise<void>;
  showProviderSettings: () => Promise<void>;
  updateProviderSetting: (provider: ProviderSlug, value?: string) => Promise<void>;
  copyConversation: (args: { onlyModel: boolean; limit?: number }) => Promise<void>;
  openStatusStyleMenu: () => Promise<void>;
  setStatus: (status: 'idle' | 'thinking' | 'streaming') => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  getSessionId: () => string | null;
  forkSession: (projectRoot: string, sessionId: string) => Promise<string | null>;
  initializeHistory: (projectRoot?: string, sessionId?: string) => Promise<void>;
  openModelMenu: (models: ModelInfo[]) => void;
  reopenModelMenu: () => Promise<void>;
  refreshAvailableModels: () => Promise<ModelInfo[]>;
  handleModelSwitch: (modelId: string) => Promise<void>;
}

export function useSlashCommands(deps: CommandDeps) {
  const {
    messages,
    config,
    activeProfile,
    status,
    projectRoot,
    modelService,
    configService,
    mcpManager,
    setIsConfigMenuOpen,
    setIsExpandedView,
    setModelDetail,
    replaceMessages,
    addMessage,
    performExit,
    openSessionMenu,
    showToolStatus,
    updateToolPermissionSetting,
    showMcpServers,
    showMcpTools,
    upsertMcpServer,
    removeMcpServer,
    openConfigMenu,
    showSystemPrompt,
    updateSystemPromptSetting,
    showProviderSettings,
    updateProviderSetting,
    copyConversation,
    openStatusStyleMenu,
    setStatus,
    setAvailableModels,
    getSessionId,
    forkSession,
    initializeHistory,
    openModelMenu,
    reopenModelMenu,
    refreshAvailableModels,
    handleModelSwitch,
  } = deps;

  const handleCommand = async (text: string) => {
    if (!text.startsWith('/')) return false;

    const [cmd, ...args] = text.trim().split(/\s+/);
    const command = cmd.toLowerCase();

    switch (command) {
      case '/clear':
        setIsConfigMenuOpen(false);
        resetTerminalViewport();
        setIsExpandedView(false);
        replaceMessages([]);
        return true;
      case '/help':
        setIsConfigMenuOpen(false);
        addMessage({
          role: 'system',
          content:
            'Available commands:\n/model <name> - Switch AI model\n/profile <name> - Switch profile\n/resume - Resume a previous session\n/tools [action] - Manage tool permissions\n/categories - Show model categories\n/config [prompt|menu] - Inspect or edit settings\n/copy [o] [count] - Copy chat (o = model output)\n/clear - Clear chat history\n/help - Show this help\n/exit - Exit JamCLI',
          timestamp: Date.now(),
        });
        return true;
      case '/exit':
        performExit();
        return true;
      case '/resume':
        setIsConfigMenuOpen(false);
        await openSessionMenu();
        return true;
      case '/profile':
        setIsConfigMenuOpen(false);
        addMessage({
          role: 'system',
          content: 'Profile switching not yet implemented',
          timestamp: Date.now(),
        });
        return true;
      case '/categories': {
        setIsConfigMenuOpen(false);
        addMessage({ role: 'system', content: describeCategories(config), timestamp: Date.now() });
        return true;
      }
      case '/fork': {
        setIsConfigMenuOpen(false);
        const sourceId = getSessionId();
        if (!sourceId) {
          addMessage({
            role: 'system',
            content: 'No session is active yet, so there is nothing to fork.',
            timestamp: Date.now(),
          });
          return true;
        }
        const forked = await forkSession(projectRoot, sourceId);
        if (!forked) {
          addMessage({
            role: 'system',
            content: `Could not fork ${sourceId}: it has no recorded turns.`,
            timestamp: Date.now(),
          });
          return true;
        }
        await initializeHistory(projectRoot, forked);
        addMessage({
          role: 'system',
          content: `Forked ${sourceId} into ${forked}. The original session is unchanged and later turns land in the fork.`,
          timestamp: Date.now(),
        });
        return true;
      }
      case '/tools': {
        setIsConfigMenuOpen(false);
        const action = (args[0] || 'status').toLowerCase();
        if (['status', 'list', 'show'].includes(action)) {
          await showToolStatus();
          return true;
        }

        const targetArg = args[1];
        if (!targetArg) {
          addMessage({ role: 'system', content: TOOL_COMMAND_USAGE, timestamp: Date.now() });
          return true;
        }

        const toolName = normalizeToolIdentifier(targetArg);
        if (!toolName) {
          addMessage({ role: 'system', content: `Unknown tool: ${targetArg}`, timestamp: Date.now() });
          return true;
        }

        if (['enable', 'allow', 'on'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: true, require_approval: false }, 'enabled');
          return true;
        }

        if (['disable', 'deny', 'off'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: false, require_approval: false }, 'disabled');
          return true;
        }

        if (['require', 'approve', 'ask'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: true, require_approval: true }, 'now requires approval');
          return true;
        }

        if (['auto', 'trust'].includes(action)) {
          await updateToolPermissionSetting(toolName, { allowed: true, require_approval: false }, 'set to auto-approve');
          return true;
        }

        addMessage({ role: 'system', content: TOOL_COMMAND_USAGE, timestamp: Date.now() });
        return true;
      }
      case '/mcp': {
        setIsConfigMenuOpen(false);
        const action = (args[0] || 'servers').toLowerCase();
        if (['servers', 'list'].includes(action)) {
          await showMcpServers();
          return true;
        }
        if (action === 'tools') {
          await showMcpTools();
          return true;
        }
        if (action === 'add') {
          const [id, command, ...rest] = args.slice(1);
          if (!id || !command) {
            addMessage({ role: 'system', content: 'Usage: /mcp add <id> <command> [args...]', timestamp: Date.now() });
            return true;
          }
          await upsertMcpServer(id, command, rest);
          return true;
        }
        if (action === 'remove') {
          const id = args[1];
          if (!id) {
            addMessage({ role: 'system', content: 'Usage: /mcp remove <id>', timestamp: Date.now() });
            return true;
          }
          await removeMcpServer(id);
          return true;
        }
        addMessage({ role: 'system', content: MCP_COMMAND_USAGE, timestamp: Date.now() });
        return true;
      }
      case '/config': {
        const action = (args[0] || 'menu').toLowerCase();
        if (action === 'prompt') {
          const promptAction = (args[1] || 'show').toLowerCase();
          if (promptAction === 'show') {
            await showSystemPrompt();
            return true;
          }
          if (promptAction === 'set') {
            const nextPrompt = args.slice(2).join(' ').trim();
            if (!nextPrompt) {
              addMessage({ role: 'system', content: 'Usage: /config prompt set <new prompt text>', timestamp: Date.now() });
              return true;
            }
            await updateSystemPromptSetting(nextPrompt);
            return true;
          }
          addMessage({ role: 'system', content: 'Supported prompt commands: show, set', timestamp: Date.now() });
          return true;
        }
        if (action === 'style' || action === 'status') {
          await openStatusStyleMenu();
          return true;
        }
        if (action === 'provider') {
          const providerAction = (args[1] || 'list').toLowerCase();
          if (providerAction === 'list') {
            await showProviderSettings();
            return true;
          }
          if (providerAction === 'set') {
            const provider = normalizeProvider(args[2]);
            if (!provider) {
              addMessage({ role: 'system', content: 'Unknown provider. Supported: ollama, openrouter.', timestamp: Date.now() });
              return true;
            }
            const value = args.slice(3).join(' ').trim();
            await updateProviderSetting(provider, value);
            return true;
          }
          addMessage({ role: 'system', content: PROVIDER_COMMAND_USAGE, timestamp: Date.now() });
          return true;
        }
        await openConfigMenu();
        return true;
      }
      case '/compact': {
        setIsConfigMenuOpen(false);
        const currentMessages = messages;
        const currentConfig = config;
        const currentProfile = activeProfile;

        if (status !== 'idle') {
          addMessage({ role: 'system', content: 'Cannot compact while busy.', timestamp: Date.now() });
          return true;
        }

        addMessage({ role: 'system', content: 'Compacting conversation history...', timestamp: Date.now() });
        setStatus('thinking');

        try {
          const providerKey = currentProfile?.preferred_provider === 'openrouter' ? 'openrouter' : 'ollama';
          const providerConfig =
            providerKey === 'openrouter'
              ? currentConfig?.api_registry.openrouter || {}
              : currentConfig?.api_registry.ollama || {};

          const provider = LLMFactory.createProvider(providerKey, providerConfig);
          const modelId = currentProfile?.preferred_model || 'default';

          const result = await ContextManager.manageContext(
            currentMessages,
            currentConfig?.context_management,
            adaptLegacyProvider(provider),
            modelId,
            true
          );

          if (result.context !== currentMessages) {
            replaceMessages(result.context);
            addMessage({
              role: 'system',
              content: result.systemNotice || 'Context compacted.',
              timestamp: Date.now(),
            });
          } else {
            addMessage({
              role: 'system',
              content: 'Context is already optimized or too short to compact.',
              timestamp: Date.now(),
            });
          }
        } catch (error: any) {
          addMessage({ role: 'system', content: `Compaction failed: ${error.message}`, timestamp: Date.now() });
        } finally {
          setStatus('idle');
        }
        return true;
      }
      case '/copy': {
        setIsConfigMenuOpen(false);
        const firstArg = args[0]?.toLowerCase();
        const onlyModel = firstArg === 'o' || firstArg === '0';
        const limitArg = onlyModel ? args[1] : args[0];

        if (limitArg) {
          const parsedLimit = parseInt(limitArg, 10);
          if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
            addMessage({
              role: 'system',
              content: 'Usage: /copy [o] [count]\nExamples: /copy, /copy o, /copy o 3',
              timestamp: Date.now(),
            });
            return true;
          }
          await copyConversation({ onlyModel, limit: parsedLimit });
          return true;
        }

        await copyConversation({ onlyModel });
        return true;
      }
      case '/model': {
        if (!modelService) {
          addMessage({
            role: 'system',
            content: 'Model service is still initializing. Try again shortly.',
            timestamp: Date.now(),
          });
          return true;
        }

        if (args.length > 0) {
          setIsConfigMenuOpen(false);
          await handleModelSwitch(args[0]);
          return true;
        }

        try {
          const models = await modelService.listAvailableModels();
          setAvailableModels(models);
          if (models.length === 0) {
            addMessage({
              role: 'system',
              content: 'No models available. Configure Ollama or add an API key to list providers.',
              timestamp: Date.now(),
            });
            return true;
          }
          setIsConfigMenuOpen(false);
          openModelMenu(models);
        } catch (error: any) {
          addMessage({
            role: 'system',
            content: `Failed to list models: ${error.message}`,
            timestamp: Date.now(),
          });
        }
        return true;
      }
      default:
        addMessage({
          role: 'system',
          content: `Unknown command: ${cmd}. Type /help for available commands.`,
          timestamp: Date.now(),
        });
        return true;
    }
  };


  return { handleCommand };
}
