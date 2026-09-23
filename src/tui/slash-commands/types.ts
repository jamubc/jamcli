import type { ProviderSlug } from '../layoutState.js';
import type { ChatMessage } from '../../core/types.js';
import type { Config, ModelInfo, Profile } from '../../types/config.js';

export interface CommandDeps {
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

export type CommandHandler = (args: string[], deps: CommandDeps) => Promise<boolean> | boolean;
