import { create } from 'zustand';
import { Config, Profile, UiConfig } from '../types/config.js';
import { HistoryService, SessionUsage } from '../services/HistoryService.js';
import type { Message, TokenUsage } from '../core/types.js';

export interface Action {
  type: 'file_edit' | 'shell_exec' | 'tool_call';
  params: any;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  result?: string;
}

interface ChatSlice {
  messages: Message[];
  status: 'idle' | 'thinking' | 'streaming';
  historyService: HistoryService | null;
  sessionUsage: SessionUsage | null;
  addMessage: (msg: Message) => void;
  updateLastMessage: (content: string, usage?: TokenUsage, overrides?: Partial<Message>) => void;
  replaceMessages: (messages: Message[]) => void;
  setStatus: (status: 'idle' | 'thinking' | 'streaming') => void;
  initializeHistory: (projectRoot?: string, sessionId?: string) => Promise<void>;
  persistTurn: () => Promise<void>;
  getSessionUsage: () => SessionUsage | null;
  resumeSession: (sessionId: string, projectRoot?: string) => Promise<boolean>;
}

interface ConfigSlice {
  config: Config | null;
  activeProfile: Profile | null;
  setConfig: (config: Config) => void;
  setActiveProfile: (profile: Profile) => void;
  uiConfig: UiConfig | null;
  setUiConfig: (cfg: UiConfig) => void;
}

interface ExecutionSlice {
  pendingAction: Action | null;
  setPendingAction: (action: Action | null) => void;
}

interface ModelUsageSlice {
  modelTokenUsage: Record<string, TokenUsage>;
  incrementModelTokenUsage: (key: string, usage: TokenUsage) => void;
  initializeModelTokenUsage: (key: string) => void;
  clearModelTokenUsage: () => void;
}

interface AppState extends ChatSlice, ConfigSlice, ExecutionSlice, ModelUsageSlice {}

export const useStore = create<AppState>((set, get) => ({
  // Chat Slice
  messages: [],
  status: 'idle',
  historyService: null,
  sessionUsage: null,
  
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  
  updateLastMessage: (content, usage, overrides) => set((state) => {
    const messages = [...state.messages];
    if (messages.length > 0) {
      const updated = { ...messages[messages.length - 1], content };
      if (usage) {
        updated.usage = usage;
      }
      if (overrides) {
        Object.assign(updated, overrides);
      }
      messages[messages.length - 1] = updated;
    }
    return { messages };
  }),
  
  setStatus: (status) => set({ status }),

  replaceMessages: (messages) => set({ messages }),
  
  initializeHistory: async (projectRoot?: string, sessionId?: string) => {
    const resolvedRoot = projectRoot ?? process.cwd();
    const historyService = new HistoryService(resolvedRoot, sessionId);
    try {
      await historyService.initialize();
    } catch (error) {
      console.error('History initialize failed:', error);
      set({ historyService: null, sessionUsage: null, messages: [] });
      return;
    }
    
    const previousMessages = sessionId 
      ? await historyService.loadMessagesFromHistory()
      : [];
    
    set({ 
      historyService,
      sessionUsage: historyService.getSessionUsage(),
      messages: previousMessages,
    });
  },
  
  resumeSession: async (sessionId: string, projectRoot?: string) => {
    const state = get();
    const resolvedRoot = projectRoot ?? process.cwd();

    try {
      // Create new history service with existing session ID
      const historyService = new HistoryService(resolvedRoot, sessionId);
      await historyService.initialize();
      
      // Load messages from that session
      const messages = await historyService.loadMessagesFromHistory();
      
      if (messages.length === 0) {
        return false; // Session has no messages
      }
      
      // Update store with resumed session
      set({
        historyService,
        messages,
        sessionUsage: historyService.getSessionUsage(),
      });
      
      return true;
    } catch (error) {
      console.error('Failed to resume session:', error);
      return false;
    }
  },
  
  persistTurn: async () => {
    const state = get();
    if (!state.historyService) return;
    
    // Find the latest assistant response and the preceding user message
    const messages = state.messages;
    if (messages.length < 2) return;

    let assistantIndex = messages.length - 1;
    while (assistantIndex >= 0 && messages[assistantIndex].role !== 'assistant') {
      assistantIndex -= 1;
    }
    if (assistantIndex <= 0) return;

    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') {
      userIndex -= 1;
    }
    if (userIndex < 0) return;

    const lastAssistant = messages[assistantIndex];
    const lastUser = messages[userIndex];

    await state.historyService.appendTurn([lastUser, lastAssistant], lastAssistant.usage);
    
    // Update session usage
    set({ sessionUsage: state.historyService.getSessionUsage() });
  },
  
  getSessionUsage: () => {
    const state = get();
    return state.sessionUsage;
  },

  // Config Slice
  config: null,
  activeProfile: null,
  uiConfig: null,
  setConfig: (config) => set({ config }),
  setActiveProfile: (activeProfile) => set({ activeProfile }),
  setUiConfig: (uiConfig) => set({ uiConfig }),

  // Execution Slice
  pendingAction: null,
  setPendingAction: (action) => set({ pendingAction: action }),

  // Model Usage Slice
  modelTokenUsage: {},
  incrementModelTokenUsage: (key, usage) =>
    set((state) => {
      if (!key || !usage) {
        return {};
      }
      const current = state.modelTokenUsage[key] || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
      const totalTokensDelta = Number.isFinite(usage.total_tokens)
        ? usage.total_tokens
        : usage.prompt_tokens + usage.completion_tokens;
      const updated = {
        prompt_tokens: current.prompt_tokens + usage.prompt_tokens,
        completion_tokens: current.completion_tokens + usage.completion_tokens,
        total_tokens: current.total_tokens + totalTokensDelta,
      };
      return {
        modelTokenUsage: {
          ...state.modelTokenUsage,
          [key]: updated,
        },
      };
    }),
  initializeModelTokenUsage: (key) =>
    set((state) => {
      if (!key || state.modelTokenUsage[key]) {
        return {};
      }
      return {
        modelTokenUsage: {
          ...state.modelTokenUsage,
          [key]: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
      };
    }),
  clearModelTokenUsage: () => set({ modelTokenUsage: {} }),
}));
