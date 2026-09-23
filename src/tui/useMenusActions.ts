import { useCallback } from 'react';
import clipboard from 'clipboardy';
import { useMenuNavigation } from './useMenuNavigation.js';
import {
  CONFIGURE_ENTRY_ID,
  SESSION_PAGE_SIZE,
  initialModelMenuState,
  initialSessionMenuState,
} from './layoutState.js';
import type { ModelMenuState, SessionMenuState } from './layoutState.js';
import { McpManager } from '../services/McpManager.js';
import { ToolService } from '../services/ToolService.js';
import { FileSystemService } from '../services/FileSystemService.js';
import { ExecutionService } from '../services/ExecutionService.js';
import { truncateOutput } from './layoutFormat.js';
import type { Action } from '../store/index.js';
import type { Message } from '../core/types.js';
import type { McpToolDescriptor } from '../types/mcp.js';
import type { ToolName } from '../types/tools.js';
import type { ModelInfo } from '../types/config.js';

interface MenusActionsDeps {
  modelMenuState: ModelMenuState;
  sessionMenuState: SessionMenuState;
  modelDetail: ModelInfo | null;
  filteredModelList: ModelInfo[];
  messages: Message[];
  mcpManager: McpManager | null;
  pendingAction: Action | null;
  coreApprovalRef: { current: ((ok: boolean) => void) | null };
  toolServiceRef: { current: ToolService | null };
  setModelDetail: (model: ModelInfo | null) => void;
  setModelMenuState: (state: ModelMenuState | ((prev: ModelMenuState) => ModelMenuState)) => void;
  setSessionMenuState: (state: SessionMenuState | ((prev: SessionMenuState) => SessionMenuState)) => void;
  setPendingAction: (action: Action | null) => void;
  addMessage: (msg: Message) => void;
  openConfigMenu: (options?: { returnToModels?: boolean }) => Promise<void>;
  closeModelMenu: () => void;
  closeSessionMenu: () => void;
  handleModelSwitch: (modelId: string) => Promise<void>;
  handleSessionResume: (sessionId: string) => Promise<void>;
  handleSessionSearch: (query: string) => Promise<void>;
  changeSessionPage: (direction: 'prev' | 'next') => void;
}

export function useMenusActions({
  modelMenuState,
  sessionMenuState,
  modelDetail,
  filteredModelList,
  messages,
  mcpManager,
  pendingAction,
  coreApprovalRef,
  toolServiceRef,
  setModelDetail,
  setModelMenuState,
  setSessionMenuState,
  setPendingAction,
  addMessage,
  openConfigMenu,
  closeModelMenu,
  closeSessionMenu,
  handleModelSwitch,
  handleSessionResume,
  handleSessionSearch,
  changeSessionPage,
}: MenusActionsDeps) {
  const handleConfigMenuSubmit = useCallback(
    () => {
      // Legacy handler, now handled by ConfigMenuScreen
    },
    []
  );

  const handleModelMenuSubmit = useCallback(
    (model?: ModelInfo) => {
      if (!model) return;
      setModelDetail(null);
      if (model.id === CONFIGURE_ENTRY_ID) {
        void openConfigMenu({ returnToModels: true });
        return;
      }
      void handleModelSwitch(model.id);
    },
    [handleModelSwitch, openConfigMenu, setModelDetail]
  );

  const isModelDetailOpen = Boolean(modelDetail);

  const safeModelMenuIndex =
    filteredModelList.length === 0
      ? 0
      : Math.min(modelMenuState.selectedIndex, filteredModelList.length - 1);

  const safeSessionMenuIndex =
    sessionMenuState.sessions.length === 0
      ? 0
      : Math.min(sessionMenuState.selectedIndex, sessionMenuState.sessions.length - 1);

  const sessionTotalPages = Math.ceil(sessionMenuState.sessions.length / SESSION_PAGE_SIZE);

  useMenuNavigation({
    isOpen: modelMenuState.open && !isModelDetailOpen,
    totalItems: filteredModelList.length,
    selectedIndex: safeModelMenuIndex,
    onChangeIndex: (nextIndex) => {
      setModelMenuState((prev) => ({ ...prev, selectedIndex: nextIndex }));
    },
    onSubmit: (index) => {
      const model = filteredModelList[index];
      setModelMenuState(initialModelMenuState);
      handleModelMenuSubmit(model);
    },
    onClose: closeModelMenu,
  });

  useMenuNavigation({
    isOpen: sessionMenuState.open,
    totalItems: sessionMenuState.sessions.length,
    selectedIndex: safeSessionMenuIndex,
    wrap: false,
    onChangeIndex: (nextIndex) => {
      setSessionMenuState((prev) => {
        if (!prev.sessions.length) return prev;
        const total = prev.sessions.length;
        const clamped = Math.max(0, Math.min(total - 1, nextIndex));
        const newPage = Math.floor(clamped / SESSION_PAGE_SIZE);
        return { ...prev, selectedIndex: clamped, currentPage: newPage };
      });
    },
    onSubmit: (index) => {
      const session = sessionMenuState.sessions[index];
      if (!session) return;
      closeSessionMenu();
      void handleSessionResume(session.id);
    },
    onClose: closeSessionMenu,
    paging: {
      totalPages: sessionTotalPages,
      onPageChange: (direction) => changeSessionPage(direction),
    },
  });

  const copyConversation = useCallback(async ({ onlyModel, limit }: { onlyModel: boolean; limit?: number }) => {
    const allMessages = messages;
    const source = onlyModel ? allMessages.filter((msg) => msg.role === 'assistant') : allMessages;

    if (!source.length) {
      addMessage({
        role: 'system',
        content: onlyModel
          ? 'No model responses are available yet to copy.'
          : 'No conversation history available to copy yet.',
        timestamp: Date.now(),
      });
      return;
    }

    const normalizedLimit = limit && limit > 0 ? limit : undefined;
    const selection = normalizedLimit ? source.slice(-normalizedLimit) : source;

    const formatted = selection
      .map((msg, idx) => {
        const label = onlyModel ? `MODEL #${source.length - selection.length + idx + 1}` : msg.role.toUpperCase();
        const timestamp = new Date(msg.timestamp).toISOString();
        return `[${label}] ${timestamp}\n${msg.content}`;
      })
      .join('\n\n');

    try {
      await clipboard.write(formatted);
      addMessage({
        role: 'system',
        content: `Copied ${onlyModel ? 'model output' : 'conversation'} (${selection.length} block${selection.length === 1 ? '' : 's'}) to clipboard.`,
        timestamp: Date.now(),
      });
    } catch (error: any) {
      addMessage({
        role: 'system',
        content: `Failed to copy text: ${error.message}`,
        timestamp: Date.now(),
      });
    }
  }, [messages, addMessage]);

  const performToolCall = useCallback(async (descriptor: McpToolDescriptor, args: Record<string, any>) => {
    const manager = mcpManager;
    if (descriptor.name === 'search_tools') {
      if (!manager) throw new Error('MCP manager not initialized');
      const results = await manager.searchTools(String(args.query || ''), args.limit || 20);
      if (!results.length) return 'No tools matched that query.';
      return results.map((t) => `${t.name} — ${t.description || 'no description'} (${t.source})`).join('\n');
    }

    if (descriptor.source === 'server') {
      if (!manager) throw new Error('MCP manager not initialized');
      const response = await manager.callServerTool(descriptor, args);
      return response.output;
    }
    const svc = toolServiceRef.current;
    if (!svc) {
      throw new Error('Tool service not initialized');
    }
    const exec = await svc.execute({ tool: descriptor.name as ToolName, params: args });
    return exec.output;
  }, [mcpManager, toolServiceRef]);

  const handleConfirmAction = useCallback(async (pending?: Action) => {
    const action = pending || pendingAction;
    if (!action) return;

    if (action.type === 'tool_call' && coreApprovalRef.current) {
      const resolve = coreApprovalRef.current;
      coreApprovalRef.current = null;
      setPendingAction(null);
      resolve(true);
      return;
    }

    setPendingAction(null);
    let result = '';

    if (action.type === 'shell_exec') {
      const execService = new ExecutionService();
      result = await execService.runShell(action.params.command, action.params.cwd);
    } else if (action.type === 'file_edit') {
      const fsService = new FileSystemService();
      try {
        await fsService.applyEdit(action.params.path, action.params.find_string, action.params.replace_string);
        result = 'File edited successfully.';
      } catch (error: any) {
        result = 'Error editing file: ' + error.message;
      }
    } else if (action.type === 'tool_call') {
      try {
        const descriptor = action.params.descriptor as McpToolDescriptor | undefined;
        const args = action.params.args || {};
        if (!descriptor) {
          result = 'Tool descriptor missing for requested call.';
        } else {
          const output = await performToolCall(descriptor, args);
          result = `Tool ${descriptor.name} output:\n${truncateOutput(output)}`;
        }
      } catch (error: any) {
        result = `Error executing tool: ${error.message}`;
      }
    }

    addMessage({ role: 'system', content: `Action Executed:\n${result}`, timestamp: Date.now() });
  }, [pendingAction, coreApprovalRef, setPendingAction, addMessage, performToolCall]);

  const handleRejectAction = useCallback(() => {
    if (coreApprovalRef.current) {
      const resolve = coreApprovalRef.current;
      coreApprovalRef.current = null;
      setPendingAction(null);
      addMessage({ role: 'system', content: 'Action Rejected by user.', timestamp: Date.now() });
      resolve(false);
      return;
    }
    setPendingAction(null);
    addMessage({ role: 'system', content: 'Action Rejected by user.', timestamp: Date.now() });
  }, [coreApprovalRef, setPendingAction, addMessage]);

  return {
    handleConfigMenuSubmit,
    handleModelMenuSubmit,
    isModelDetailOpen,
    safeModelMenuIndex,
    safeSessionMenuIndex,
    sessionTotalPages,
    copyConversation,
    performToolCall,
    handleConfirmAction,
    handleRejectAction,
  };
}
