import { create } from 'zustand';
import { Config, Profile, UiConfig } from '../types/config.js';
import { HistoryService, SessionUsage } from '../services/HistoryService.js';

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  model?: string;
  modelName?: string;
  streaming?: boolean;
  usage?: TokenUsage;
  reasoning?: string;
}

export interface Action {
  type: 'file_edit' | 'shell_exec';
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
  setStatus: (status: 'idle' | 'thinking' | 'streaming') => void;
  initializeHistory: (projectRoot?: string, sessionId?: string) => Promise<void>;
  persistTurn: () => Promise<void>;
  getSessionUsage: () => SessionUsage | null;
  resumeSession: (sessionId: string) => Promise<boolean>;
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
  
  initializeHistory: async (projectRoot?: string, sessionId?: string) => {
    const historyService = new HistoryService(projectRoot, sessionId);
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
  
  resumeSession: async (sessionId: string) => {
    const state = get();
    
    try {
      // Create new history service with existing session ID
      const historyService = new HistoryService(process.cwd(), sessionId);
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
    
    // Get the most recent user-assistant exchange
    const messages = state.messages;
    if (messages.length < 2) return;
    
    const lastAssistant = messages[messages.length - 1];
    const lastUser = messages[messages.length - 2];
    
    if (lastAssistant.role === 'assistant' && lastUser.role === 'user') {
      await state.historyService.appendTurn(
        [lastUser, lastAssistant],
        lastAssistant.usage
      );
      
      // Update session usage
      set({ sessionUsage: state.historyService.getSessionUsage() });
    }
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
