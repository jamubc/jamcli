import { useCallback } from 'react';
import { LLMFactory } from '../services/LLMProvider.js';
import { CoreAgent } from '../core/agent.js';
import { adaptLegacyProvider } from '../core/providers/legacy.js';
import { createSession } from '../core/state.js';
import type { ChatMessage, TokenUsage } from '../core/types.js';
import { ContextManager } from '../core/context/manager.js';
import { buildSystemPrompt } from '../core/prompt.js';
import { isMcpToolQuery, userQueryNeedsTools } from '../core/sensor.js';
import { resolveAtReferences, type AtReference, type MissingAtReference } from '../utils/atReferences.js';
import type { Config, Profile } from '../types/config.js';

interface SubmitDeps {
  collapsedPaste: { content: string } | null;
  isConfigMenuOpen: boolean;
  projectRoot: string;
  messages: ChatMessage[];
  activeProfile: Profile | null;
  config: Config | null;
  abortControllerRef: { current: AbortController | null };
  cancelReasonRef: { current: 'escape' | 'ctrl+c' | null };
  modelsUsedRef: { current: Set<string> };
  setInputValue: (value: string) => void;
  setCollapsedPaste: (value: any) => void;
  clearInlineNotice: () => void;
  showInlineNotice: (notice: { message: string; tone?: 'warning' | 'info'; kind?: 'clear_input' | 'sticky' }) => void;
  handleCommand: (text: string) => Promise<boolean>;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string, usage?: TokenUsage, overrides?: Partial<ChatMessage>) => void;
  setStatus: (status: 'idle' | 'thinking' | 'streaming') => void;
  replaceMessages: (messages: ChatMessage[]) => void;
  showMcpTools: () => Promise<void>;
  persistTurn: () => Promise<void>;
  incrementModelTokenUsage: (key: string, usage: TokenUsage) => void;
  initializeModelTokenUsage: (key: string) => void;
  runToolEnabledConversation: (args: {
    provider: ReturnType<typeof LLMFactory.createProvider>;
    contextForModel: ChatMessage[];
    modelUsageKey: string;
    modelName?: string;
    signal?: AbortSignal;
    userText: string;
  }) => Promise<boolean>;
}

export function formatAtReferenceMessage(reference: AtReference) {
  const header =
    reference.type === 'file'
      ? `📄 Included file: ${reference.displayPath}`
      : `📂 Directory listing: ${reference.displayPath}`;
  const meta =
    reference.type === 'file'
      ? `Size: ${reference.size?.toLocaleString() ?? 'unknown'} bytes${reference.truncated ? ' (truncated)' : ''}`
      : `Entries: ${reference.listingCount ?? 'unknown'}${reference.truncated ? ' (partial)' : ''}`;
  const content = reference.content || '<empty>';
  const body = reference.type === 'file' && reference.truncated ? `${content}\n… <file truncated>` : content;
  return `${header}\n${meta}\n\n${body}`;
}

export function formatMissingAtReferenceMessage(missing: MissingAtReference) {
  return `⚠️ Unable to include ${missing.raw} (${missing.absolutePath}): ${missing.reason}`;
}

export function useChatSubmit({
  collapsedPaste,
  isConfigMenuOpen,
  projectRoot,
  messages,
  activeProfile,
  config,
  abortControllerRef,
  cancelReasonRef,
  modelsUsedRef,
  setInputValue,
  setCollapsedPaste,
  clearInlineNotice,
  showInlineNotice,
  handleCommand,
  addMessage,
  updateLastMessage,
  setStatus,
  replaceMessages,
  showMcpTools,
  persistTurn,
  incrementModelTokenUsage,
  initializeModelTokenUsage,
  runToolEnabledConversation,
}: SubmitDeps) {
  const handleInputSubmit = useCallback(async (rawValue: string) => {
    if (collapsedPaste) {
      setInputValue(collapsedPaste.content);
      setCollapsedPaste(null);
      clearInlineNotice();
      return;
    }

    const text = rawValue.trim();
    if (!text) {
      setInputValue('');
      return;
    }

    if (isConfigMenuOpen && !text.startsWith('/')) {
      setInputValue('');
      return;
    }

    setInputValue('');
    if (await handleCommand(text)) {
      return;
    }

    const referenceOperations = await resolveAtReferences(text, projectRoot);
    for (const operation of referenceOperations) {
      const timestamp = Date.now();
      if (operation.kind === 'missing') {
        addMessage({
          role: 'system',
          content: formatMissingAtReferenceMessage(operation.missing),
          timestamp,
        });
        continue;
      }
      addMessage({
        role: 'system',
        content: formatAtReferenceMessage(operation.reference),
        timestamp,
      });
    }

    addMessage({ role: 'user', content: text, timestamp: Date.now() });
    if (isMcpToolQuery(text)) {
      await showMcpTools();
      return;
    }

    setStatus('thinking');

    const baseMessages = messages;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    cancelReasonRef.current = null;

    try {
      const providerKey = activeProfile?.preferred_provider === 'openrouter' ? 'openrouter' : 'ollama';
      const providerConfig =
        providerKey === 'openrouter'
          ? config?.api_registry.openrouter || {}
          : config?.api_registry.ollama || {};

      const provider = LLMFactory.createProvider(providerKey as 'ollama' | 'openrouter', providerConfig);
      const modelId = activeProfile?.preferred_model || 'default';

      const managed = await ContextManager.manageContext(
        baseMessages,
        config?.context_management,
        adaptLegacyProvider(provider),
        modelId,
        false
      );
      const contextNotice = managed.systemNotice?.trim();
      const contextForModel = managed.context;

      if (contextNotice) {
        showInlineNotice({
          message: contextNotice,
          tone: contextNotice.startsWith('⚠') ? 'warning' : 'info',
          kind: 'sticky',
        });
      }

      if (managed.context !== baseMessages) {
        replaceMessages(managed.context);
      }

      const conversationProvider = activeProfile?.preferred_provider || providerKey;
      const conversationModelName = activeProfile?.preferred_model || 'unknown-model';
      const modelUsageKey = `${conversationProvider}:${conversationModelName}`;
      modelsUsedRef.current.add(modelUsageKey);
      initializeModelTokenUsage(modelUsageKey);

      const needsTools = userQueryNeedsTools(text);
      const canUseTools = providerKey === 'openrouter' && needsTools;
      if (canUseTools) {
        const handled = await runToolEnabledConversation({
          provider,
          contextForModel,
          modelUsageKey,
          modelName: activeProfile?.preferred_model,
          signal: controller.signal,
          userText: text,
        });
        if (handled) {
          return;
        }
      }

      addMessage({
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        model: activeProfile?.preferred_model,
        modelName: activeProfile?.preferred_model,
        streaming: true,
      });

      const systemPromptMessage: ChatMessage = {
        role: 'system',
        content: buildSystemPrompt(activeProfile),
        timestamp: Date.now(),
      };
      const streamMessages =
        contextForModel[0]?.role === 'system' ? contextForModel : [systemPromptMessage, ...contextForModel];

      let fullContent = '';
      let fullReasoning = '';
      let buffer = '';
      let reasoningBuffer = '';
      const BUFFER_SIZE = 50;
      let hasContent = false;
      let finalUsage: TokenUsage | undefined;
      let hasStartedStreaming = false;

      const streamSession = createSession(projectRoot, 'tui-stream');
      const streamAgent = new CoreAgent({
        provider: adaptLegacyProvider(provider),
        model: activeProfile?.preferred_model,
        temperature: activeProfile?.temperature,
        modelUsageKey,
        signal: controller.signal,
      });
      streamSession.messages.push(...streamMessages.map((m) => ({ ...m })));
      const streamResult = await streamAgent.run(streamSession, '', (event) => {
        if (event.type === 'text' && event.delta) {
          if (!hasStartedStreaming) {
            setStatus('streaming');
            hasStartedStreaming = true;
          }
          buffer += event.delta;
          hasContent = true;
        }
        if (event.type === 'reasoning' && event.delta) {
          if (!hasStartedStreaming) {
            setStatus('streaming');
            hasStartedStreaming = true;
          }
          reasoningBuffer += event.delta;
        }
        if (event.type === 'usage') {
          finalUsage = event.usage;
        }
        if (buffer.length >= BUFFER_SIZE || reasoningBuffer.length >= BUFFER_SIZE) {
          fullContent += buffer;
          fullReasoning += reasoningBuffer;
          updateLastMessage(fullContent, undefined, { reasoning: fullReasoning });
          buffer = '';
          reasoningBuffer = '';
        }
      });
      void streamResult;
      if (buffer.length > 0) {
        fullContent += buffer;
      }
      if (reasoningBuffer.length > 0) {
        fullReasoning += reasoningBuffer;
      }

      if (!hasContent) {
        updateLastMessage(
          (() => {
            const modelName = activeProfile?.preferred_model || 'selected model';
            const base = `No content returned from ${modelName} yet.`;
            const hint =
              providerKey === 'ollama'
                ? ` The model may still be warming up or pulling. If this repeats, try: ollama pull ${modelName}.`
                : ' If this keeps happening, check your API key or network settings.';
            return base + hint;
          })(),
          undefined,
          { streaming: false }
        );
      } else {
        updateLastMessage(fullContent, finalUsage, { streaming: false, reasoning: fullReasoning });
        await persistTurn();
        if (finalUsage) {
          incrementModelTokenUsage(modelUsageKey, finalUsage);
        }
      }

    } catch (error: any) {
      if (error?.name === 'AbortError') {
        const reason = cancelReasonRef.current;
        const cancelledMessage = reason === 'escape' ? '⏸️ Request cancelled by user.' : '⛔ Request cancelled.';
        const latestMessages = messages;
        const last = latestMessages[latestMessages.length - 1];
        if (last?.role === 'assistant') {
          const content = last.content ? `${last.content}\n\n${cancelledMessage}` : cancelledMessage;
          updateLastMessage(content, undefined, { streaming: false });
        } else {
          addMessage({ role: 'system', content: cancelledMessage, timestamp: Date.now() });
        }
        return;
      }

      const errorMsg = `❌ Error: ${error.message}\n\nPossible causes:\n- Provider is not running\n- Model not available (download with: ollama pull ${
        activeProfile?.preferred_model || 'llama3'
      })`;
      updateLastMessage(errorMsg, undefined, { streaming: false });
    } finally {
      abortControllerRef.current = null;
      cancelReasonRef.current = null;
      setStatus('idle');
    }
  }, [
    collapsedPaste,
    isConfigMenuOpen,
    projectRoot,
    messages,
    activeProfile,
    config,
    abortControllerRef,
    cancelReasonRef,
    modelsUsedRef,
    setInputValue,
    setCollapsedPaste,
    clearInlineNotice,
    showInlineNotice,
    handleCommand,
    addMessage,
    updateLastMessage,
    setStatus,
    replaceMessages,
    showMcpTools,
    persistTurn,
    incrementModelTokenUsage,
    initializeModelTokenUsage,
    runToolEnabledConversation,
  ]);

  return { handleInputSubmit };
}
