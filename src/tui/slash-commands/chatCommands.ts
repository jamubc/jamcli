import { LLMFactory } from '../../services/LLMProvider.js';
import { ContextManager } from '../../core/context/manager.js';
import { adaptLegacyProvider } from '../../core/providers/legacy.js';
import type { CommandHandler } from './types.js';

export const handleCompact: CommandHandler = async (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  const currentMessages = deps.messages;
  const currentConfig = deps.config;
  const currentProfile = deps.activeProfile;

  if (deps.status !== 'idle') {
    deps.addMessage({ role: 'system', content: 'Cannot compact while busy.', timestamp: Date.now() });
    return true;
  }

  deps.addMessage({ role: 'system', content: 'Compacting conversation history...', timestamp: Date.now() });
  deps.setStatus('thinking');

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
      deps.replaceMessages(result.context);
      deps.addMessage({
        role: 'system',
        content: result.systemNotice || 'Context compacted.',
        timestamp: Date.now(),
      });
    } else {
      deps.addMessage({
        role: 'system',
        content: 'Context is already optimized or too short to compact.',
        timestamp: Date.now(),
      });
    }
  } catch (error: any) {
    deps.addMessage({ role: 'system', content: `Compaction failed: ${error.message}`, timestamp: Date.now() });
  } finally {
    deps.setStatus('idle');
  }
  return true;
};

export const handleCopy: CommandHandler = async (args, deps) => {
  deps.setIsConfigMenuOpen(false);
  const firstArg = args[0]?.toLowerCase();
  const onlyModel = firstArg === 'o' || firstArg === '0';
  const limitArg = onlyModel ? args[1] : args[0];

  if (limitArg) {
    const parsedLimit = parseInt(limitArg, 10);
    if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
      deps.addMessage({
        role: 'system',
        content: 'Usage: /copy [o] [count]\nExamples: /copy, /copy o, /copy o 3',
        timestamp: Date.now(),
      });
      return true;
    }
    await deps.copyConversation({ onlyModel, limit: parsedLimit });
    return true;
  }

  await deps.copyConversation({ onlyModel });
  return true;
};

export const handleModel: CommandHandler = async (args, deps) => {
  if (!deps.modelService) {
    deps.addMessage({
      role: 'system',
      content: 'Model service is still initializing. Try again shortly.',
      timestamp: Date.now(),
    });
    return true;
  }

  if (args.length > 0) {
    deps.setIsConfigMenuOpen(false);
    await deps.handleModelSwitch(args[0]);
    return true;
  }

  try {
    const models = await deps.modelService.listAvailableModels();
    deps.setAvailableModels(models);
    if (models.length === 0) {
      deps.addMessage({
        role: 'system',
        content: 'No models available. Configure Ollama or add an API key to list providers.',
        timestamp: Date.now(),
      });
      return true;
    }
    deps.setIsConfigMenuOpen(false);
    deps.openModelMenu(models);
  } catch (error: any) {
    deps.addMessage({
      role: 'system',
      content: `Failed to list models: ${error.message}`,
      timestamp: Date.now(),
    });
  }
  return true;
};

export const chatCommands: Record<string, CommandHandler> = {
  '/compact': handleCompact,
  '/copy': handleCopy,
  '/model': handleModel,
};
